/**
 * The screen the fly looks at: a 320x180 canvas holding the ad (or two ads side by side),
 * shown scaled up with the lamina's glance map painted over it. In look mode the user can
 * drag the ad and scroll to resize it. In judge mode the worker decides what is on screen
 * and this view just mirrors it.
 *
 * The glance map is smoothed in time and thresholded against the field's own spread, so
 * on a grey screen it is blank and on an ad it marks the columns that stand out, rather
 * than every cell's estimation noise.
 */
import type { Circuit } from '../neural/circuit';
import { SCREEN_H, SCREEN_W } from '../neural/circuit';
import { flyLuminance, linearToSrgb8 } from '../neural/spectral';
import { neuralColors, palette } from '../theme/palette';

export type Source = HTMLImageElement | HTMLVideoElement;

interface Slot { source: Source | null; dx: number; dy: number; scale: number }

const HEAT_FLOOR_HZ = 4;        // never paint a column that changed less than this
const HEAT_REF_HZ = 14;         // full brightness at this change
const GAZE_MIN_HZ = 5;          // no crosshair below this peak

export function sourceSize(src: Source): { w: number; h: number } {
  return src instanceof HTMLVideoElement ? { w: src.videoWidth, h: src.videoHeight } : { w: src.naturalWidth, h: src.naturalHeight };
}

/** Letterbox `src` into `rect` on `ctx`, with optional user offset and zoom. */
export function fitInto(ctx: CanvasRenderingContext2D, src: Source, r: { x: number; y: number; w: number; h: number }, dx = 0, dy = 0, scale = 1): void {
  const { w: sw, h: sh } = sourceSize(src);
  if (!sw || !sh) return;
  const fit = Math.min(r.w / sw, r.h / sh) * scale;
  const w = sw * fit, h = sh * fit;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.drawImage(src, r.x + (r.w - w) / 2 + dx, r.y + (r.h - h) / 2 + dy, w, h);
  ctx.restore();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

export class ScreenView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fly = document.createElement('canvas');
  private readonly flyCtx: CanvasRenderingContext2D;
  private readonly heat = document.createElement('canvas');
  private readonly heatCtx: CanvasRenderingContext2D;
  private readonly sprite = document.createElement('canvas');
  private readonly vision = document.createElement('canvas');
  private readonly visionCtx: CanvasRenderingContext2D;
  private readonly laminaCells: Int32Array;
  private readonly receptorCells: Int32Array;
  /** The pixels currently on the fly's screen, whatever put them there. */
  private pixels: ImageData | null = null;
  /** Draw the screen as the photoreceptors sample it, not as the visitor sees it. */
  flyVision = false;
  slots: Slot[] = [{ source: null, dx: 0, dy: 0, scale: 1 }];
  pair = false;
  showHeat = true;
  /** Lights down: dark surround, no eye-overlap guides. */
  dark = false;
  /** When set, the fly screen shows exactly these pixels (judge mode). */
  override: ImageData | null = null;
  private glance: Float32Array | null = null;
  private smooth: Float32Array | null = null;
  /** Hottest lamina columns, smoothed, in screen [0,1] coordinates. "Where it's looking." */
  gaze: { u: number; v: number; strength: number } | null = null;
  showGaze = true;
  private drag: { id: number; x: number; y: number; slot: number } | null = null;
  private width = 640;
  private height = 360;
  onChange: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly circuit: Circuit) {
    this.ctx = canvas.getContext('2d')!;
    this.fly.width = SCREEN_W; this.fly.height = SCREEN_H;
    this.flyCtx = this.fly.getContext('2d', { willReadFrequently: true })!;
    this.heat.width = SCREEN_W * 2; this.heat.height = SCREEN_H * 2;
    this.heatCtx = this.heat.getContext('2d')!;
    const cells: number[] = [];
    for (let i = 0; i < circuit.n; i++) {
      const t = circuit.typeName(i);
      if ((t === 'L1' || t === 'L2' || t === 'L3') && circuit.uvSource[i] === 2) cells.push(i);
    }
    this.laminaCells = Int32Array.from(cells);
    const rec: number[] = [];
    for (let i = 0; i < circuit.n; i++) if (circuit.driveChannel[i] > 0) rec.push(i);
    this.receptorCells = Int32Array.from(rec);
    this.vision.width = SCREEN_W * 3; this.vision.height = SCREEN_H * 3;
    this.visionCtx = this.vision.getContext('2d')!;
    const S = 64;
    this.sprite.width = this.sprite.height = S;
    const sc = this.sprite.getContext('2d')!;
    const grad = sc.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, neuralColors.lamina);
    grad.addColorStop(0.4, `${neuralColors.lamina}99`);
    grad.addColorStop(1, `${neuralColors.lamina}00`);
    sc.fillStyle = grad;
    sc.fillRect(0, 0, S, S);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  setPair(pair: boolean): void {
    this.pair = pair;
    while (this.slots.length < (pair ? 2 : 1)) this.slots.push({ source: null, dx: 0, dy: 0, scale: 1 });
    if (!pair) this.slots.length = 1;
  }

  setSource(slot: number, source: Source | null): void {
    while (this.slots.length <= slot) this.slots.push({ source: null, dx: 0, dy: 0, scale: 1 });
    this.slots[slot] = { source, dx: 0, dy: 0, scale: 1 };
  }

  get hasSource(): boolean { return this.override !== null || this.slots.some((s) => s.source); }

  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private frame(): { x: number; y: number; w: number; h: number } {
    const pad = this.dark ? 0.86 : 0.9;
    const scale = Math.min(this.width / SCREEN_W, (this.height - 24) / SCREEN_H) * pad;
    const w = SCREEN_W * scale, h = SCREEN_H * scale;
    return { x: (this.width - w) / 2, y: (this.height - h) / 2 - (this.dark ? 8 : 0), w, h };
  }

  private slotRect(i: number): { x: number; y: number; w: number; h: number } {
    if (!this.pair) return { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
    return { x: i * (SCREEN_W / 2), y: 0, w: SCREEN_W / 2, h: SCREEN_H };
  }

  /** Paint the fly's screen and return its pixels for the photoreceptors (null = grey). */
  paintFlyScreen(): ImageData | null {
    const c = this.flyCtx;
    if (this.override) { c.putImageData(this.override, 0, 0); this.pixels = this.override; return null; }
    c.fillStyle = palette.screen;
    c.fillRect(0, 0, SCREEN_W, SCREEN_H);
    let any = false;
    this.slots.forEach((slot, i) => {
      if (!slot.source) return;
      any = true;
      fitInto(c, slot.source, this.slotRect(i), slot.dx, slot.dy, slot.scale);
    });
    this.pixels = any ? c.getImageData(0, 0, SCREEN_W, SCREEN_H) : null;
    return this.pixels;
  }

  /** One dot per photoreceptor at the point it samples: grey for R1-R6 (fly luminance, no
   *  red), blue for R8p, green for R8y. What the eye is actually given. */
  private paintFlyVision(): void {
    const c = this.visionCtx, W = this.vision.width, H = this.vision.height;
    c.fillStyle = '#101010';
    c.fillRect(0, 0, W, H);
    const px = this.pixels?.data ?? null;
    const r = W / 150;
    const cells = this.receptorCells, circ = this.circuit;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k], ch = circ.driveChannel[i];
      const x = Math.min(SCREEN_W - 1, Math.max(0, Math.round(circ.driveU[i] * SCREEN_W))), y = Math.min(SCREEN_H - 1, Math.max(0, Math.round(circ.driveV[i] * SCREEN_H)));
      const p = (y * SCREEN_W + x) * 4;
      const R = px ? px[p] : 128, G = px ? px[p + 1] : 128, B = px ? px[p + 2] : 128;
      if (ch === 1) { const v = linearToSrgb8(flyLuminance(R, G, B)); c.fillStyle = `rgb(${v},${v},${v})`; }
      else if (ch === 2) c.fillStyle = `rgb(${Math.round(B * 0.35)},${Math.round(B * 0.55)},${B})`;
      else c.fillStyle = `rgb(${Math.round(G * 0.3)},${G},${Math.round(G * 0.45)})`;
      c.beginPath(); c.arc(circ.driveU[i] * W, circ.driveV[i] * H, ch === 1 ? r : r * 0.8, 0, Math.PI * 2); c.fill();
    }
  }

  /** Feed a new per-cell change-vs-grey estimate; the map keeps a smoothed copy. */
  setGlance(glance: Float32Array | null): void {
    this.glance = glance;
    if (!glance) { this.smooth = null; return; }
    if (!this.smooth || this.smooth.length !== glance.length) { this.smooth = glance.slice(); return; }
    const s = this.smooth;
    for (let k = 0; k < this.laminaCells.length; k++) { const i = this.laminaCells[k]; s[i] += (glance[i] - s[i]) * 0.1; }
  }

  /** Reset the temporal smoothing, e.g. when the picture changes abruptly. */
  resetGlance(): void { this.smooth = null; this.gaze = null; }

  private paintHeat(): void {
    const h = this.heatCtx, W = this.heat.width, H = this.heat.height;
    h.clearRect(0, 0, W, H);
    const s = this.smooth;
    if (!s || !this.hasSource) { this.gaze = null; return; }
    const cells = this.laminaCells, n = cells.length;
    let sum = 0, sq = 0, peak = 0;
    for (let k = 0; k < n; k++) { const g = s[cells[k]]; sum += g; sq += g * g; if (g > peak) peak = g; }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    const floor = Math.max(HEAT_FLOOR_HZ, mean + 1.5 * sd);
    const span = Math.max(HEAT_REF_HZ, peak) - floor;
    if (peak <= floor || span <= 0) { this.gaze = null; return; }
    // centre of mass of the hottest columns, so the marker sits on a region, not one cell
    if (peak > GAZE_MIN_HZ) {
      let sumW = 0, su = 0, sv = 0;
      for (let k = 0; k < n; k++) {
        const i = cells[k], g = s[i];
        if (g > floor + span * 0.55) { sumW += g; su += g * this.circuit.colU[i]; sv += g * this.circuit.colV[i]; }
      }
      if (sumW > 0) {
        const target = { u: su / sumW, v: sv / sumW, strength: peak };
        this.gaze = this.gaze ? { u: this.gaze.u * 0.85 + target.u * 0.15, v: this.gaze.v * 0.85 + target.v * 0.15, strength: peak } : target;
      }
    } else this.gaze = null;
    h.globalCompositeOperation = 'lighter';
    const radius = W / 34;
    for (let k = 0; k < n; k++) {
      const i = cells[k];
      const g = (s[i] - floor) / span;
      if (g <= 0) continue;
      h.globalAlpha = Math.min(0.78, g * g * 0.9);
      h.drawImage(this.sprite, this.circuit.colU[i] * W - radius, this.circuit.colV[i] * H - radius, radius * 2, radius * 2);
    }
    h.globalAlpha = 1;
    h.globalCompositeOperation = 'source-over';
  }

  render(): void {
    const c = this.ctx, f = this.frame();
    c.fillStyle = this.dark ? palette.stageDark : palette.wash;
    c.fillRect(0, 0, this.width, this.height);
    const r = Math.max(6, f.w * 0.014);
    // a soft glow behind the screen when the lights are down
    c.save();
    c.shadowColor = this.dark ? 'rgba(0,0,0,0.7)' : 'rgba(10,10,10,0.16)';
    c.shadowBlur = this.dark ? 60 : 30;
    c.shadowOffsetY = this.dark ? 18 : 10;
    c.fillStyle = palette.screen;
    roundRect(c, f.x, f.y, f.w, f.h, r); c.fill();
    c.restore();
    c.save();
    roundRect(c, f.x, f.y, f.w, f.h, r); c.clip();
    c.imageSmoothingEnabled = true;
    if (this.flyVision) { this.paintFlyVision(); c.drawImage(this.vision, f.x, f.y, f.w, f.h); }
    else c.drawImage(this.fly, f.x, f.y, f.w, f.h);
    this.paintHeat();
    if (this.showHeat) c.drawImage(this.heat, f.x, f.y, f.w, f.h);
    if (!this.dark && !this.flyVision && this.hasSource) {
      c.strokeStyle = 'rgba(10,10,10,0.28)'; c.setLineDash([3, 6]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(f.x + f.w * 0.4, f.y); c.lineTo(f.x + f.w * 0.4, f.y + f.h); c.moveTo(f.x + f.w * 0.6, f.y); c.lineTo(f.x + f.w * 0.6, f.y + f.h); c.stroke();
      c.setLineDash([]);
    }
    c.restore();
    if (this.showGaze && this.showHeat && this.gaze) {
      const x = f.x + this.gaze.u * f.w, y = f.y + this.gaze.v * f.h, rr = Math.max(10, f.w * 0.035);
      c.save();
      c.strokeStyle = palette.orange; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(x - rr * 1.6, y); c.lineTo(x - rr * 1.1, y); c.moveTo(x + rr * 1.1, y); c.lineTo(x + rr * 1.6, y);
      c.moveTo(x, y - rr * 1.6); c.lineTo(x, y - rr * 1.1); c.moveTo(x, y + rr * 1.1); c.lineTo(x, y + rr * 1.6); c.stroke();
      c.restore();
    }
    c.strokeStyle = this.dark ? 'rgba(255,255,255,0.10)' : 'rgba(10,10,10,0.2)'; c.lineWidth = 1.5;
    roundRect(c, f.x - 0.75, f.y - 0.75, f.w + 1.5, f.h + 1.5, r + 0.75); c.stroke();
  }

  private slotAt(clientX: number): number {
    if (!this.pair) return 0;
    const rect = this.canvas.getBoundingClientRect(), f = this.frame();
    return clientX - rect.left - f.x < f.w / 2 ? 0 : 1;
  }
  private onDown = (e: PointerEvent) => {
    if (this.override || !this.hasSource) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, slot: this.slotAt(e.clientX) };
    this.canvas.setPointerCapture(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const f = this.frame(), k = SCREEN_W / f.w;
    const slot = this.slots[this.drag.slot];
    if (slot) { slot.dx += (e.clientX - this.drag.x) * k; slot.dy += (e.clientY - this.drag.y) * k; }
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    this.onChange?.();
  };
  private onUp = (e: PointerEvent) => {
    if (this.drag?.id !== e.pointerId) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };
  private onWheel = (e: WheelEvent) => {
    if (this.override || !this.hasSource) return;
    e.preventDefault();
    const slot = this.slots[this.slotAt(e.clientX)];
    if (!slot) return;
    slot.scale = Math.min(4, Math.max(0.2, slot.scale * (e.deltaY > 0 ? 0.92 : 1.08)));
    this.onChange?.();
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
