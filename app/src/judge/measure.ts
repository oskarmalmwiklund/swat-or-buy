/** Pure functions the worker uses to turn spike counts into the metrics the fly reasons with. */
import type { Circuit } from '../neural/circuit';
import { SCREEN_H, SCREEN_W } from '../neural/circuit';
import type { Metrics, Rect } from '../neural/protocol';
import { FLY_LUMA, LINEAR, linearToSrgb8 } from '../neural/spectral';

export interface Groups {
  lamina: Int32Array;        // L1-L3 with a column position
  laminaLeft: Uint8Array;    // 1 if that lamina cell belongs to the left eye
  laminaU: Float32Array;     // column screen position, 0..1
  laminaV: Float32Array;
  r8p: Int32Array;
  r8y: Int32Array;
  receptors: Int32Array;
}

export function groups(c: Circuit): Groups {
  const lam: number[] = [], left: number[] = [], u: number[] = [], v: number[] = [], r8p: number[] = [], r8y: number[] = [], rec: number[] = [];
  for (let i = 0; i < c.n; i++) {
    const t = c.typeName(i);
    if ((t === 'L1' || t === 'L2' || t === 'L3') && c.uvSource[i] === 2) { lam.push(i); left.push(c.side[i] === 'L' ? 1 : 0); u.push(c.colU[i]); v.push(c.colV[i]); }
    if (c.driveChannel[i] === 2) r8p.push(i);
    if (c.driveChannel[i] === 3) r8y.push(i);
    if (c.driveChannel[i] > 0) rec.push(i);
  }
  return { lamina: Int32Array.from(lam), laminaLeft: Uint8Array.from(left), laminaU: Float32Array.from(u), laminaV: Float32Array.from(v), r8p: Int32Array.from(r8p), r8y: Int32Array.from(r8y), receptors: Int32Array.from(rec) };
}

function meanRate(counts: Int32Array, cells: Int32Array, seconds: number): number {
  let s = 0;
  for (let k = 0; k < cells.length; k++) s += counts[cells[k]];
  return cells.length ? s / cells.length / seconds : 0;
}

/**
 * @param steady   spike counts over the steady window (last half of the exposure)
 * @param steadySec length of that window in seconds
 * @param base     spike counts over the baseline window on grey
 * @param baseSec  length of the baseline window
 * @param windows  per-cell counts for each 100 ms window of the exposure, lamina only, in order
 * @param region   optional screen rectangle (fly pixels); the share of the change inside it is reported
 */
export function metrics(g: Groups, steady: Int32Array, steadySec: number, base: Int32Array, baseSec: number,
  windows: Int32Array[], windowSec: number, region?: Rect): Metrics {
  const n = g.lamina.length;
  const delta = new Float32Array(n);
  let sum = 0, leftSum = 0, regionSum = 0;
  const rx0 = region ? region.x / SCREEN_W : 0, rx1 = region ? (region.x + region.w) / SCREEN_W : 0;
  const ry0 = region ? region.y / SCREEN_H : 0, ry1 = region ? (region.y + region.h) / SCREEN_H : 0;
  for (let k = 0; k < n; k++) {
    const i = g.lamina[k];
    const d = Math.abs(steady[i] / steadySec - base[i] / baseSec);
    delta[k] = d; sum += d; if (g.laminaLeft[k]) leftSum += d;
    if (region && g.laminaU[k] >= rx0 && g.laminaU[k] < rx1 && g.laminaV[k] >= ry0 && g.laminaV[k] < ry1) regionSum += d;
  }
  const glance = n ? sum / n : 0;
  let hot = 0;
  for (let k = 0; k < n; k++) if (delta[k] > 2 * glance) hot++;
  const sorted = Float32Array.from(delta).sort();
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  const series = windows.map((w) => {
    let s = 0;
    for (let k = 0; k < n; k++) { const i = g.lamina[k]; s += Math.abs(w[i] / windowSec - base[i] / baseSec); }
    return n ? s / n : 0;
  });
  const peak = Math.max(1e-9, ...series);
  const hold = series.length ? series[series.length - 1] / peak : 1;
  let motion = 0;
  for (let k = 1; k < series.length; k++) motion += Math.abs(series[k] - series[k - 1]);
  motion = series.length > 1 && glance > 0 ? motion / (series.length - 1) / glance : 0;
  const blue = meanRate(steady, g.r8p, steadySec) - meanRate(base, g.r8p, baseSec);
  const green = meanRate(steady, g.r8y, steadySec) - meanRate(base, g.r8y, baseSec);
  const out: Metrics = {
    glance, hotFraction: n ? hot / n : 0, peakRatio: glance > 0 ? p95 / glance : 0,
    leftShare: sum > 0 ? leftSum / sum : 0.5, series, hold, blueMinusGreen: blue - green, motion,
    receptorHz: meanRate(steady, g.receptors, steadySec),
  };
  if (region) out.regionShare = sum > 0 ? regionSum / sum : 0;
  return out;
}

/** A small deterministic xorshift generator. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Same pixels, shuffled with a fixed permutation (shared across a video's frames). */
export function permutation(seed: number): Uint32Array {
  const n = SCREEN_W * SCREEN_H;
  const p = new Uint32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const r = rng(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  return p;
}

export function scramble(rgba: Uint8ClampedArray, perm: Uint32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < perm.length; i++) {
    const s = perm[i] * 4, d = i * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = 255;
  }
  return out;
}

/** A uniform screen with the same mean fly luminance. */
export function flat(rgba: Uint8ClampedArray): Uint8ClampedArray {
  let y = 0; const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) y += FLY_LUMA[0] * LINEAR[rgba[i]] + FLY_LUMA[1] * LINEAR[rgba[i + 1]] + FLY_LUMA[2] * LINEAR[rgba[i + 2]];
  const v = linearToSrgb8(y / n);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) { out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255; }
  return out;
}

/** Two 320x180 frames side by side: each shrunk to half width, letterboxed on grey. */
export function composePair(left: Uint8ClampedArray, right: Uint8ClampedArray, grey = 128): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = out[i + 1] = out[i + 2] = grey; out[i + 3] = 255; }
  const half = SCREEN_W / 2, h2 = SCREEN_H / 2, y0 = (SCREEN_H - h2) / 2;
  for (const [src, x0] of [[left, 0], [right, half]] as const) {
    for (let y = 0; y < h2; y++)
      for (let x = 0; x < half; x++) {
        const s = ((y * 2) * SCREEN_W + x * 2) * 4, d = ((y0 + y) * SCREEN_W + x0 + x) * 4;
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2];
      }
  }
  return out;
}

/** The rectangle an ad occupies in the mock feed: half size, centred, a quarter of the screen. */
export const FEED_RECT: Rect = { x: SCREEN_W / 4, y: SCREEN_H / 4, w: SCREEN_W / 2, h: SCREEN_H / 2 };
export const FEED_AREA_SHARE = (FEED_RECT.w * FEED_RECT.h) / (SCREEN_W * SCREEN_H);

/**
 * A busy mock feed: the whole screen tiled with 16x16 blocks drawn at random from every
 * contestant's pixels (so the surround has the same palette and contrast as the ads, but no
 * layout), with `ad` dropped in at half size in the middle. The question the fly then
 * answers is whether the ad still stands out from content that looks like it.
 */
export function composeFeed(ad: Uint8ClampedArray, pool: Uint8ClampedArray[], seed: number, block = 16): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
  const r = rng(seed);
  const bx = SCREEN_W / block, by = SCREEN_H / block;
  for (let j = 0; j < by; j++)
    for (let i = 0; i < bx; i++) {
      const src = pool[Math.floor(r() * pool.length)];
      const sx = Math.floor(r() * bx) * block, sy = Math.floor(r() * by) * block;
      for (let y = 0; y < block; y++)
        for (let x = 0; x < block; x++) {
          const s = ((sy + y) * SCREEN_W + sx + x) * 4, d = ((j * block + y) * SCREEN_W + i * block + x) * 4;
          out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = 255;
        }
    }
  const R = FEED_RECT;
  for (let y = 0; y < R.h; y++)
    for (let x = 0; x < R.w; x++) {
      const s = ((y * 2) * SCREEN_W + x * 2) * 4, d = ((R.y + y) * SCREEN_W + R.x + x) * 4;
      out[d] = ad[s]; out[d + 1] = ad[s + 1]; out[d + 2] = ad[s + 2];
    }
  return out;
}
