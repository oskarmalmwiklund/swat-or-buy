/**
 * The verdict card: a 1200x630 PNG of the face-off with the stamps, the four scores and the
 * human-vs-fly line, for sharing. Drawn on a canvas from the same data the page shows.
 */
import { SCREEN_H, SCREEN_W } from '../neural/circuit';
import { contestantColors, palette } from '../theme/palette';
import type { AdResult } from './narrator';

export interface CardInput {
  frame: Uint8ClampedArray;                 // the face-off frame (or the single ad)
  winner: AdResult;
  loser: AdResult | null;
  winnerIndex: number;                      // contestant index, for colour and which side it sits on
  loserIndex: number;
  human: { pickedWinner: boolean | null; agreed: number; games: number } | null;
  title?: string;                           // e.g. "Bracket champion"
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number, d = 2) => x.toFixed(d);

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/** Shorten `text` with an ellipsis until it fits `maxWidth` in the current font. */
function fit(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (c.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsised if needed. */
function wrap(c: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' '), lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (c.measureText(test).width <= maxWidth || !cur) cur = test;
    else { lines.push(cur); cur = w; if (lines.length === maxLines - 1) break; }
  }
  const used = lines.join(' ').split(' ').filter(Boolean).length;
  const rest = words.slice(used).join(' ');
  if (rest) lines.push(fit(c, rest, maxWidth));
  return lines.slice(0, maxLines);
}

function stamp(c: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, ink: string, edge: string, size: number): void {
  c.save();
  c.translate(x, y); c.rotate(-10 * Math.PI / 180);
  c.font = `800 ${size}px "Bricolage Grotesque Variable", system-ui, sans-serif`;
  const w = c.measureText(text).width + size * 0.6, h = size * 1.2;
  c.fillStyle = edge; roundRect(c, -w / 2, -h / 2 + size * 0.1, w, h, size * 0.18); c.fill();
  c.fillStyle = fill; roundRect(c, -w / 2, -h / 2, w, h, size * 0.18); c.fill();
  c.lineWidth = size * 0.09; c.strokeStyle = ink; roundRect(c, -w / 2, -h / 2, w, h, size * 0.18); c.stroke();
  c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 0, size * 0.04);
  c.restore();
}

export async function renderCard(input: CardInput): Promise<HTMLCanvasElement> {
  try { await Promise.all([document.fonts.load('800 60px "Bricolage Grotesque Variable"'), document.fonts.load('600 20px "DM Sans Variable"')]); } catch { /* system fonts */ }
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = palette.stageDark; c.fillRect(0, 0, W, H);
  // brand
  c.fillStyle = palette.onBrain; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.font = '750 34px "Bricolage Grotesque Variable", system-ui, sans-serif';
  c.fillText('Swat or Buy', 48, 66);
  c.fillStyle = palette.violet; c.fillText('.', 48 + c.measureText('Swat or Buy').width + 2, 66);
  c.fillStyle = palette.onBrainMuted; c.font = '500 16px "DM Sans Variable", system-ui, sans-serif';
  c.fillText(input.title ?? 'Judged by 29,195 real neurons of a fruit fly’s eye', 48, 94);
  // the screen
  const sw = 640, sh = sw * SCREEN_H / SCREEN_W, sx = 48, sy = 124;
  const tmp = document.createElement('canvas'); tmp.width = SCREEN_W; tmp.height = SCREEN_H;
  tmp.getContext('2d')!.putImageData(new ImageData(input.frame.slice(), SCREEN_W, SCREEN_H), 0, 0);
  c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 40; c.shadowOffsetY = 14;
  c.fillStyle = palette.screen; roundRect(c, sx, sy, sw, sh, 14); c.fill(); c.restore();
  c.save(); roundRect(c, sx, sy, sw, sh, 14); c.clip(); c.imageSmoothingEnabled = true; c.drawImage(tmp, sx, sy, sw, sh); c.restore();
  // stamps
  const single = !input.loser;
  const winLeft = input.winnerIndex < input.loserIndex;
  const buyX = single ? sx + sw / 2 : winLeft ? sx + sw * 0.27 : sx + sw * 0.73;
  const swatX = winLeft ? sx + sw * 0.73 : sx + sw * 0.27;
  stamp(c, 'BUY', buyX, sy + sh * 0.5, palette.yellow, palette.ink, palette.yellowEdge, 64);
  if (input.loser) stamp(c, 'SWAT', swatX, sy + sh * 0.5, palette.orange, palette.paper, palette.orangeEdge, 64);
  // names under the screen
  c.font = '650 18px "DM Sans Variable", system-ui, sans-serif'; c.textBaseline = 'alphabetic';
  const nameAt = (r: AdResult, i: number, x: number, align: CanvasTextAlign) => {
    c.textAlign = align; c.fillStyle = contestantColors[i % contestantColors.length].fill;
    c.beginPath(); c.arc(align === 'left' ? x + 7 : x - 7, sy + sh + 32, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = palette.onBrain; c.fillText(fit(c, r.name, sw / 2 - 40), align === 'left' ? x + 22 : x - 22, sy + sh + 38);
  };
  if (single) nameAt(input.winner, input.winnerIndex, sx, 'left');
  else { nameAt(winLeft ? input.winner : input.loser!, winLeft ? input.winnerIndex : input.loserIndex, sx, 'left'); nameAt(winLeft ? input.loser! : input.winner, winLeft ? input.loserIndex : input.winnerIndex, sx + sw, 'right'); }
  // right column: verdict and scores
  const rx = 740, rw = W - rx - 48;
  c.textAlign = 'left';
  c.fillStyle = palette.yellow; c.font = '700 13px "DM Sans Variable", system-ui, sans-serif';
  c.fillText('VERDICT', rx, 150);
  c.fillStyle = palette.onBrain; c.font = '720 40px "Bricolage Grotesque Variable", system-ui, sans-serif';
  c.fillText(fit(c, input.winner.name, rw), rx, 194);
  c.font = '500 18px "DM Sans Variable", system-ui, sans-serif'; c.fillStyle = palette.onBrainMuted;
  const subLines = wrap(c, single ? (input.winner.layoutShare > 0.5 ? 'gets the BUY' : 'gets the swatter') : `gets the BUY. ${input.loser!.name} gets the swatter.`, rw, 2);
  subLines.forEach((l, i) => c.fillText(l, rx, 222 + i * 24));
  const rows: [string, string, string][] = [];
  const m = input.winner.metrics.ad!, lm = input.loser?.metrics.ad;
  rows.push(['Glance', `${fmt(m.glance)} Hz`, lm ? `${fmt(lm.glance)} Hz` : '']);
  rows.push(['Layout', pct(input.winner.layoutShare), input.loser ? pct(input.loser.layoutShare) : '']);
  rows.push(['Hold', pct(m.hold), lm ? pct(lm.hold) : '']);
  if (input.winner.sideBySide !== null) rows.push(['Side by side', pct(input.winner.sideBySide), input.loser?.sideBySide !== null && input.loser ? pct(input.loser.sideBySide!) : '']);
  if (input.winner.pop !== null) rows.push(['In the feed', `${fmt(input.winner.pop, 1)}×`, input.loser?.pop != null ? `${fmt(input.loser.pop, 1)}×` : '']);
  let y = 268 + (subLines.length - 1) * 24;
  c.font = '600 13px "DM Sans Variable", system-ui, sans-serif'; c.fillStyle = palette.onBrainMuted;
  c.textAlign = 'right'; c.fillText('WINNER', rx + rw - (input.loser ? 110 : 0), y); if (input.loser) c.fillText('LOSER', rx + rw, y);
  y += 12;
  for (const [label, a, b] of rows) {
    y += 40;
    c.fillStyle = palette.brainLine; c.fillRect(rx, y - 28, rw, 1);
    c.textAlign = 'left'; c.fillStyle = palette.onBrainMuted; c.font = '600 15px "DM Sans Variable", system-ui, sans-serif'; c.fillText(label, rx, y);
    c.textAlign = 'right'; c.fillStyle = palette.onBrain; c.font = '650 18px "DM Sans Variable", system-ui, sans-serif';
    c.fillText(a, rx + rw - (input.loser ? 110 : 0), y);
    if (b) { c.fillStyle = palette.onBrainMuted; c.fillText(b, rx + rw, y); }
  }
  // human vs fly
  if (input.human && input.human.pickedWinner !== null) {
    y += 52;
    c.textAlign = 'left';
    c.fillStyle = input.human.pickedWinner ? palette.green : palette.orange;
    roundRect(c, rx, y - 22, rw, 44, 10); c.fill();
    c.fillStyle = palette.paper; c.font = '650 16px "DM Sans Variable", system-ui, sans-serif'; c.textBaseline = 'middle';
    c.fillText(fit(c, input.human.pickedWinner ? 'The human agreed with the fly.' : 'The human disagreed with the fly.', rw - 150), rx + 16, y);
    c.textAlign = 'right'; c.font = '500 14px "DM Sans Variable", system-ui, sans-serif';
    c.fillText(`${input.human.agreed} of ${input.human.games} so far`, rx + rw - 16, y);
    c.textBaseline = 'alphabetic';
  }
  // footer
  c.textAlign = 'left'; c.fillStyle = palette.onBrainMuted; c.font = '500 13px "DM Sans Variable", system-ui, sans-serif';
  c.fillText('Retina and lamina of MaleCNS v1.0 (CC BY 4.0). Model activity, not fly behaviour. It cannot read.', 48, H - 36);
  c.textAlign = 'right'; c.fillStyle = palette.onBrain; c.font = '600 14px "DM Sans Variable", system-ui, sans-serif';
  c.fillText('swat-or-buy.vercel.app · an experiment by multiply.co', W - 48, H - 36);
  return canvas;
}

export function download(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}
