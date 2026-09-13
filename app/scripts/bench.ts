/** How fast does the eye run in plain JavaScript? `npm run bench` */
import { readFileSync } from 'node:fs';
import { EyeBrain } from '../src/neural/EyeBrain';
import { parseCircuit, SCREEN_H, SCREEN_W } from '../src/neural/circuit';

const circuit = parseCircuit(JSON.parse(readFileSync(new URL('../public/data/eye-circuit.json', import.meta.url), 'utf8')));
const disc = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
for (let y = 0; y < SCREEN_H; y++)
  for (let x = 0; x < SCREEN_W; x++) {
    const v = (x - 160) ** 2 + (y - 90) ** 2 < 45 * 45 ? 0 : 128, p = (y * SCREEN_W + x) * 4;
    disc[p] = disc[p + 1] = disc[p + 2] = v; disc[p + 3] = 255;
  }
for (const dt of [1, 0.5, 0.25, 0.1]) {
  const brain = new EyeBrain(circuit, dt);
  brain.setFrame(disc);
  for (let t = 0; t < 200; t += 10) brain.advance(10);   // warm up
  const t0 = performance.now();
  let spikes = 0;
  for (let t = 0; t < 1000; t += 10) spikes += brain.advance(10);
  const wall = performance.now() - t0;
  console.log(`dt ${dt} ms: 1000 ms of fly time in ${wall.toFixed(0)} ms wall (${(1000 / wall).toFixed(2)}x real time), ${spikes} spikes`);
}
