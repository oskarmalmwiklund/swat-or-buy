/**
 * The browser kernel must agree with the full-brain Python simulator on the reference
 * stimuli. Rates are compared per cell type at the reference timestep (0.1 ms) and,
 * more loosely, at the timestep the app runs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EyeBrain } from './EyeBrain';
import { parseCircuit, SCREEN_H, SCREEN_W } from './circuit';

const circuit = parseCircuit(JSON.parse(readFileSync(new URL('../../public/data/eye-circuit.json', import.meta.url), 'utf8')));
const reference = JSON.parse(readFileSync(new URL('../../public/data/reference-rates.json', import.meta.url), 'utf8'));

function screen(fill: (x: number, y: number) => number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
  for (let y = 0; y < SCREEN_H; y++)
    for (let x = 0; x < SCREEN_W; x++) {
      const v = fill(x, y), p = (y * SCREEN_W + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = v; rgba[p + 3] = 255;
    }
  return rgba;
}
const STIMULI: Record<string, Uint8ClampedArray> = {
  grey: screen(() => 128),
  white: screen(() => 255),
  black: screen(() => 0),
  disc: screen((x, y) => ((x - 160) ** 2 + (y - 90) ** 2 < 45 * 45 ? 0 : 128)),
  left_black: screen((x) => (x < 160 ? 0 : 128)),
};

function ratesByType(brain: EyeBrain, rgba: Uint8ClampedArray, exposureMs = 500) {
  brain.reset();
  brain.setFrame(null);
  for (let t = 0; t < 500; t += 10) brain.advance(10);
  brain.setFrame(rgba);
  brain.resetCounts();
  for (let t = 0; t < exposureMs; t += 10) brain.advance(10);
  const sum: Record<string, number> = {}, cnt: Record<string, number> = {};
  for (let i = 0; i < brain.n; i++) {
    const t = circuit.typeName(i);
    sum[t] = (sum[t] ?? 0) + brain.counts[i];
    cnt[t] = (cnt[t] ?? 0) + 1;
  }
  const out: Record<string, number> = {};
  for (const t in sum) out[t] = (sum[t] / cnt[t]) * (1000 / exposureMs);
  return out;
}

describe('eye circuit', () => {
  it('has the expected shape', () => {
    expect(circuit.n).toBe(circuit.manifest.neurons);
    expect(circuit.n).toBeGreaterThan(19000);
    expect(circuit.offsets[circuit.n]).toBe(circuit.targets.length);
    expect(circuit.manifest.types).toContain('R1-R6');
    let receptors = 0;
    for (let i = 0; i < circuit.n; i++) if (circuit.driveChannel[i]) receptors++;
    expect(receptors).toBe(3335 + 811);   // 3,335 column-mapped R1-R6 plus 811 R8p/R8y; unmapped receptors get no drive
  });
});

describe('kernel agrees with the full-brain reference', () => {
  const brainRef = new EyeBrain(circuit, 0.1);
  for (const name of Object.keys(STIMULI)) {
    it(`${name}: R1-R6, L1, L2, L3 rates within 12% at dt 0.1 ms`, () => {
      const got = ratesByType(brainRef, STIMULI[name]);
      for (const t of ['R1-R6', 'L1', 'L2', 'L3']) {
        const want = reference.rates[name][t];
        const tol = Math.max(2.5, 0.12 * want);
        expect(Math.abs(got[t] - want), `${name} ${t}: got ${got[t].toFixed(2)} want ${want.toFixed(2)}`).toBeLessThan(tol);
      }
    });
  }

  it('keeps the black-raises-lamina, white-lowers-receptors ordering at the app timestep', () => {
    const brain = new EyeBrain(circuit, 0.5);
    const g = ratesByType(brain, STIMULI.grey), b = ratesByType(brain, STIMULI.black), w = ratesByType(brain, STIMULI.white);
    expect(b['R1-R6']).toBeLessThan(g['R1-R6'] * 0.2);
    expect(w['R1-R6']).toBeGreaterThan(g['R1-R6']);
    expect(b.L1).toBeGreaterThan(g.L1 * 1.3);
    expect(b.L2).toBeGreaterThan(g.L2 * 1.3);
    for (const t of ['R1-R6', 'L1', 'L2', 'L3']) {
      const want = reference.rates.grey[t];
      expect(Math.abs(g[t] - want) / Math.max(want, 1), `grey ${t} at 0.5 ms: ${g[t].toFixed(1)} vs ${want.toFixed(1)}`).toBeLessThan(0.3);
    }
  });

  it('is deterministic', () => {
    const a = new EyeBrain(circuit, 0.5), b = new EyeBrain(circuit, 0.5);
    const ra = ratesByType(a, STIMULI.disc), rb = ratesByType(b, STIMULI.disc);
    expect(ra).toEqual(rb);
    expect(a.totalSpikes).toBe(b.totalSpikes);
  });
});
