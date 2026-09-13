/**
 * Sharing a verdict. Social networks take text and a link from a share button, never an
 * image, so the post is pre-written with the result and the site link (which unfurls with
 * the site's preview image), and the verdict card travels separately: copied to the
 * clipboard, downloaded, or handed to the device share sheet where the browser supports
 * sharing files.
 */
import type { AdResult } from './narrator';

export const SITE_URL = 'https://swat-or-buy.vercel.app';
export const HASHTAG = '#SwatOrBuy';

export interface PostInput {
  winner: AdResult;
  loser: AdResult | null;
  bracketSize: number | null;          // contestants in the bracket, or null for a duel
  human: { picked: string; agreed: boolean } | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** X counts every link as 23 characters. */
export function xLength(text: string): number { return text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length; }

/** The pre-written post. Optional sentences are dropped, least important first, until it fits X. */
export function buildPost(p: PostInput): string {
  const w = p.winner, l = p.loser;
  const opener = p.bracketSize && p.bracketSize > 2
    ? `I put ${p.bracketSize} ads in front of a fruit fly’s eye (29,195 real neurons). ${w.name} won the bracket.`
    : l ? `I showed two ads to a fruit fly’s eye (29,195 real neurons). ${w.name} got the BUY, ${l.name} got swatted.`
    : `I showed an ad to a fruit fly’s eye (29,195 real neurons). ${w.name}: ${w.layoutShare > 0.5 ? 'BUY' : 'SWAT'}.`;
  const layout = l ? ` ${pct(w.layoutShare)} of the fly’s reaction to it was layout, against ${pct(l.layoutShare)}.` : '';
  const human = p.human ? (p.human.agreed ? ' I called it right.' : ` I picked ${p.human.picked}; the fly disagreed.`) : '';
  const tail = ` The fly cannot read.\n\nTry yours: ${SITE_URL} ${HASHTAG}`;
  for (const parts of [[layout, human], [human], [layout], []]) {
    const s = opener + parts.join('') + tail;
    if (xLength(s) <= 280) return s;
  }
  return opener + tail;
}

export interface Network { id: string; label: string; url: (text: string, url: string) => string }

export const NETWORKS: Network[] = [
  { id: 'x', label: 'X', url: (t) => `https://x.com/intent/post?text=${encodeURIComponent(t)}` },
  { id: 'linkedin', label: 'LinkedIn', url: (t) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(t)}` },
  { id: 'bluesky', label: 'Bluesky', url: (t) => `https://bsky.app/intent/compose?text=${encodeURIComponent(t)}` },
  { id: 'threads', label: 'Threads', url: (t) => `https://www.threads.net/intent/post?text=${encodeURIComponent(t)}` },
  { id: 'whatsapp', label: 'WhatsApp', url: (t) => `https://wa.me/?text=${encodeURIComponent(t)}` },
  { id: 'facebook', label: 'Facebook', url: (t, u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}&quote=${encodeURIComponent(t)}` },
  { id: 'reddit', label: 'Reddit', url: (t, u) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t.split('\n')[0].slice(0, 280))}` },
  { id: 'email', label: 'Email', url: (t) => `mailto:?subject=${encodeURIComponent('A fruit fly judged my ads')}&body=${encodeURIComponent(t)}` },
];

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('could not encode the card'))), 'image/png'));
}

export async function copyImage(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(canvas);
  const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!navigator.clipboard?.write || !Item) throw new Error('this browser cannot copy images');
  await navigator.clipboard.write([new Item({ 'image/png': blob })]);
}

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('this browser cannot copy text');
  await navigator.clipboard.writeText(text);
}

/** The device share sheet, with the card attached when the browser allows files. */
export async function shareNative(text: string, canvas: HTMLCanvasElement, filename: string): Promise<'shared' | 'unsupported'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share) return 'unsupported';
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], filename, { type: 'image/png' });
  const withFile: ShareData = { title: 'Swat or Buy', text, files: [file] };
  try {
    if (nav.canShare?.(withFile)) await nav.share(withFile);
    else await nav.share({ title: 'Swat or Buy', text, url: SITE_URL });
    return 'shared';
  } catch (err) {
    if ((err as Error).name === 'AbortError') return 'shared';   // the user closed the sheet
    throw err;
  }
}

export const hasNativeShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
