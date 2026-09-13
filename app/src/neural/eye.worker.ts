/// <reference lib="webworker" />
/**
 * The eye lives here. Two modes: "look", where the page streams frames and asks for fly
 * time to pass; and "judge", where the worker runs a fixed protocol over prepared ads and
 * reports measurements as it goes. No DOM, no rendering.
 */
import { composePair, flat, groups, metrics, permutation, scramble, type Groups } from '../judge/measure';
import { EyeBrain } from './EyeBrain';
import { type Circuit, fromData } from './circuit';
import type { JudgeAd, Snapshot, Variant, WorkerCommand, WorkerEvent } from './protocol';

let brain: EyeBrain | null = null;
let circuit: Circuit | null = null;
let g: Groups | null = null;
let baseline: Float32Array | null = null;      // per-cell EMA rate on grey, for the live glance map
let baseCounts: Int32Array | null = null;      // per-cell spikes over the baseline window
let baseSec = 0.5;
let typeOf: Int16Array | null = null;
let nTypes = 0;
let abortRequested = false;
let clock = 0;                                 // fly ms since the judge started (restores do not rewind it)
let continueResolve: (() => void) | null = null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pause the protocol until the page says the narration has caught up. The eye keeps
 *  looking at the current frame meanwhile, at about half speed, so nothing freezes. */
async function waitForNarration(showing: NonNullable<Snapshot['showing']>): Promise<void> {
  const b = brain!;
  let resolved = false;
  const gate = new Promise<void>((res) => { continueResolve = () => { resolved = true; res(); }; });
  let acc = 0, spikes = 0, wall = performance.now();
  while (!resolved && !abortRequested) {
    spikes += b.advance(10); clock += 10; acc += 10;
    if (acc >= 50) { postSnapshot(snapshot(50, spikes, performance.now() - wall, showing, clock)); acc = 0; spikes = 0; wall = performance.now(); }
    await sleep(18);
  }
  continueResolve = null;
  await gate.catch(() => undefined);
}

const post = (e: WorkerEvent, transfer: Transferable[] = []) => (self as any).postMessage(e, transfer);

function snapshot(ms: number, spikes: number, wallMs: number, showing?: Snapshot['showing'], flyMs?: number): Snapshot {
  const b = brain!;
  const perType = new Float32Array(nTypes);
  const countType = new Int32Array(nTypes);
  for (let i = 0; i < b.n; i++) { perType[typeOf![i]] += b.rate[i]; countType[typeOf![i]]++; }
  for (let t = 0; t < nTypes; t++) perType[t] = countType[t] ? perType[t] / countType[t] : 0;
  const glance = new Float32Array(b.n);
  let glanceMean = 0;
  for (let i = 0; i < b.n; i++) glance[i] = baseline ? Math.abs(b.rate[i] - baseline[i]) : 0;
  for (let k = 0; k < g!.lamina.length; k++) glanceMean += glance[g!.lamina[k]];
  return {
    type: 'snapshot', flyMs: flyMs ?? b.step * b.dt, advancedMs: ms, spikes, wallMs,
    activity: b.activity.slice(), rate: b.rate.slice(), glance,
    glanceMeanHz: g!.lamina.length ? glanceMean / g!.lamina.length : 0,
    ratePerType: perType, hasBaseline: baseline !== null, showing,
  };
}

function postSnapshot(snap: Snapshot) { post(snap, [snap.activity.buffer, snap.rate.buffer, snap.glance.buffer]); }

/** Grey settle, then a baseline window. Leaves the brain in the settled state. */
function settleAndBaseline(settleMs: number, measureMs: number): void {
  const b = brain!;
  b.reset();
  b.setFrame(null);
  for (let t = 0; t < settleMs; t += 10) b.advance(10);
  b.resetCounts();
  for (let t = 0; t < measureMs; t += 10) b.advance(10);
  baseline = b.rate.slice();
  baseCounts = b.counts.slice();
  baseSec = measureMs / 1000;
  b.resetCounts();
}

/** Show a frame sequence for `exposureMs`, returning steady counts and per-window lamina counts. */
function present(frames: Uint8ClampedArray[], frameMs: number, exposureMs: number,
  showing: Omit<NonNullable<Snapshot['showing']>, 'frameIndex'>, windowMs = 100): { steady: Int32Array; windows: Int32Array[] } {
  const b = brain!;
  const windows: Int32Array[] = [];
  const steady = new Int32Array(b.n);
  const half = exposureMs / 2;
  let windowStart = 0;
  let wallStart = performance.now();
  for (let t = 0; t < exposureMs; t += 10) {
    const frameIndex = Math.min(frames.length - 1, Math.floor(t / frameMs));
    if (t === 0 || Math.floor((t - 10) / frameMs) !== frameIndex) b.setFrame(frames[frameIndex]);
    b.resetCounts();
    const spikes = b.advance(10);
    clock += 10;
    if (t >= half) for (let i = 0; i < b.n; i++) steady[i] += b.counts[i];
    if (!windows.length || t - windowStart >= windowMs) { windows.push(new Int32Array(b.n)); windowStart = t; }
    const w = windows[windows.length - 1];
    for (let i = 0; i < b.n; i++) w[i] += b.counts[i];
    if ((t + 10) % 50 === 0) { postSnapshot(snapshot(50, spikes * 5, performance.now() - wallStart, { ...showing, frameIndex }, clock)); wallStart = performance.now(); }
  }
  return { steady, windows };
}

async function runJudge(ads: JudgeAd[], exposureMs: number, seed: number): Promise<void> {
  const b = brain!;
  const t0 = performance.now();
  abortRequested = false;
  clock = 0;
  const fly = () => clock;
  post({ type: 'judge-step', step: 'settle', flyMs: fly() });
  settleAndBaseline(500, 500);
  clock = 1000;
  let laminaBase = 0;
  for (let k = 0; k < g!.lamina.length; k++) laminaBase += baseCounts![g!.lamina[k]];
  post({ type: 'judge-step', step: 'baseline', flyMs: fly(), baselineLaminaHz: laminaBase / g!.lamina.length / baseSec });
  const settled = b.snapshot();
  await waitForNarration({ adId: null, variant: 'grey', frameIndex: 0 });
  const perm = permutation(seed);
  const prepared = ads.map((ad) => {
    const frames = ad.frames.map((f) => new Uint8ClampedArray(f));
    return { ad, frames, scramble: frames.map((f) => scramble(f, perm)), flat: [flat(frames[Math.floor(frames.length / 2)])],
      feed: ad.feed ? { frames: ad.feed.frames.map((f) => new Uint8ClampedArray(f)), rect: ad.feed.rect } : null };
  });
  for (const p of prepared) {
    const variants: Variant[] = p.feed ? ['ad', 'scramble', 'flat', 'feed'] : ['ad', 'scramble', 'flat'];
    for (const variant of variants) {
      if (abortRequested) { post({ type: 'judge-aborted' }); return; }
      b.restore(settled);
      const frames = variant === 'ad' ? p.frames : variant === 'scramble' ? p.scramble : variant === 'flat' ? p.flat : p.feed!.frames;
      const frameMs = variant === 'flat' ? exposureMs : p.ad.frameMs;
      post({ type: 'judge-step', step: 'show', adId: p.ad.id, variant, flyMs: fly() });
      const { steady, windows } = present(frames, frameMs, exposureMs, { adId: p.ad.id, variant });
      const m = metrics(g!, steady, exposureMs / 2000, baseCounts!, baseSec, windows, 0.1, variant === 'feed' ? p.feed!.rect : undefined);
      post({ type: 'judge-measure', adId: p.ad.id, variant, metrics: m, flyMs: fly() });
      await waitForNarration({ adId: p.ad.id, variant, frameIndex: frames.length - 1 });
    }
  }
  for (let i = 0; i < prepared.length; i++)
    for (let j = i + 1; j < prepared.length; j++) {
      for (const [L, R] of [[prepared[i], prepared[j]], [prepared[j], prepared[i]]]) {
        if (abortRequested) { post({ type: 'judge-aborted' }); return; }
        b.restore(settled);
        const n = Math.max(L.frames.length, R.frames.length);
        const frameMs = Math.min(L.ad.frameMs, R.ad.frameMs);
        const frames: Uint8ClampedArray[] = [];
        for (let k = 0; k < n; k++) frames.push(composePair(L.frames[Math.min(L.frames.length - 1, k)], R.frames[Math.min(R.frames.length - 1, k)]));
        post({ type: 'judge-step', step: 'pair', left: L.ad.id, right: R.ad.id, flyMs: fly() });
        const { steady, windows } = present(frames, frameMs, exposureMs, { adId: L.ad.id, variant: 'pair', pairWith: R.ad.id });
        const m = metrics(g!, steady, exposureMs / 2000, baseCounts!, baseSec, windows, 0.1);
        post({ type: 'judge-pair', left: L.ad.id, right: R.ad.id, leftShare: m.leftShare, flyMs: fly() });
        await waitForNarration({ adId: L.ad.id, variant: 'pair', frameIndex: frames.length - 1, pairWith: R.ad.id });
      }
    }
  if (abortRequested) { post({ type: 'judge-aborted' }); return; }
  b.restore(settled);
  b.setFrame(null);
  post({ type: 'judge-done', flyMs: fly(), wallMs: performance.now() - t0 });
}

self.onmessage = async (event: MessageEvent<WorkerCommand>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      circuit = fromData(msg.circuit);
      brain = new EyeBrain(circuit, msg.dtMs ?? 0.1);
      g = groups(circuit);
      typeOf = circuit.type;
      nTypes = circuit.manifest.types.length;
      post({ type: 'ready', manifest: circuit.manifest, types: circuit.manifest.types, dtMs: brain.dt });
      return;
    }
    if (!brain || !circuit) throw new Error('worker not initialised');
    switch (msg.type) {
      case 'reset':
        brain.reset(); baseline = null; post({ type: 'reset' }); return;
      case 'settle':
        settleAndBaseline(msg.settleMs, msg.measureMs);
        post({ type: 'settled', baselineRate: baseline!.slice(), flyMs: brain.step * brain.dt });
        return;
      case 'frame':
        brain.setFrame(msg.rgba ? new Uint8ClampedArray(msg.rgba) : null); return;
      case 'advance': {
        const t0 = performance.now();
        let spikes = 0, left = msg.ms;
        while (left > 0) {
          spikes += brain.advance(Math.min(10, left)); left -= 10;
          if (performance.now() - t0 > msg.budgetMs) break;
        }
        postSnapshot(snapshot(msg.ms - Math.max(0, left), spikes, performance.now() - t0));
        return;
      }
      case 'perturb': brain.perturb(msg.sigmaMv, msg.seed); return;
      case 'judge': void runJudge(msg.ads, msg.exposureMs, msg.seed); return;
      case 'judge-continue': continueResolve?.(); return;
      case 'abort': abortRequested = true; continueResolve?.(); return;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
