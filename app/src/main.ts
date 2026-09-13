import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { Narrator, type AdResult, type Line } from './judge/narrator';
import { flat, permutation, scramble, composePair, composeFeed, FEED_RECT } from './judge/measure';
import { download, renderCard } from './judge/card';
import { buildPost, copyImage, copyText, hasNativeShare, NETWORKS, shareNative, SITE_URL, xLength } from './judge/share';
import { loadCircuit, toData, SCREEN_H, SCREEN_W, type Circuit } from './neural/circuit';
import type { JudgeAd, Snapshot, WorkerCommand, WorkerEvent } from './neural/protocol';
import { EyeRenderer } from './render/EyeRenderer';
import { FlyBug } from './render/FlyBug';
import { ScreenView, fitInto, type Source } from './render/ScreenView';
import { applyPalette, contestantColors, neuralColors, roleOf } from './theme/palette';

applyPalette(document.documentElement.style);

const DT_MS = 0.1;
const MAX_ADVANCE_MS = 40;
const BUDGET_MS = 30;
const MAX_ADS = 8;
const EXPOSURE_MS = 1000;
const JUDGE_SEED = 7;
const TALLY_KEY = 'swat-or-buy:tally';
interface Sample { file: string; name: string; kind: 'vintage' | 'mock'; note: string; credit: string; license: string }
let samples: Sample[] | null = null;
const galleryPicks = new Set<string>();

interface Ad { id: string; name: string; source: Source; video: boolean; url: string; frames?: Uint8ClampedArray[]; frameMs: number }
type Round = 'warmup' | 'a' | 'b' | 'faceoff' | 'verdict';
interface Match { a: string | null; b: string | null; winner: string | null }
interface Bracket { rounds: Match[][]; ri: number; mi: number; played: number; total: number }

const app = document.getElementById('app')!;
app.innerHTML = `
<main>
  <h1 class="sr-only">Swat or Buy. A fruit fly's eye judges your ads.</h1>
  <section class="layout">
    <div class="card stage-card" id="stageCard">
      <div class="card-head">
        <a class="brand" href="/" aria-label="Swat or Buy home">Swat<span class="or">or</span>Buy<span class="period">.</span></a>
        <ol class="rounds" id="rounds" hidden aria-label="Rounds">
          <li class="match" id="matchChip" hidden></li>
          <li data-round="warmup">Warm-up</li><li data-round="a">Contestant A</li><li data-round="b">Contestant B</li><li data-round="faceoff">Face-off</li><li data-round="verdict">Verdict</li>
        </ol>
        <div class="tools">
          <button type="button" class="pill vision" id="visionToggle" aria-pressed="false" title="Show the screen as the photoreceptors sample it: no red, blue and green cells apart">Fly vision</button>
          <button type="button" class="pill" id="heatToggle" aria-pressed="true" title="Paint where the first synapse changed most">Glance map</button>
          <button type="button" class="icon-button" id="studioButton" aria-label="Studio controls" aria-expanded="false" title="Speed, pause, reset">⚙</button>
          <button type="button" class="icon-button" id="aboutButton" aria-label="How it works">?</button>
        </div>
      </div>
      <div class="viewport" id="viewport" tabindex="0" aria-label="The screen the fly is looking at. Drop images or videos here.">
        <canvas id="screen"></canvas>
        <span class="state-pill" id="stateTag"><i></i><span id="stateText">Waking the eye</span></span>
        <span class="vision-note" id="visionNote" hidden>One dot per photoreceptor. Grey cells see no red; blue and green cells see one primary each.</span>
        <div class="hero" id="hero">
          <span class="kicker">A game show judged by 29,195 real neurons</span>
          <h2>Two ads. One fly.<br><em>Swat</em> or <span class="buy">Buy</span>.</h2>
          <p class="lead">Drop two images or short videos, or up to eight for a bracket. A fruit fly's eye looks at each, then both at once, and swats one. It cannot read, so bring your best layout.</p>
          <div class="hero-actions">
            <label class="primary-button big" for="filePick">Add the contestants<input class="hidden-input" type="file" id="filePick" accept="image/*,video/*" multiple></label>
            <button type="button" class="secondary-button" id="sampleButton">Browse the sample ads</button>
          </div>
          <span class="hero-foot">Or paste an image. Nothing leaves your browser. An experiment by <a href="https://multiply.co">multiply.co</a>.</span>
        </div>
        <div class="banner" id="banner"><span class="kicker" id="bannerKicker"></span><span class="title" id="bannerTitle"></span><span class="sub" id="bannerSub"></span></div>
        <div class="caption" id="caption" hidden><span class="who">The fly</span><span id="captionText"></span></div>
        <div class="pick" id="pick" hidden></div>
        <div class="gallery" id="gallery" hidden></div>
        <div class="verdict-overlay" id="verdictOverlay" hidden><canvas id="confetti"></canvas></div>
        <div class="result" id="result" hidden>
          <div class="lead"><span class="badge" id="resultBadge">BUY</span><div class="text"><h2 id="resultTitle"></h2><p id="resultText"></p><span class="human" id="resultHuman" hidden></span></div></div>
          <div class="card-preview"><img id="cardPreview" alt="Preview of the verdict card"><div class="row"><button type="button" class="primary-button" id="shareButton">Share the verdict</button><button type="button" class="secondary-button" id="cardButton" title="Download the card as a PNG">Save</button></div><small>Pre-written post + the card as a 1200 × 630 PNG</small></div>
          <div class="actions"><button type="button" class="secondary-button" id="rematchButton">Run it again</button><button type="button" class="secondary-button" id="newButton">New contestants</button></div>
        </div>
        <span class="screen-hint" id="hint" hidden></span>
        <div class="studio" id="studio" hidden>
          <h3>Studio controls</h3>
          <label class="row">Speed <span><input type="range" id="speed" min="0.05" max="1" step="0.05" value="0.5"> <span class="mono" id="speedValue">0.50×</span></span></label>
          <div class="row"><button type="button" class="secondary-button" id="playButton">Pause</button><button type="button" class="secondary-button" id="resetButton" title="Grey screen, new baseline">Reset eye</button></div>
          <div class="perf"><span id="simSpeed">–</span> · <span id="fps"></span> · <span id="timeValue">0.0 s</span> of fly time</div>
        </div>
      </div>
      <div class="tray" id="tray">
        <div class="lineup" id="lineup"></div>
        <div class="vs" id="vsBox">
          <span class="word" id="vsWord">VS</span>
          <button type="button" class="primary-button big" id="judgeButton" disabled>Start the show</button>
          <button type="button" class="secondary-button" id="stopButton" hidden>Stop</button>
          <span class="vs-links" id="vsLinks"><button type="button" class="text-button" id="galleryButton">Samples</button><label class="text-button" for="filePickMore" id="moreLabel"><span id="moreText">+ your files</span><input class="hidden-input" type="file" id="filePickMore" accept="image/*,video/*" multiple></label></span>
        </div>
        <div class="lineup" id="lineupB"></div>
      </div>
    </div>
    <aside class="card mind-card" aria-label="The fly's eye, live">
      <div class="card-head"><h2>The fly's <span>eye</span></h2><span class="mono" id="circuitTag"></span></div>
      <div class="eye-view" id="eyeView">
        <canvas id="eye"></canvas>
        <div class="eye-count"><strong id="liveSpikes">0</strong><span>spikes in the last 60 ms</span></div>
        <div class="neuron-tag" id="neuronTag" hidden></div>
        <span class="eye-loading" id="eyeLoading"><i class="spinner"></i>Waking the eye…</span>
        <span class="eye-hint">Drag to rotate · tap a cell · colour is change since grey</span>
      </div>
      <section class="meters" id="meters" aria-label="Activity by population"></section>
      <section class="bracket" id="bracket" hidden aria-label="Bracket"></section>
      <section class="board pending" id="board" aria-label="Scoreboard"></section>
      <section class="commentary" aria-label="The fly's commentary">
        <div class="head"><h3>The fly says</h3><span class="status" id="thinkStatus">waiting for two ads</span></div>
        <div class="tally" id="tally" hidden><i></i><span id="tallyText"></span></div>
        <div class="stream" id="stream"><p class="idle">Every line here is a measurement that just happened in the eye on the right. The fly looks at each ad for a second, then the same pixels shuffled, then a flat grey of the same brightness, then the ad dropped into a busy feed, then both side by side. Then it swats one.</p></div>
      </section>
      <footer class="mind-foot"><span class="mono" id="footFacts"></span><span>Retina and lamina of <a href="https://male-cns.janelia.org/">MaleCNS v1.0</a> (CC BY 4.0). Model activity, not fly behaviour. An experiment by <a href="https://multiply.co">multiply.co</a>.</span><span class="foot-links"><button type="button" class="text-button" id="aboutButton2">How it works</button><button type="button" class="text-button" id="creditsButton">Credits</button><a href="https://github.com/oskarmalmwiklund/swat-or-buy">GitHub</a><a href="https://multiply.co">Multiply</a></span></footer>
    </aside>
  </section>
  <dialog class="dialog" id="about">
    <div class="dialog-body">
      <button type="button" class="icon-button dialog-close" id="aboutClose" aria-label="Close">✕</button>
      <h2>A fly's eye, judging your ads</h2>
      <p>Every point on the right is a real neuron from the male fruit fly connectome: the photoreceptors that sample the screen, the lamina where fly vision makes its first decision, and the cells that feed back onto it. The wiring and synapse counts are the published ones. The dynamics are a simple integrate-and-fire model, the same one the whole-brain fly simulators use.</p>
      <div class="facts" id="facts"></div>
      <h3>What the numbers mean</h3>
      <dl>
        <dt>Glance</dt><dd>Mean change in firing of the L1–L3 lamina cells compared with a grey screen, in Hz per cell. The first synapse's reaction to contrast and colour.</dd>
        <dt>Layout</dt><dd>The share of the glance that disappears when the ad's pixels are shuffled. Whatever survives the shuffle is brightness and colour; whatever is lost was arrangement.</dd>
        <dt>Hold</dt><dd>The reaction after a second compared with its peak. Low means the eye has already adapted.</dd>
        <dt>In the feed</dt><dd>The ad at half size in the middle of a screen tiled with blocks of every contestant's pixels. The share of the lamina's change that lands on the ad, divided by the quarter of the screen it covers: 1× means it vanishes into the feed, 2× means it pulls twice its share.</dd>
        <dt>Side by side</dt><dd>Two ads at once, one per eye, both orders. The share of the lamina's change on each ad's side.</dd>
        <dt>Fly vision</dt><dd>The screen as the photoreceptors sample it. R1–R6 weight the primaries roughly 3 % red, 42 % green, 55 % blue, after the Rh1 pigment; R8 cells see only the blue or only the green primary. Red is nearly dark to this eye.</dd>
        <dt>Spikes</dt><dd>Action potentials across the whole circuit. Photoreceptors fire constantly, so this mostly tracks brightness.</dd>
      </dl>
      <h3>The verdict</h3>
      <p>Ads are ranked by how much of the lamina's response comes from layout, that is glance minus shuffled. Ties go to the side-by-side share, then to the feed, then to hold. In a bracket, each match runs the same protocol and the winner advances. Every sentence the fly says is a measurement that just happened; the voice is a convenience.</p>
      <h3>Human vs fly</h3>
      <p>Before the show you can say which ad you would buy. The result tells you whether the fly agreed, and this device keeps a running count. It never leaves your browser.</p>
      <h3>What it cannot tell you</h3>
      <p>It cannot read, it has no memory of brands, it does not get bored (the model has no adaptation, so a second viewing looks exactly like the first), and in the full 166,700-neuron model the image signal stops at the lamina: nothing deeper responds to picture structure. So this page shows exactly the part that carries signal. The full-brain report with null controls lives in the repository.</p>
      <h3>Credits</h3>
      <p>Connectome: <a href="https://male-cns.janelia.org/">MaleCNS v1.0</a> by the MaleCNS collaboration (FlyEM at HHMI Janelia, the Cambridge Connectomics Group, Google Research), CC BY 4.0. Simulator: a port of <a href="https://github.com/Fluffet/bananflugakompassen">Bananflugakompassen</a> by Fluffet, itself from <a href="https://github.com/nftechie/stonkfly">Stonkfly</a> and DOOMFLY by nftechie, MIT. Design reference: <a href="https://github.com/hrook1/Swat">Swat</a> by hrook1. Palette: <a href="https://multiply.co">Multiply</a>. Type: Bricolage Grotesque by Mathieu Triay, DM Sans by Colophon Foundry, JetBrains Mono by JetBrains, all under the SIL Open Font License. Rendering: Three.js. Vintage sample ads are public-domain works from Wikimedia Commons (O’Galop, Bouisset, Privat-Livemont, Cappiello, Toulouse-Lautrec, Mucha and others); the mock ads were made for this project. Built by Oskar Malm Wiklund at Multiply with Claude Code.</p>
      <p>Source, data notes and the full-brain report: <a href="https://github.com/oskarmalmwiklund/swat-or-buy">github.com/oskarmalmwiklund/swat-or-buy</a>. Full credits in the repository’s THIRD_PARTY.md. Swat or Buy is an experiment by <a href="https://multiply.co">Multiply</a>.</p>
    </div>
  </dialog>
  <dialog class="dialog share" id="share">
    <div class="dialog-body">
      <button type="button" class="icon-button dialog-close" id="shareClose" aria-label="Close">✕</button>
      <span class="kicker">Share the verdict</span>
      <h2>Tell them a fly said so.</h2>
      <div class="share-grid">
        <div class="share-card"><img id="shareImg" alt="The verdict card"><div class="share-card-actions"><button type="button" class="secondary-button" id="shareCopyImg">Copy image</button><button type="button" class="secondary-button" id="shareSave">Save PNG</button></div></div>
        <div class="share-post"><label for="shareText">Your post <small>edit as you like</small></label><textarea id="shareText" rows="7" spellcheck="false"></textarea><div class="share-post-actions"><button type="button" class="secondary-button" id="shareCopyText">Copy text</button><span class="count mono" id="shareCount"></span></div></div>
      </div>
      <div class="share-nets" id="shareNets"></div>
      <button type="button" class="primary-button big" id="shareNative" hidden>Share from this device…</button>
      <p class="share-note">Share buttons on social networks only take text and a link, never a picture, so paste the card into your post after the composer opens (Copy image, then ⌘V). The link itself unfurls with the site preview.</p>
    </div>
  </dialog>
</main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = $('viewport'), screenCanvas = $<HTMLCanvasElement>('screen'), eyeCanvas = $<HTMLCanvasElement>('eye');

let circuit: Circuit;
let screen: ScreenView;
let eye: EyeRenderer;
let types: string[] = [];
let mode: 'look' | 'judge' = 'look';
let playing = true;
let settled = false;
let inFlight = false;
let speed = 0.5;
let lastWall = performance.now();
let frameCount = 0, fpsWall = performance.now();
const ads: Ad[] = [];
let matchAds: Ad[] = [];                 // the ads in the match being judged (or last judged)
let shownId: string | null = null;
let narrator: Narrator | null = null;
let judgeFrames = new Map<string, Uint8ClampedArray[]>();   // key `${adId}:${variant}` or `pair:${L}:${R}`
let typeQueue: Line[] = [];
let typing = false;
let verdictShown = false;
let bracket: Bracket | null = null;
let humanPick: string | null = null;     // the ad the visitor said they would buy, this game
let lastCard: Parameters<typeof renderCard>[0] | null = null;
let lastCanvas: HTMLCanvasElement | null = null;
let lastPost = '';
let bug: FlyBug;

const worker = new Worker(new URL('./neural/eye.worker.ts', import.meta.url), { type: 'module' });
const send = (c: WorkerCommand, transfer: Transferable[] = []) => worker.postMessage(c, transfer);

function toast(text: string): void {
  const el = document.createElement('div');
  el.className = 'toast'; el.role = 'status'; el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4200);
}
const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const letter = (i: number) => String.fromCharCode(65 + i);
const indexOf = (id?: string | null) => ads.findIndex((a) => a.id === id);
const adById = (id?: string | null) => ads.find((a) => a.id === id);
const colorIndex = (id: string) => Math.max(0, indexOf(id)) % contestantColors.length;
const setState = (text: string, cls: '' | 'live' | 'judging' | 'verdict' = '') => { $('stateText').textContent = text; $('stateTag').className = `state-pill ${cls}`; };

/** Numbers on screen are smoothed and redrawn a few times a second, so they read as a
 *  dial and not as noise. */
class Calm {
  private v: number | null = null;
  private last = 0;
  private lastPush = performance.now();
  constructor(private readonly tau: number, private readonly every = 160) {}
  push(x: number, now: number): number | null {
    this.v = this.v === null ? x : this.v + (x - this.v) * (1 - Math.exp(-(now - this.lastPush) / this.tau));
    this.lastPush = now;
    if (now - this.last < this.every) return null;
    this.last = now;
    return this.v;
  }
}
const calmSpikes = new Calm(250), calmRates: Record<string, Calm> = { receptor: new Calm(400), lamina: new Calm(400), feedback: new Calm(400) };

// ---- human vs fly tally -------------------------------------------------------------------
function readTally(): { games: number; agreed: number } {
  try { const t = JSON.parse(localStorage.getItem(TALLY_KEY) || ''); if (t && typeof t.games === 'number') return t; } catch { /* fresh */ }
  return { games: 0, agreed: 0 };
}
function writeTally(t: { games: number; agreed: number }): void { try { localStorage.setItem(TALLY_KEY, JSON.stringify(t)); } catch { /* private mode */ } }
function renderTally(): void {
  const t = readTally();
  $('tally').hidden = t.games === 0;
  if (t.games) $('tallyText').innerHTML = `Human vs fly on this device: agreed <b>${t.agreed} of ${t.games}</b> ${t.games === 1 ? 'time' : 'times'}.`;
}

// ---- right card: meters, facts ---------------------------------------------------------
const METERS: Record<string, { color: string; label: string; max: number }> = {
  receptor: { color: neuralColors.receptor, label: 'Photoreceptors', max: 140 },
  lamina: { color: neuralColors.lamina, label: 'Lamina', max: 60 },
  feedback: { color: neuralColors.feedback, label: 'Feedback', max: 30 },
};
function buildRightCard(): void {
  $('meters').innerHTML = Object.entries(METERS).map(([k, m]) =>
    `<div class="meter" style="--c:${m.color}"><div class="head"><i></i>${m.label}</div><div class="bar"><i id="meter-${k}" style="width:0%"></i></div><div class="val"><span id="rate-${k}">0.0</span> <small>Hz / cell</small></div></div>`).join('');
  const m = circuit.manifest;
  $('circuitTag').textContent = `${m.neurons.toLocaleString('en-US')} cells · ${DT_MS} ms steps`;
  $('footFacts').textContent = `${m.edges.toLocaleString('en-US')} connections · ${(m.synaptic_contacts / 1e6).toFixed(2)} M synaptic contacts`;
  $('facts').innerHTML = `<span><b>${m.neurons.toLocaleString('en-US')}</b>real neurons</span><span><b>${m.edges.toLocaleString('en-US')}</b>connections</span><span><b>${(m.synaptic_contacts / 1e6).toFixed(2)} M</b>synaptic contacts</span><span><b>${m.types.length}</b>cell types</span><span><b>${DT_MS} ms</b>timestep</span>`;
  renderBoard();
  renderTally();
}
const typeCount = new Map<number, number>();
function updateMeters(snap: Snapshot, now: number): void {
  const sums: Record<string, number> = { receptor: 0, lamina: 0, feedback: 0 }, counts: Record<string, number> = { receptor: 0, lamina: 0, feedback: 0 };
  types.forEach((t, k) => { const n = typeCount.get(k) ?? 0; const role = roleOf(t); sums[role] += snap.ratePerType[k] * n; counts[role] += n; });
  for (const role of Object.keys(sums)) {
    const hz = calmRates[role].push(counts[role] ? sums[role] / counts[role] : 0, now);
    if (hz === null) continue;
    $(`rate-${role}`).textContent = fmt(hz);
    $(`meter-${role}`).style.width = `${Math.min(100, (hz / METERS[role].max) * 100)}%`;
  }
}

// ---- scoreboard ------------------------------------------------------------------------
const BOARD_ROWS: { key: string; label: string; unit: string; get: (r: AdResult) => number | null; show: (x: number) => string }[] = [
  { key: 'glance', label: 'Glance', unit: 'Hz change at the first synapse', get: (r) => r.metrics.ad?.glance ?? null, show: (x) => fmt(x, 2) },
  { key: 'layout', label: 'Layout', unit: 'share of the glance that is arrangement', get: (r) => r.metrics.scramble ? r.layoutShare : null, show: pct },
  { key: 'hold', label: 'Hold', unit: 'reaction left after a second', get: (r) => r.metrics.ad?.hold ?? null, show: pct },
  { key: 'feed', label: 'In the feed', unit: 'pull vs its share of a busy screen', get: (r) => r.pop, show: (x) => `${fmt(x, 1)}×` },
  { key: 'side', label: 'Side by side', unit: 'share of the response on this side', get: (r) => r.sideBySide, show: pct },
];
function renderBoard(): void {
  const board = $('board');
  const pair = matchAds.length ? matchAds : ads.slice(0, 2);
  const results = narrator ? pair.map((a) => narrator!.ads.get(a.id) ?? null) : pair.map(() => null);
  const who = (i: number) => {
    const a = pair[i];
    return a ? `<span class="who ${i ? 'b' : ''}" style="--c:var(--c${colorIndex(a.id)})"><i></i><span>${escapeHtml(a.name)}</span></span>`
      : `<span class="who empty ${i ? 'b' : ''}">Contestant ${letter(i)}</span>`;
  };
  const ca = pair[0] ? `var(--c${colorIndex(pair[0].id)})` : 'var(--c0)', cb = pair[1] ? `var(--c${colorIndex(pair[1].id)})` : 'var(--c1)';
  const rows = BOARD_ROWS.map((row) => {
    const a = results[0] ? row.get(results[0]) : null, b = results[1] ? row.get(results[1]) : null;
    const max = Math.max(a ?? 0, b ?? 0, 1e-9);
    const wa = a === null ? 0 : (a / max) * 50, wb = b === null ? 0 : (b / max) * 50;
    const lead = a !== null && b !== null ? (a > b ? 'a' : b > a ? 'b' : '') : '';
    return `<div class="tug" data-key="${row.key}" style="--ca:${ca};--cb:${cb}">
      <span class="val a ${lead === 'a' ? 'lead' : ''}">${a === null ? '–' : row.show(a)}</span>
      <div class="track"><i class="a" style="width:${wa}%"></i><i class="b" style="width:${wb}%"></i></div>
      <span class="val b ${lead === 'b' ? 'lead' : ''}">${b === null ? '–' : row.show(b)}</span>
      <span class="label"><b>${row.label}</b><span>· ${row.unit}</span></span></div>`;
  }).join('');
  board.classList.toggle('pending', !results.some(Boolean));
  board.innerHTML = `<div class="board-head">${who(0)}<span class="vs">VS</span>${who(1)}</div>${rows}`;
}

// ---- bracket -----------------------------------------------------------------------------
function buildBracket(ids: string[]): Bracket {
  const rounds: Match[][] = [];
  let pool = ids.slice();
  while (pool.length > 1) {
    const round: Match[] = [];
    for (let i = 0; i < pool.length; i += 2) {
      const a = pool[i], b = pool[i + 1] ?? null;
      round.push({ a, b, winner: b === null ? a : null });   // a bye advances at once
    }
    rounds.push(round);
    pool = round.map((m) => m.winner ?? `?${rounds.length}:${round.indexOf(m)}`);
  }
  const total = rounds.reduce((s, r) => s + r.filter((m) => m.b !== null).length, 0);
  return { rounds, ri: 0, mi: -1, played: 0, total };
}
function roundName(b: Bracket, ri: number): string {
  const left = b.rounds.length - ri;
  return left === 1 ? 'Final' : left === 2 ? 'Semi-final' : left === 3 ? 'Quarter-final' : `Round ${ri + 1}`;
}
/** Advance to the next playable match; returns null when the bracket is complete. */
function nextMatch(b: Bracket): Match | null {
  for (;;) {
    b.mi++;
    if (b.mi >= b.rounds[b.ri].length) {
      // seed the next round from this round's winners
      if (b.ri + 1 >= b.rounds.length) return null;
      const winners = b.rounds[b.ri].map((m) => m.winner!);
      b.rounds[b.ri + 1].forEach((m, k) => { m.a = winners[k * 2] ?? null; m.b = winners[k * 2 + 1] ?? null; if (m.b === null) m.winner = m.a; });
      b.ri++; b.mi = 0;
    }
    const m = b.rounds[b.ri][b.mi];
    if (m.a && m.b && !m.winner) return m;
  }
}
function renderBracket(): void {
  const el = $('bracket');
  el.hidden = !bracket;
  if (!bracket) return;
  const b = bracket;
  const row = (id: string | null, m: Match, ri: number) => {
    if (!id || id.startsWith('?')) return `<span class="row tbd"><i style="--c:var(--brain-line)"></i><span>winner of match</span></span>`;
    const a = adById(id);
    const isFinal = ri === b.rounds.length - 1;
    const cls = m.winner ? (m.winner === id ? (isFinal ? 'win champ' : 'win') : 'lose') : '';
    return `<span class="row ${cls}" style="--c:var(--c${colorIndex(id)})"><i></i><span>${escapeHtml(a?.name ?? '?')}</span></span>`;
  };
  const cols = b.rounds.map((round, ri) => `<div class="col">${round.map((m, mi) => `<div class="m ${ri === b.ri && mi === b.mi && mode === 'judge' ? 'live' : ''} ${m.winner ? 'done' : ''}">${row(m.a, m, ri)}${m.b === null && m.a && !m.a.startsWith('?') ? `<span class="row tbd"><i style="--c:var(--brain-line)"></i><span>bye</span></span>` : row(m.b, m, ri)}</div>`).join('')}</div>`).join('');
  el.innerHTML = `<div class="head">Bracket<span>match ${Math.min(b.played + 1, b.total)} of ${b.total}</span></div><div class="tree">${cols}</div>`;
}

// ---- tray -------------------------------------------------------------------------------
function slotHtml(i: number, a: Ad | undefined, compact: boolean): string {
  const v = narrator && verdictShown ? narrator.verdict() : null;
  if (!a) {
    return `<div class="slot ${compact ? 'add' : ''}" data-slot="${i}" style="--c:var(--c${i % contestantColors.length});--c-ink:var(--c${i % contestantColors.length}-ink)"><span class="letter">${letter(i)}</span><label class="empty" for="pick${i}"><span class="plus">+</span><span><strong>${compact ? 'Add' : `Contestant ${letter(i)}`}</strong>${compact ? '' : '<span>drop, pick or paste an image or short video</span>'}</span><input class="hidden-input" type="file" id="pick${i}" accept="image/*,video/*" multiple></label></div>`;
  }
  const r = v?.ranking.find((x) => x.id === a.id);
  let outcome: string | null = null, outcomeText = '';
  if (bracket && bracket.rounds.length) {
    const champion = bracket.rounds[bracket.rounds.length - 1][0].winner;
    if (champion === a.id && !bracket.rounds[bracket.rounds.length - 1][0].winner?.startsWith('?')) { outcome = 'champ'; outcomeText = 'CHAMPION'; }
    else for (const round of bracket.rounds) for (const m of round) if (m.winner && (m.a === a.id || m.b === a.id) && m.winner !== a.id) { outcome = 'swat'; outcomeText = 'OUT'; }
  } else if (v && r) {
    if (v.ranking.length > 1) { outcome = r === v.winner ? 'buy' : 'swat'; outcomeText = outcome.toUpperCase(); }
    else { outcome = r.layoutShare > 0.5 ? 'buy' : 'swat'; outcomeText = outcome.toUpperCase(); }
  }
  const res = narrator?.ads.get(a.id);
  const sub = res?.metrics.ad ? `<b>${fmt(res.metrics.ad.glance, 2)} Hz</b> glance${res.metrics.scramble ? ` · <b>${pct(res.layoutShare)}</b> layout` : ''}${res.pop !== null && !compact ? ` · <b>${fmt(res.pop, 1)}×</b> feed` : ''}` : a.video ? 'video · first two seconds' : 'still · one second';
  const live = mode === 'judge' && matchAds.some((m) => m.id === a.id);
  return `<div class="slot filled ${a.id === shownId && mode === 'look' ? 'is-shown' : ''} ${live ? 'is-live' : ''} ${outcome === 'swat' && bracket ? 'out' : ''}" data-slot="${i}" data-id="${a.id}" style="--c:var(--c${i % contestantColors.length});--c-ink:var(--c${i % contestantColors.length}-ink)"><span class="letter">${letter(i)}</span>
      <button type="button" class="thumb" data-show="${a.id}" title="Show ${escapeHtml(a.name)} to the fly">${a.video ? `<video src="${a.url}" muted playsinline></video>` : `<img src="${a.url}" alt="">`}</button>
      <div class="meta"><span class="name">${escapeHtml(a.name)}</span><span class="sub">${sub}</span></div>
      <button type="button" class="remove" data-remove="${a.id}" title="Remove" aria-label="Remove ${escapeHtml(a.name)}">✕</button>
      ${outcome ? `<span class="outcome ${outcome}">${outcomeText}</span>` : ''}</div>`;
}
function renderTray(): void {
  const grid = ads.length > 2;
  $('tray').classList.toggle('grid', grid);
  const A = $('lineup'), B = $('lineupB');
  if (grid) {
    A.innerHTML = ads.map((a, i) => slotHtml(i, a, true)).join('') + (ads.length < MAX_ADS ? slotHtml(ads.length, undefined, true) : '');
    B.innerHTML = ''; B.hidden = true;
  } else {
    A.innerHTML = slotHtml(0, ads[0], false);
    B.innerHTML = slotHtml(1, ads[1], false); B.hidden = false;
  }
  for (const root of [A, B]) {
    root.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((inp) => inp.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.files) acceptFiles(t.files, Number((t.closest('.slot') as HTMLElement).dataset.slot)); t.value = ''; }));
    root.querySelectorAll<HTMLButtonElement>('[data-show]').forEach((b) => b.addEventListener('click', () => show(b.dataset.show!)));
    root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => removeAd(b.dataset.remove!)));
    root.querySelectorAll<HTMLElement>('.slot').forEach((slot) => {
      ['dragenter', 'dragover'].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); slot.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); slot.classList.remove('is-over'); }));
      slot.addEventListener('drop', (e) => { const f = (e as DragEvent).dataTransfer?.files; if (f?.length) acceptFiles(f, Number(slot.dataset.slot)); });
    });
  }
  $('hero').hidden = ads.length > 0;
  $('stateTag').hidden = ads.length === 0;
  $('hint').hidden = ads.length === 0 || mode === 'judge' || verdictShown;
  $('hint').textContent = ads.length < 2 ? 'Drag to move, scroll to resize. Add a second contestant to start the show.' : 'Drag to move, scroll to resize. The dotted lines mark where the two eyes overlap.';
  const judge = $<HTMLButtonElement>('judgeButton');
  judge.textContent = grid ? 'Start the bracket' : ads.length > 1 ? 'Start the show' : 'Judge this one';
  judge.disabled = ads.length === 0 || mode === 'judge' || !settled;
  judge.classList.toggle('ready', !judge.disabled && ads.length > 1 && !verdictShown);
  $('vsLinks').hidden = mode === 'judge' || ads.length >= MAX_ADS;
  $('moreText').textContent = ads.length < 2 ? '+ your files' : '+ more for a bracket';
  $('vsWord').textContent = mode === 'judge' ? (bracket ? `ON AIR · ${roundName(bracket, bracket.ri).toUpperCase()}` : 'ON AIR') : grid ? `${ads.length} CONTESTANTS` : 'VS';
  $('vsWord').classList.toggle('live', mode === 'judge');
  renderBoard();
  renderBracket();
}

// ---- the show ---------------------------------------------------------------------------
let bannerTimer: number | undefined;
function banner(kicker: string, title: string, sub = '', ms = 2400, color = 'var(--yellow)'): void {
  $('bannerKicker').textContent = kicker; $('bannerTitle').textContent = title; $('bannerSub').textContent = sub;
  $('bannerSub').hidden = !sub;
  $('banner').style.setProperty('--banner-c', color);
  $('banner').classList.add('show');
  window.clearTimeout(bannerTimer);
  if (ms > 0) bannerTimer = window.setTimeout(() => $('banner').classList.remove('show'), ms);
}
function setRound(r: Round | null): void {
  const order: Round[] = ['warmup', 'a', 'b', 'faceoff', 'verdict'];
  const at = r ? order.indexOf(r) : -1;
  $('rounds').querySelectorAll<HTMLLIElement>('li[data-round]').forEach((li) => {
    const i = order.indexOf(li.dataset.round as Round);
    li.classList.toggle('done', at > i);
    li.classList.toggle('now', at === i);
    li.hidden = (li.dataset.round === 'b' || li.dataset.round === 'faceoff') && matchAds.length < 2;
  });
  const chip = $('matchChip');
  chip.hidden = !bracket;
  if (bracket) chip.textContent = `${roundName(bracket, bracket.ri)} · ${Math.min(bracket.played + 1, bracket.total)}/${bracket.total}`;
  $('rounds').querySelectorAll<HTMLLIElement>('li[data-round]').forEach((li) => {
    if (li.dataset.round === 'a') li.textContent = bracket ? 'A' : 'Contestant A';
    if (li.dataset.round === 'b') li.textContent = bracket ? 'B' : 'Contestant B';
  });
}
function stageFor(e: WorkerEvent): void {
  if (!narrator || e.type !== 'judge-step') return;
  const quick = !!bracket;
  if (e.step === 'settle') { setRound('warmup'); if (!quick || bracket!.played === 0) banner('Warm-up', 'Lights down', 'the eye settles on grey and takes its resting pulse', 2600, 'var(--pink)'); }
  else if (e.step === 'show') {
    const mi = matchAds.findIndex((a) => a.id === e.adId), gi = indexOf(e.adId), L = letter(gi), n = narrator.name(e.adId), c = `var(--c${colorIndex(e.adId!)})`;
    setRound(mi === 0 ? 'a' : 'b');
    if (e.variant === 'ad') banner(`Round ${mi + 1} · Contestant ${L}`, n, 'one second, straight on', 2400, c);
    else if (e.variant === 'scramble') banner(`Contestant ${L} · the shuffle`, 'Same pixels, no layout', 'what survives is brightness and colour', 2400, c);
    else if (e.variant === 'flat') banner(`Contestant ${L} · flat grey`, 'Brightness alone', 'a blank as bright as the ad', 2400, c);
    else banner(`Contestant ${L} · the feed`, 'Lost in the feed?', 'half size, surrounded by everyone’s pixels', 2400, c);
  } else if (e.step === 'pair') {
    setRound('faceoff');
    banner(bracket ? roundName(bracket, bracket.ri) : 'Final round', 'Face-off', `${letter(indexOf(e.left))} in the left eye, ${letter(indexOf(e.right))} in the right`, 2400, 'var(--orange)');
  }
}

function humanLine(win: AdResult): { html: string; cls: string } | null {
  if (!humanPick) return null;
  const picked = adById(humanPick);
  const agree = humanPick === win.id;
  const t = readTally();
  return { cls: agree ? 'agree' : 'disagree', html: `You picked ${escapeHtml(picked?.name ?? 'one')}. ${agree ? 'The fly agrees.' : 'The fly disagrees.'} <span style="opacity:.7">Agreed ${t.agreed} of ${t.games} on this device.</span>` };
}

/** One plain sentence on why the fly picked the winner, in the order the verdict rule uses. */
function plainReason(win: AdResult, lose: AdResult | null): string {
  if (!lose) return win.layoutShare > 0.5 ? 'Its layout drives the fly’s eye more than its brightness does.' : 'Mostly brightness and colour; the layout barely registers.';
  const tie = Math.abs(win.structure - lose.structure) <= 0.1 * Math.max(win.structure, lose.structure, 1e-9);
  if (!tie) return `The arrangement of ${win.name} moves the fly’s eye more than ${lose.name}’s does. Shuffle the pixels and ${lose.name} hardly changes.`;
  if (win.sideBySide !== null && lose.sideBySide !== null && Math.abs(win.sideBySide - lose.sideBySide) > 0.04) return `On layout it was a tie. Side by side, ${win.name} pulled more of the fly’s eye.`;
  if (win.pop !== null && lose.pop !== null && Math.abs(win.pop - lose.pop) > 0.15) return `Layout and face-off were level. In a busy feed, ${win.name} stands out more.`;
  return `Almost a dead heat. ${win.name} held the fly’s eye a little longer.`;
}

/** The verdict moment. `final` is a duel or the bracket final; other bracket matches get stamps only. */
function playVerdict(final: boolean): void {
  if (!narrator) return;
  const v = narrator.verdict();
  if (!v.winner) return;
  verdictShown = true;
  setRound('verdict');
  const overlay = $('verdictOverlay');
  overlay.hidden = false;
  overlay.innerHTML = '<canvas id="confetti"></canvas><div class="flash" id="flash"></div>';
  const single = v.ranking.length === 1;
  const win = v.winner, lose = v.ranking[1] ?? null;
  const winSide = matchAds.findIndex((a) => a.id === win.id);      // which side of the face-off frame
  const pairKey = lose ? (winSide === 0 ? `pair:${win.id}:${lose.id}` : `pair:${lose.id}:${win.id}`) : `${win.id}:ad`;
  const frames = judgeFrames.get(pairKey);
  if (frames) screen.override = new ImageData(frames[0].slice(), SCREEN_W, SCREEN_H);
  const singleBuy = single && win.layoutShare > 0.5;
  const champion = final && !!bracket;
  banner(champion ? 'Champion' : final ? 'Verdict' : `${roundName(bracket!, bracket!.ri)} · verdict`, single ? (singleBuy ? 'Buy' : 'Swat') : win.name,
    single ? '' : final ? `gets the BUY · ${lose!.name} gets the swatter` : `advances · ${lose!.name} is out`, 0, single && !singleBuy ? 'var(--orange)' : 'var(--yellow)');
  $('hint').hidden = true;
  const buyX = single ? 50 : winSide === 0 ? 27 : 73, swatX = winSide === 0 ? 73 : 27;
  if (final) $('flash').classList.add('go');
  if (!single || singleBuy) {
    const buy = document.createElement('span'); buy.className = 'stamp buy'; buy.textContent = 'BUY'; buy.style.left = `${buyX}%`;
    overlay.append(buy);
    window.setTimeout(() => { buy.classList.add('in'); if (final) burst(buyX / 100, true); bug.landAt(buyX / 100 + 0.055, 0.39); }, 250);
  }
  if (lose || !singleBuy) {
    const x = lose ? swatX : 50;
    const swat = document.createElement('span'); swat.className = 'stamp swat'; swat.textContent = 'SWAT'; swat.style.left = `${x}%`;
    if (final) {
      const swatter = document.createElement('div'); swatter.className = 'swatter'; swatter.style.left = `${x}%`;
      swatter.innerHTML = '<div class="handle"></div><div class="head"></div>';
      overlay.append(swatter);
      window.setTimeout(() => swatter.classList.add('swing'), lose ? 1000 : 300);
    }
    overlay.append(swat);
    window.setTimeout(() => { swat.classList.add('in'); if (final) burst(x / 100); }, final ? (lose ? 1550 : 850) : 700);
  }
  if (!final) return;
  // tally the human's call
  let human: Parameters<typeof renderCard>[0]['human'] = null;
  if (humanPick) {
    const t = readTally(); t.games++; if (humanPick === win.id) t.agreed++; writeTally(t); renderTally();
    human = { pickedWinner: humanPick === win.id, agreed: t.agreed, games: t.games };
  }
  lastCard = frames ? { frame: frames[0], winner: win, loser: lose, winnerIndex: colorIndex(win.id), loserIndex: lose ? colorIndex(lose.id) : colorIndex(win.id) + 1, human, title: champion ? `Bracket champion of ${ads.length}, judged by 29,195 real neurons of a fruit fly’s eye` : undefined } : null;
  if (lastCard && lose && winSide !== 0) { lastCard.winnerIndex = 1; lastCard.loserIndex = 0; }   // the card places by face-off side
  if (lastCard && lose && winSide === 0) { lastCard.winnerIndex = 0; lastCard.loserIndex = 1; }
  // the result card, once the stamps have landed
  window.setTimeout(() => {
    $('resultBadge').textContent = champion ? 'CHAMP' : single ? (singleBuy ? 'BUY' : 'SWAT') : 'BUY';
    $('resultBadge').style.background = single && !singleBuy ? 'var(--orange)' : champion ? 'var(--violet)' : 'var(--yellow)';
    $('resultBadge').style.color = (single && !singleBuy) || champion ? '#fff' : 'var(--ink)';
    $('resultTitle').textContent = champion ? `${win.name} takes the bracket` : single ? `${win.name}: ${singleBuy ? 'the fly would buy' : 'the fly swats'}` : `${win.name} gets the BUY`;
    $('resultText').textContent = plainReason(win, lose);
    const img = $<HTMLImageElement>('cardPreview');
    img.removeAttribute('src');
    lastCanvas = null;
    if (lastCard) void renderCard(lastCard).then((cv) => { lastCanvas = cv; const small = document.createElement('canvas'); small.width = 600; small.height = 315; small.getContext('2d')!.drawImage(cv, 0, 0, 600, 315); img.src = small.toDataURL('image/jpeg', 0.85); });
    lastPost = buildPost({ winner: win, loser: lose, bracketSize: bracket ? ads.length : null, human: humanPick ? { picked: adById(humanPick)?.name ?? 'one', agreed: humanPick === win.id } : null });
    const h = humanLine(win);
    $('resultHuman').hidden = !h;
    if (h) { $('resultHuman').className = `human ${h.cls}`; $('resultHuman').innerHTML = h.html; }
    $('banner').classList.remove('show');
    $('result').hidden = false;
    requestAnimationFrame(() => $('result').classList.add('in'));
    renderTray();
  }, lose ? 2500 : 1600);
}

function burst(xFrac: number, confetti = false): void {
  const canvas = $<HTMLCanvasElement>('confetti');
  const rect = canvas.parentElement!.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  const ctx = canvas.getContext('2d')!;
  const colors = confetti ? ['#FFD400', '#FE67EF', '#9747FF', '#5AD1FF', '#FBFAF9'] : ['#FE5300', '#A33500', '#0A0A0A'];
  const parts = Array.from({ length: confetti ? 110 : 60 }, () => ({
    x: rect.width * xFrac, y: rect.height * 0.46, vx: (Math.random() - 0.5) * (confetti ? 11 : 14), vy: (Math.random() - (confetti ? 0.9 : 0.5)) * (confetti ? 13 : 10),
    r: 3 + Math.random() * (confetti ? 5 : 7), c: colors[Math.floor(Math.random() * colors.length)], life: 1, spin: Math.random() * Math.PI,
  }));
  const t0 = performance.now();
  const step = () => {
    const t = (performance.now() - t0) / 1000;
    if (t > 2.6) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += confetti ? 0.22 : 0.35; p.vx *= 0.985; p.life -= confetti ? 0.007 : 0.012; p.spin += 0.1;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      if (confetti) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function clearVerdict(): void {
  $('verdictOverlay').hidden = true;
  $('result').classList.remove('in'); $('result').hidden = true;
  $('banner').classList.remove('show');
  $('caption').hidden = true;
  verdictShown = false;
}

/** Lights up: back to the studio look. */
function houseLights(on: boolean): void {
  $('stageCard').classList.toggle('show', !on);
  screen.dark = !on;
  $('rounds').hidden = on;
  if (on) setRound(null);
}

function show(id: string): void {
  if (mode === 'judge') return;
  const ad = adById(id);
  if (!ad) return;
  clearVerdict();
  houseLights(true);
  screen.override = null;
  shownId = id;
  screen.setPair(false);
  screen.setSource(0, ad.source);
  screen.resetGlance();
  if (ad.video) (ad.source as HTMLVideoElement).play().catch(() => undefined);
  setState('Looking', 'live');
  bug.wander(0.45);
  renderTray();
}

function resetGame(): void {
  narrator = null; bracket = null; humanPick = null; matchAds = []; lastCard = null;
  clearVerdict();
  houseLights(true);
  screen.override = null;
}

function removeAd(id: string): void {
  if (mode === 'judge') return;
  const i = indexOf(id);
  if (i < 0) return;
  const [ad] = ads.splice(i, 1);
  URL.revokeObjectURL(ad.url);
  resetGame();
  if (shownId === id) { shownId = null; screen.setSource(0, null); if (ads.length) show(ads[0].id); else setState('Grey screen'); }
  else if (ads.length) show(ads[0].id);
  renderTray();
}

function clearAds(): void {
  for (const a of [...ads]) removeAd(a.id);
  $('stream').innerHTML = '<p class="idle">Add two ads and press <b>Start the show</b>, or up to eight for a bracket.</p>';
  $('thinkStatus').textContent = 'waiting for two ads';
}

async function fileToSource(url: string, isVideo: boolean): Promise<Source> {
  if (isVideo) {
    const v = document.createElement('video');
    v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('video did not load in 10 s; this browser may not decode it')), 10_000);
      v.onloadeddata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error('cannot decode video')); };
    });
    return v;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

async function addAds(items: { url: string; name: string; video: boolean }[], at?: number): Promise<void> {
  if (mode === 'judge') { toast('The show is on. Stop it first.'); return; }
  const replacing = at !== undefined && ads[at] !== undefined;
  const room = MAX_ADS - ads.length + (replacing ? 1 : 0);
  if (room <= 0) { toast(`The line-up holds ${MAX_ADS} contestants. Remove one first.`); return; }
  if (items.length > room) toast(`Only room for ${room} more; the line-up holds ${MAX_ADS}.`);
  let first = true;
  for (const it of items.slice(0, room)) {
    try {
      const source = await fileToSource(it.url, it.video);
      const ad: Ad = { id: Math.random().toString(36).slice(2, 8), name: it.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 28), source, video: it.video, url: it.url, frameMs: EXPOSURE_MS };
      if (first && replacing) { URL.revokeObjectURL(ads[at!].url); ads[at!] = ad; }
      else if (first && at !== undefined && at <= ads.length) ads.splice(at, 0, ad);
      else ads.push(ad);
      first = false;
      resetGame();
      show(ad.id);
    } catch (err) { toast(`${it.name}: ${err instanceof Error ? err.message : err}`); }
  }
  renderTray();
}

function acceptFiles(files: FileList | File[], at?: number): void {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (!list.length) { toast('Drop an image or a video.'); return; }
  void addAds(list.map((f) => ({ url: URL.createObjectURL(f), name: f.name, video: f.type.startsWith('video/') })), at);
}

// ---- sample gallery ----------------------------------------------------------------------
async function loadSamples(): Promise<Sample[]> {
  if (samples) return samples;
  const r = await fetch('/samples/index.json');
  if (!r.ok) throw new Error(`samples: ${r.status}`);
  samples = (await r.json()) as Sample[];
  return samples;
}
function renderGallery(): void {
  const el = $('gallery');
  if (!samples) return;
  const room = MAX_ADS - ads.length;
  const inLineup = new Set(ads.map((a) => a.url.split('/').pop()));
  const groups: [string, string, Sample[]][] = [
    ['Real ads, public domain', 'Posters and print ads from 1891 to 1921, from Wikimedia Commons.', samples.filter((s) => s.kind === 'vintage')],
    ['Modern mock ads', 'Made for this project, for fictional brands. Different layouts, different colour strategies.', samples.filter((s) => s.kind === 'mock')],
  ];
  el.innerHTML = `<div class="gallery-head"><div><span class="kicker">Sample ads</span><h2>Pick your contestants</h2><p>Tick two for a duel or up to ${MAX_ADS} for a bracket, then start the show. The fly cannot read, so the year does not matter to it.</p></div><button type="button" class="icon-button" id="galleryClose" aria-label="Close">✕</button></div>
    <div class="gallery-body">${groups.map(([title, sub, list]) => `<section><h3>${title} <small>${sub}</small></h3><div class="gallery-grid">${list.map((s) => {
      const picked = galleryPicks.has(s.file), used = inLineup.has(s.file);
      return `<button type="button" class="sample ${picked ? 'picked' : ''} ${used ? 'used' : ''}" data-file="${s.file}" ${used ? 'disabled' : ''} title="${escapeHtml(s.note)}"><span class="thumb"><img src="/samples/${s.file}" alt="" loading="lazy"></span><span class="meta"><span class="name">${escapeHtml(s.name)}</span><span class="note">${escapeHtml(s.note)}</span></span><span class="check">${picked ? '✓' : used ? 'in' : ''}</span></button>`;
    }).join('')}</div></section>`).join('')}</div>
    <div class="gallery-foot"><span class="count" id="galleryCount"></span><div class="actions"><button type="button" class="secondary-button" id="gallerySurprise">Surprise me</button><button type="button" class="primary-button" id="galleryAdd"></button></div></div>`;
  const n = galleryPicks.size;
  $('galleryCount').textContent = n === 0 ? `${room} ${room === 1 ? 'seat' : 'seats'} left in the line-up` : `${n} picked · ${Math.max(0, room - n)} ${room - n === 1 ? 'seat' : 'seats'} left`;
  const add = $<HTMLButtonElement>('galleryAdd');
  add.textContent = n === 0 ? 'Pick some ads' : `Add ${n} to the line-up`;
  add.disabled = n === 0;
  el.querySelectorAll<HTMLButtonElement>('.sample').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.file!;
    if (galleryPicks.has(f)) galleryPicks.delete(f);
    else if (galleryPicks.size >= room) { toast(`Only ${room} ${room === 1 ? 'seat' : 'seats'} left. Remove a contestant to add more.`); return; }
    else galleryPicks.add(f);
    renderGallery();
  }));
  $('galleryClose').addEventListener('click', closeGallery);
  $('gallerySurprise').addEventListener('click', () => {
    galleryPicks.clear();
    const free = samples!.filter((s) => !inLineup.has(s.file)).sort(() => Math.random() - 0.5);
    for (const s of free.slice(0, Math.min(2, room))) galleryPicks.add(s.file);
    renderGallery();
  });
  add.addEventListener('click', () => { void addPicked(); });
}
async function openGallery(): Promise<void> {
  if (mode === 'judge') return;
  try { await loadSamples(); } catch (err) { toast(`Could not load the samples: ${err instanceof Error ? err.message : err}`); return; }
  if (ads.length >= MAX_ADS) { toast(`The line-up is full (${MAX_ADS}). Remove a contestant first.`); return; }
  galleryPicks.clear();
  renderGallery();
  $('gallery').hidden = false;
  $('hero').hidden = true;
}
function closeGallery(): void { $('gallery').hidden = true; $('hero').hidden = ads.length > 0; }
async function addPicked(): Promise<void> {
  const list = samples!.filter((s) => galleryPicks.has(s.file));
  closeGallery();
  await addAds(list.map((s) => ({ url: `/samples/${s.file}`, name: s.name.replace(/ \((mock|\d{4}s?)\)$/, ''), video: false })));
  if (ads.length >= 2) toast(ads.length > 2 ? `${ads.length} in the line-up. Start the bracket when ready.` : 'Two contestants. Start the show when ready.');
}

// ---- judging ----------------------------------------------------------------------------
const prep = document.createElement('canvas');
prep.width = SCREEN_W; prep.height = SCREEN_H;
const prepCtx = prep.getContext('2d', { willReadFrequently: true })!;

function grabFrame(src: Source): Uint8ClampedArray {
  prepCtx.fillStyle = '#808080';
  prepCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  fitInto(prepCtx, src, { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H });
  return prepCtx.getImageData(0, 0, SCREEN_W, SCREEN_H).data;
}

async function captureFrames(ad: Ad, seconds = 2, fps = 20): Promise<{ frames: Uint8ClampedArray[]; frameMs: number }> {
  if (!ad.video) return { frames: [grabFrame(ad.source)], frameMs: EXPOSURE_MS };
  const v = ad.source as HTMLVideoElement;
  v.pause();
  const frameMs = Math.round(1000 / fps / 10) * 10;
  const n = Math.max(1, Math.floor(Math.min(seconds, v.duration || seconds) * 1000 / frameMs));
  const frames: Uint8ClampedArray[] = [];
  for (let k = 0; k < n; k++) {
    await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = (k * frameMs) / 1000 + 0.001; });
    frames.push(grabFrame(v));
  }
  v.currentTime = 0;
  return { frames, frameMs };
}

/** The visitor's call before the fly's. Resolves with an ad id, or null for skip. */
function askHuman(): Promise<string | null> {
  return new Promise((resolve) => {
    const el = $('pick');
    const many = ads.length > 2;
    el.innerHTML = `<span class="kicker">Human vs fly</span><h2>${many ? 'Who takes the bracket?' : 'Which one would you buy?'}</h2><p>Call it before the fly does. This device keeps score.</p>
      <div class="choices">${ads.map((a, i) => `<button type="button" class="choice" data-pick="${a.id}" style="--c:var(--c${i % contestantColors.length})"><span class="thumb">${a.video ? `<video src="${a.url}" muted playsinline></video>` : `<img src="${a.url}" alt="">`}</span><span class="letter">${letter(i)}</span><span class="name">${escapeHtml(a.name)}</span></button>`).join('')}</div>
      <button type="button" class="text-button" data-pick="">Skip, just let the fly decide</button>`;
    el.hidden = false;
    el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => { el.hidden = true; resolve(b.dataset.pick || null); }));
  });
}

async function startShow(rerun = false): Promise<void> {
  if (!ads.length || mode === 'judge' || !settled) return;
  if (!rerun && ads.length > 1) humanPick = await askHuman();
  clearVerdict();
  $('stream').innerHTML = '';
  for (const a of ads) a.frames = undefined;   // the visitor may have moved or resized an ad since
  if (ads.length > 2) {
    bracket = buildBracket(ads.map((a) => a.id));
    const m = nextMatch(bracket)!;
    renderBracket();
    await runMatch([adById(m.a)!, adById(m.b)!]);
  } else {
    bracket = null;
    await runMatch(ads.slice());
  }
}

async function runMatch(list: Ad[]): Promise<void> {
  mode = 'judge';
  matchAds = list;
  clearVerdict();
  houseLights(false);
  $('studio').hidden = true; $('studioButton').setAttribute('aria-expanded', 'false');
  $('judgeButton').hidden = true; $('stopButton').hidden = false; $('hint').hidden = true;
  $('thinkStatus').textContent = 'preparing frames';
  setState('On air', 'judging');
  bug.wander(1);
  for (const a of ads) if (a.video) (a.source as HTMLVideoElement).pause();
  const payload: JudgeAd[] = [];
  judgeFrames = new Map();
  const perm = permutation(JUDGE_SEED);
  for (const ad of ads) if (!ad.frames) { const { frames, frameMs } = await captureFrames(ad); ad.frames = frames; ad.frameMs = frameMs; }
  const pool = ads.map((a) => a.frames![Math.floor(a.frames!.length / 2)]);   // the feed is made of everyone
  for (const ad of list) {
    const frames = ad.frames!;
    judgeFrames.set(`${ad.id}:ad`, frames);
    judgeFrames.set(`${ad.id}:scramble`, frames.map((f) => scramble(f, perm)));
    judgeFrames.set(`${ad.id}:flat`, [flat(frames[Math.floor(frames.length / 2)])]);
    const feed = frames.map((f, k) => composeFeed(f, pool, JUDGE_SEED + 13 * indexOf(ad.id) + (k === 0 ? 0 : 0)));
    judgeFrames.set(`${ad.id}:feed`, feed);
    payload.push({ id: ad.id, name: ad.name, frames: frames.map((f) => f.slice().buffer), frameMs: ad.frameMs, feed: { frames: feed.map((f) => f.slice().buffer), rect: FEED_RECT } });
  }
  for (let i = 0; i < list.length; i++)
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const L = list[i].frames!, R = list[j].frames!, n = Math.max(L.length, R.length);
      const frames: Uint8ClampedArray[] = [];
      for (let k = 0; k < n; k++) frames.push(composePair(L[Math.min(L.length - 1, k)], R[Math.min(R.length - 1, k)]));
      judgeFrames.set(`pair:${list[i].id}:${list[j].id}`, frames);
    }
  narrator = new Narrator(list.map((a) => ({ id: a.id, name: a.name, video: a.video })));
  if (bracket) {
    const el = document.createElement('div'); el.className = 'line match';
    el.textContent = `${roundName(bracket, bracket.ri)} · ${list.map((a) => a.name).join(' vs ')}`;
    $('stream').append(el);
  }
  renderTray();
  $('thinkStatus').textContent = bracket ? `on air · match ${bracket.played + 1} of ${bracket.total}` : 'on air';
  inFlight = true;    // the worker owns the clock until judge-done
  send({ type: 'judge', ads: payload, exposureMs: EXPOSURE_MS, seed: JUDGE_SEED }, payload.flatMap((p) => [...p.frames, ...(p.feed?.frames ?? [])]));
}

function finishMatch(): void {
  const v = narrator!.verdict();
  if (bracket && v.winner) {
    const m = bracket.rounds[bracket.ri][bracket.mi];
    m.winner = v.winner.id;
    bracket.played++;
    const next = nextMatch(bracket);
    renderBracket();
    if (next) {
      // stamps only, then straight into the next match
      playVerdict(false);
      renderTray();
      window.setTimeout(() => { if (mode === 'judge') void runMatch([adById(next.a)!, adById(next.b)!]); }, 2600);
      return;
    }
  }
  mode = 'look';
  inFlight = false;
  $('judgeButton').hidden = false; $('stopButton').hidden = true;
  playVerdict(true);
  setState(bracket ? 'Champion' : 'Verdict', 'verdict');
  renderTray();
}

function endJudge(aborted: boolean): void {
  mode = 'look';
  inFlight = false;
  $('judgeButton').hidden = false; $('stopButton').hidden = true;
  if (aborted) { resetGame(); if (shownId) show(shownId); else if (ads.length) show(ads[0].id); }
  setState('Looking', 'live');
  renderTray();
}

function enqueue(lines: Line[]): void {
  typeQueue.push(...lines);
  if (!typing) void typeNext();
}

let lastKind: Line['kind'] | null = null;
async function typeNext(): Promise<void> {
  typing = true;
  const stream = $('stream'), caption = $('caption'), captionText = $('captionText');
  while (typeQueue.length) {
    const line = typeQueue.shift()!;
    lastKind = line.kind;
    const el = document.createElement('div');
    el.className = `line ${line.kind}`;
    const body = document.createElement('span');
    el.innerHTML = line.kind === 'verdict' ? '' : `<time>${(line.flyMs / 1000).toFixed(1)}s</time>`;
    el.append(body);
    const text = line.text;
    const onStage = line.kind === 'measure' || line.kind === 'verdict';
    const quick = !!bracket && !(bracket.played + 1 >= bracket.total);   // hurry through early matches
    if (onStage) {
      caption.hidden = false;
      const fast = quick || text.length > 160;
      const step = fast ? 4 : 2;
      for (let i = 0; i <= text.length; i += step) {
        captionText.innerHTML = `${escapeHtml(text.slice(0, i))}<span class="cursor"></span>`;
        await new Promise((r) => setTimeout(r, fast ? 5 : 12));
      }
      captionText.textContent = text;
    }
    body.textContent = text;
    stream.append(el);
    stream.scrollTop = stream.scrollHeight;
    if (line.kind === 'verdict') finishMatch();
    if (line.kind === 'measure') await new Promise((r) => setTimeout(r, quick ? 200 : 500));
    if (line.kind === 'note' && verdictShown) caption.hidden = true;
  }
  typing = false;
  // The worker only waits after a measurement, so only a drained measurement releases it.
  if (mode === 'judge' && lastKind === 'measure') send({ type: 'judge-continue' });
}

// ---- main loop ----------------------------------------------------------------------------
function tick(): void {
  requestAnimationFrame(tick);
  const now = performance.now();
  const wallDt = Math.min(100, now - lastWall);
  lastWall = now;
  frameCount++;
  if (now - fpsWall > 1000) { $('fps').textContent = `${frameCount} fps`; frameCount = 0; fpsWall = now; }
  if (!settled) return;
  if (mode === 'judge') { screen.paintFlyScreen(); screen.render(); eye.render(); return; }
  screen.render();
  eye.render();
  if (!playing || inFlight) return;
  const image = screen.paintFlyScreen();
  const flyMs = Math.max(10, Math.min(MAX_ADVANCE_MS, Math.round((wallDt * speed) / 10) * 10));
  inFlight = true;
  if (image) { const copy = image.data.slice().buffer; send({ type: 'frame', rgba: copy }, [copy]); }
  else if (screen.override) { const copy = screen.override.data.slice().buffer; send({ type: 'frame', rgba: copy }, [copy]); }
  else send({ type: 'frame', rgba: null });
  send({ type: 'advance', ms: flyMs, budgetMs: BUDGET_MS });
}

let recentSpikes = 0;
function onSnapshot(snap: Snapshot): void {
  const now = performance.now();
  if (mode === 'look') inFlight = false;
  eye.update(snap.activity, snap.rate, snap.hasBaseline ? snap.glance : null);
  screen.setGlance(snap.glance);
  if (snap.showing) {
    const s = snap.showing;
    const key = s.variant === 'pair' ? `pair:${s.adId}:${s.pairWith}` : s.variant === 'grey' ? null : `${s.adId}:${s.variant}`;
    const frames = key ? judgeFrames.get(key) : null;
    const next = frames ? new ImageData(frames[Math.min(frames.length - 1, s.frameIndex)].slice(), SCREEN_W, SCREEN_H) : null;
    if ((next === null) !== (screen.override === null) || (next && screen.override && s.frameIndex === 0 && next.data[0] !== screen.override.data[0])) screen.resetGlance();
    screen.override = next;
  }
  recentSpikes = recentSpikes * Math.exp(-snap.advancedMs / 60) + snap.spikes;
  const spikes = calmSpikes.push(recentSpikes, now);
  if (spikes !== null) $('liveSpikes').textContent = Math.round(spikes).toLocaleString('en-US');
  $('timeValue').textContent = `${fmt(snap.flyMs / 1000)} s`;
  const ratio = snap.advancedMs / Math.max(1, snap.wallMs);
  const el = $('simSpeed');
  el.textContent = `${ratio.toFixed(1)}× fly time`;
  el.classList.toggle('warn', mode === 'look' && ratio < speed * 0.8);
  updateMeters(snap, now);
}

worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ready':
      types = msg.types;
      for (let i = 0; i < circuit.n; i++) typeCount.set(circuit.type[i], (typeCount.get(circuit.type[i]) ?? 0) + 1);
      send({ type: 'settle', settleMs: 500, measureMs: 500 });
      setState('Taking the resting pulse');
      break;
    case 'settled':
      settled = true;
      $('eyeLoading').hidden = true;
      screen.resetGlance();
      bug.wander(0.45);
      setState(ads.length ? 'Looking' : 'Grey screen', ads.length ? 'live' : '');
      renderTray();
      break;
    case 'snapshot': onSnapshot(msg); break;
    case 'judge-step': case 'judge-measure': case 'judge-pair':
      if (narrator) enqueue(narrator.lines(msg));
      stageFor(msg);
      if (msg.type === 'judge-measure' || msg.type === 'judge-pair') { renderBoard(); renderTray(); }
      break;
    case 'judge-done':
      if (narrator) { enqueue(narrator.lines(msg)); renderBoard(); }
      $('thinkStatus').textContent = `${(msg.flyMs / 1000).toFixed(1)} s of fly time in ${(msg.wallMs / 1000).toFixed(0)} s`;
      break;
    case 'judge-aborted':
      if (narrator) enqueue(narrator.lines(msg));
      $('thinkStatus').textContent = 'stopped';
      endJudge(true);
      break;
    case 'error': toast(`Eye error: ${msg.message}`); inFlight = false; break;
  }
};

// ---- share ---------------------------------------------------------------------------------
const cardFilename = () => `swat-or-buy-${(lastCard?.winner.name ?? 'verdict').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
async function ensureCanvas(): Promise<HTMLCanvasElement | null> {
  if (lastCanvas) return lastCanvas;
  if (!lastCard) return null;
  lastCanvas = await renderCard(lastCard);
  return lastCanvas;
}
function updateShareCount(): void {
  const n = xLength($<HTMLTextAreaElement>('shareText').value);
  $('shareCount').textContent = `${n} / 280 for X`;
  $('shareCount').classList.toggle('over', n > 280);
}
async function openShare(): Promise<void> {
  const cv = await ensureCanvas();
  if (!cv) { toast('No verdict to share yet.'); return; }
  const dlg = $<HTMLDialogElement>('share');
  const small = document.createElement('canvas'); small.width = 800; small.height = 420; small.getContext('2d')!.drawImage(cv, 0, 0, 800, 420);
  $<HTMLImageElement>('shareImg').src = small.toDataURL('image/jpeg', 0.88);
  $<HTMLTextAreaElement>('shareText').value = lastPost;
  updateShareCount();
  $('shareNets').innerHTML = NETWORKS.map((n) => `<button type="button" class="net ${n.id}" data-net="${n.id}"><i></i>${n.label}</button>`).join('');
  $('shareNets').querySelectorAll<HTMLButtonElement>('[data-net]').forEach((b) => b.addEventListener('click', () => {
    const net = NETWORKS.find((n) => n.id === b.dataset.net)!;
    window.open(net.url($<HTMLTextAreaElement>('shareText').value, SITE_URL), '_blank', 'noopener');
  }));
  $('shareNative').hidden = !hasNativeShare();
  dlg.showModal();
  dlg.querySelector('.dialog-body')!.scrollTop = 0;
}
function wireShare(): void {
  $('shareButton').addEventListener('click', () => { void openShare(); });
  $('shareClose').addEventListener('click', () => $<HTMLDialogElement>('share').close());
  $('shareText').addEventListener('input', updateShareCount);
  $('shareCopyText').addEventListener('click', async () => { try { await copyText($<HTMLTextAreaElement>('shareText').value); toast('Post copied.'); } catch (e) { toast((e as Error).message); } });
  $('shareCopyImg').addEventListener('click', async () => { const cv = await ensureCanvas(); if (!cv) return; try { await copyImage(cv); toast('Card copied. Paste it into your post.'); } catch (e) { toast(`${(e as Error).message}. Use Save PNG instead.`); } });
  $('shareSave').addEventListener('click', async () => { const cv = await ensureCanvas(); if (cv) download(cv, cardFilename()); });
  $('shareNative').addEventListener('click', async () => { const cv = await ensureCanvas(); if (!cv) return; try { const r = await shareNative($<HTMLTextAreaElement>('shareText').value, cv, cardFilename()); if (r === 'unsupported') toast('This browser has no share sheet. Use the buttons above.'); } catch (e) { toast((e as Error).message); } });
}

// ---- boot ---------------------------------------------------------------------------------
async function acceptQuery(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const srcs = q.getAll('src').slice(0, MAX_ADS);
  if (!srcs.length) return;
  let names = new Map<string, string>();
  try { names = new Map((await loadSamples()).map((s) => [s.file, s.name.replace(/ \((mock|\d{4}s?)\)$/, '')])); } catch { /* not a sample */ }
  await addAds(srcs.map((u) => { const f = u.split('/').pop() || 'ad'; return { url: u, name: names.get(f) ?? f, video: /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) }; }));
  if (q.has('judge')) {
    const wait = () => (settled ? startShow(q.get('judge') === 'skip') : setTimeout(wait, 200));
    wait();
  }
}

async function boot(): Promise<void> {
  try { circuit = await loadCircuit(); }
  catch (err) { $('eyeLoading').textContent = `Could not load the circuit: ${err instanceof Error ? err.message : err}`; return; }
  screen = new ScreenView(screenCanvas, circuit);
  eye = new EyeRenderer(eyeCanvas, circuit);
  bug = new FlyBug(viewport);
  buildRightCard();
  const fit = () => { screen.resize(viewport.clientWidth, viewport.clientHeight); eye.resize($('eyeView').clientWidth, $('eyeView').clientHeight); };
  new ResizeObserver(fit).observe(viewport);
  new ResizeObserver(fit).observe($('eyeView'));
  fit();
  send({ type: 'init', circuit: toData(circuit), dtMs: DT_MS });

  eye.onPick = (p) => {
    const tag = $('neuronTag');
    if (!p) { tag.hidden = true; return; }
    tag.hidden = false;
    tag.innerHTML = `<strong>${p.type} · ${p.side === 'L' ? 'left' : p.side === 'R' ? 'right' : '?'} eye</strong><span>${p.role} cell · ${fmt(p.rateHz)} Hz right now</span><span>MaleCNS body ${p.bodyId}</span>`;
    setTimeout(() => { tag.hidden = true; }, 6000);
  };
  for (const id of ['filePick', 'filePickMore']) $<HTMLInputElement>(id).addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.files) acceptFiles(t.files); t.value = ''; });
  $('sampleButton').addEventListener('click', () => { void openGallery(); });
  $('galleryButton').addEventListener('click', () => { void openGallery(); });
  ['dragenter', 'dragover'].forEach((ev) => viewport.addEventListener(ev, (e) => { e.preventDefault(); viewport.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => viewport.addEventListener(ev, (e) => { e.preventDefault(); viewport.classList.remove('is-over'); }));
  viewport.addEventListener('drop', (e) => { if (e.dataTransfer?.files.length) acceptFiles(e.dataTransfer.files); });
  document.addEventListener('paste', (e) => { const f = e.clipboardData?.files; if (f?.length) acceptFiles(f); });
  $('heatToggle').addEventListener('click', () => { screen.showHeat = !screen.showHeat; $('heatToggle').setAttribute('aria-pressed', String(screen.showHeat)); });
  $('visionToggle').addEventListener('click', () => { screen.flyVision = !screen.flyVision; $('visionToggle').setAttribute('aria-pressed', String(screen.flyVision)); $('visionNote').hidden = !screen.flyVision; });
  $('studioButton').addEventListener('click', () => { const s = $('studio'); s.hidden = !s.hidden; $('studioButton').setAttribute('aria-expanded', String(!s.hidden)); });
  document.addEventListener('pointerdown', (e) => { const t = e.target as HTMLElement; if (!$('studio').hidden && !t.closest('#studio') && !t.closest('#studioButton')) { $('studio').hidden = true; $('studioButton').setAttribute('aria-expanded', 'false'); } });
  $('playButton').addEventListener('click', () => { playing = !playing; $('playButton').textContent = playing ? 'Pause' : 'Resume'; });
  $('resetButton').addEventListener('click', () => { if (mode === 'judge') return; settled = false; $('eyeLoading').hidden = false; send({ type: 'settle', settleMs: 500, measureMs: 500 }); setState('Taking the resting pulse'); });
  $('judgeButton').addEventListener('click', () => { void startShow(); });
  $('rematchButton').addEventListener('click', () => { void startShow(true); });
  $('newButton').addEventListener('click', () => { if (mode !== 'judge') clearAds(); });
  $('cardButton').addEventListener('click', async () => {
    const cv = await ensureCanvas();
    if (!cv) { toast('No verdict to save yet.'); return; }
    download(cv, cardFilename());
  });
  wireShare();
  $('stopButton').addEventListener('click', () => send({ type: 'abort' }));
  const speedInput = $<HTMLInputElement>('speed');
  speedInput.addEventListener('input', () => { speed = Number(speedInput.value); $('speedValue').textContent = `${speed.toFixed(2)}×`; });
  const about = $<HTMLDialogElement>('about');
  for (const id of ['aboutButton', 'aboutButton2']) $(id).addEventListener('click', () => { about.showModal(); about.querySelector('.dialog-body')!.scrollTop = 0; });
  $('creditsButton').addEventListener('click', () => { about.showModal(); const h = [...about.querySelectorAll('h3')].find((el) => el.textContent === 'Credits'); h?.scrollIntoView({ block: 'start' }); });
  $('aboutClose').addEventListener('click', () => about.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !about.open) about.showModal();
    if (e.key === ' ' && document.activeElement === viewport && mode === 'look' && ads.length) { e.preventDefault(); void startShow(); }
  });
  renderTray();
  requestAnimationFrame(tick);
  void acceptQuery();
}

void boot();
