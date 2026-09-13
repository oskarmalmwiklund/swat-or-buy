/**
 * Leaky integrate-and-fire eye circuit, a dense-step port of the swatorbuy/fly kernel
 * (Bananflugakompassen / Stonkfly, MIT). Same constants, same signed weights, same
 * photoreceptor drive and lamina bias; the only difference is the fixed timestep, which
 * the reference kernel sets at 0.1 ms and this one lets you choose (0.1 to 1 ms).
 *
 * Nothing here is measured fly physiology. Photoreceptors and lamina cells are graded
 * in a real fly; here they are spiking proxies.
 */

import { type Circuit, SCREEN_H, SCREEN_W } from './circuit';
import { FLY_LUMA, LINEAR } from './spectral';

export const MODEL = {
  membraneTauMs: 20,
  synapseTauMs: 5,
  delayMs: 1.8,
  refractoryMs: 2.2,
  restMv: -52,
  thresholdMv: -45,
  laminaBiasMv: 12,
  receptorGainMv: 30,
  receptorHalf: 0.02,
  luminanceTauMs: 10,
  activityTauMs: 60,
  rateTauMs: 150,
} as const;

// R1-R6 weight the screen's primaries by the Rh1 pigment's sensitivity (see spectral.ts);
// the weights sum to one, so greyscale stimuli drive the eye exactly as they did under
// human luminance and the reference-rate test still holds.
const LUMA = FLY_LUMA;

export class EyeBrain {
  readonly n: number;
  readonly dt: number;
  private readonly a: number;          // membrane decay per step
  private readonly b: number;          // synaptic decay per step
  private readonly gGain: number;      // tau_s / (tau_m - tau_s)
  private readonly delaySteps: number;
  private readonly refractorySteps: number;
  private readonly v: Float32Array;
  private readonly g: Float32Array;
  private readonly refractory: Int16Array;
  private readonly drive: Float32Array;
  private readonly light: Float32Array;       // low-passed receptor input, per neuron (0 for non-receptors)
  private readonly target: Float32Array;      // current frame's receptor input
  private readonly sampleX: Int32Array;
  private readonly sampleY: Int32Array;
  private readonly queue: Int32Array[];
  private readonly queueCount: Int32Array;
  private readonly rest: number;
  /** Recent activity per cell, decays with activityTauMs. For drawing. */
  readonly activity: Float32Array;
  /** Running firing rate per cell in Hz, exponential window rateTauMs. */
  readonly rate: Float32Array;
  /** Spike count per cell since the last resetCounts(). */
  readonly counts: Int32Array;
  private readonly recent: Int32Array;      // spikes within the current advance() call
  step = 0;
  totalSpikes = 0;

  constructor(readonly circuit: Circuit, dtMs = 0.5) {
    if (![0.1, 0.2, 0.25, 0.5, 1].includes(dtMs)) throw new Error('dt must be 0.1, 0.2, 0.25, 0.5 or 1 ms');
    this.n = circuit.n;
    this.dt = dtMs;
    this.a = Math.exp(-dtMs / MODEL.membraneTauMs);
    this.b = Math.exp(-dtMs / MODEL.synapseTauMs);
    this.gGain = MODEL.synapseTauMs / (MODEL.membraneTauMs - MODEL.synapseTauMs);
    this.delaySteps = Math.max(1, Math.round(MODEL.delayMs / dtMs));
    this.refractorySteps = Math.max(1, Math.round(MODEL.refractoryMs / dtMs));
    this.rest = MODEL.restMv;
    this.v = new Float32Array(this.n).fill(this.rest);
    this.g = new Float32Array(this.n);
    this.refractory = new Int16Array(this.n);
    this.drive = new Float32Array(this.n);
    this.light = new Float32Array(this.n);
    this.target = new Float32Array(this.n);
    this.sampleX = new Int32Array(this.n);
    this.sampleY = new Int32Array(this.n);
    this.activity = new Float32Array(this.n);
    this.rate = new Float32Array(this.n);
    this.counts = new Int32Array(this.n);
    this.recent = new Int32Array(this.n);
    this.queue = Array.from({ length: this.delaySteps + 1 }, () => new Int32Array(this.n));
    this.queueCount = new Int32Array(this.delaySteps + 1);
    for (let i = 0; i < this.n; i++) {
      if (circuit.driveChannel[i] > 0) {
        this.sampleX[i] = Math.min(SCREEN_W - 1, Math.floor(circuit.driveU[i] * (SCREEN_W - 1)));
        this.sampleY[i] = Math.min(SCREEN_H - 1, Math.floor(circuit.driveV[i] * (SCREEN_H - 1)));
      }
      if (circuit.bias[i]) this.drive[i] = MODEL.laminaBiasMv;
    }
  }

  reset(): void {
    this.v.fill(this.rest);
    this.g.fill(0);
    this.refractory.fill(0);
    this.light.fill(0);
    this.target.fill(0);
    this.activity.fill(0);
    this.rate.fill(0);
    this.counts.fill(0);
    this.queueCount.fill(0);
    this.step = 0;
    this.totalSpikes = 0;
    for (let i = 0; i < this.n; i++) this.drive[i] = this.circuit.bias[i] ? MODEL.laminaBiasMv : 0;
  }

  resetCounts(): void {
    this.counts.fill(0);
  }

  /** Copy of the dynamical state, so several presentations can start from one settled brain. */
  snapshot(): { v: Float32Array; g: Float32Array; refractory: Int16Array; light: Float32Array; target: Float32Array;
    queue: Int32Array[]; queueCount: Int32Array; activity: Float32Array; rate: Float32Array; step: number } {
    return {
      v: this.v.slice(), g: this.g.slice(), refractory: this.refractory.slice(), light: this.light.slice(), target: this.target.slice(),
      queue: this.queue.map((q) => q.slice()), queueCount: this.queueCount.slice(), activity: this.activity.slice(), rate: this.rate.slice(), step: this.step,
    };
  }

  restore(s: ReturnType<EyeBrain['snapshot']>): void {
    this.v.set(s.v); this.g.set(s.g); this.refractory.set(s.refractory); this.light.set(s.light); this.target.set(s.target);
    s.queue.forEach((q, k) => this.queue[k].set(q)); this.queueCount.set(s.queueCount);
    this.activity.set(s.activity); this.rate.set(s.rate); this.step = s.step;
    this.counts.fill(0);
    for (let i = 0; i < this.n; i++) if (this.circuit.driveChannel[i]) this.drive[i] = (MODEL.receptorGainMv * this.light[i]) / (MODEL.receptorHalf + this.light[i]);
  }

  /** Small seeded voltage perturbation, the same trick the full pipeline uses for trial noise. */
  perturb(sigmaMv: number, seed: number): void {
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 0; i < this.n; i++) {
      if (this.refractory[i]) continue;
      const u = Math.max(1e-9, rnd()), w = rnd();
      this.v[i] += sigmaMv * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
    }
  }

  /** Set the screen contents. `rgba` is 320x180x4 sRGB bytes; a uniform grey if null. */
  setFrame(rgba: Uint8ClampedArray | Uint8Array | null, greyLevel = 128): void {
    const c = this.circuit;
    const greyLin = LINEAR[greyLevel];
    for (let i = 0; i < this.n; i++) {
      const ch = c.driveChannel[i];
      if (!ch) continue;
      if (!rgba) { this.target[i] = greyLin; continue; }
      const p = (this.sampleY[i] * SCREEN_W + this.sampleX[i]) * 4;
      if (ch === 1) this.target[i] = LINEAR[rgba[p]] * LUMA[0] + LINEAR[rgba[p + 1]] * LUMA[1] + LINEAR[rgba[p + 2]] * LUMA[2];
      else if (ch === 2) this.target[i] = LINEAR[rgba[p + 2]];
      else this.target[i] = LINEAR[rgba[p + 1]];
    }
  }

  /** Advance `ms` of fly time (a multiple of dt). Returns spikes in the interval. */
  advance(ms: number): number {
    const steps = Math.round(ms / this.dt);
    // Receptor input is low-passed once per call, as the reference kernel does per chunk.
    const k = 1 - Math.exp(-ms / MODEL.luminanceTauMs);
    const c = this.circuit;
    for (let i = 0; i < this.n; i++) {
      if (!c.driveChannel[i]) continue;
      const L = (this.light[i] += k * (this.target[i] - this.light[i]));
      this.drive[i] = (MODEL.receptorGainMv * L) / (MODEL.receptorHalf + L);
    }
    this.recent.fill(0);
    let spikes = 0;
    for (let s = 0; s < steps; s++) spikes += this.integrate();
    const decay = Math.exp(-ms / MODEL.activityTauMs);
    const rateDecay = Math.exp(-ms / MODEL.rateTauMs);
    const perSpikeHz = (1 - rateDecay) * (1000 / ms);
    for (let i = 0; i < this.n; i++) {
      this.activity[i] *= decay;
      this.rate[i] = this.rate[i] * rateDecay + this.recent[i] * perSpikeHz;
    }
    this.totalSpikes += spikes;
    return spikes;
  }

  private integrate(): number {
    const n = this.n, v = this.v, g = this.g, refractory = this.refractory, drive = this.drive;
    const a = this.a, b = this.b, gk = this.gGain * (a - b), rest = this.rest, thr = MODEL.thresholdMv;
    const slots = this.delaySteps + 1;
    const now = this.step % slots;                       // spikes fired delaySteps ago land now
    const future = (this.step + this.delaySteps) % slots;
    const fired = this.queue[future];
    let firedCount = 0;
    for (let i = 0; i < n; i++) {
      if (refractory[i] > 0) { refractory[i]--; continue; }
      const vi = rest + (v[i] - rest) * a + drive[i] * (1 - a) + g[i] * gk;
      g[i] *= b;
      if (vi > thr) {
        fired[firedCount++] = i;
        this.counts[i]++;
        this.recent[i]++;
        this.activity[i] = 1;
      } else v[i] = vi;
    }
    // deliver spikes that have travelled the synaptic delay
    const arriving = this.queue[now], nArrive = this.queueCount[now];
    const offsets = this.circuit.offsets, targets = this.circuit.targets, weights = this.circuit.weights;
    for (let q = 0; q < nArrive; q++) {
      const i = arriving[q];
      for (let e = offsets[i]; e < offsets[i + 1]; e++) {
        const j = targets[e];
        if (refractory[j] === 0) g[j] += weights[e];
      }
    }
    this.queueCount[now] = 0;
    // reset the cells that fired this step
    for (let q = 0; q < firedCount; q++) {
      const i = fired[q];
      v[i] = rest; g[i] = 0; refractory[i] = this.refractorySteps;
    }
    this.queueCount[future] = firedCount;
    this.step++;
    return firedCount;
  }
}
