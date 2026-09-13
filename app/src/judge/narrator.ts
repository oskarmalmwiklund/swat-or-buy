/**
 * Turns the worker's measurements into the fly's stream of reasoning. Every sentence is
 * tied to a number that was just measured; the voice is first person because it reads
 * better, not because anything here is cognition. The final verdict ranks ads by how much
 * of the lamina's response comes from layout rather than brightness.
 */
import type { JudgeEvent, Metrics, Variant } from '../neural/protocol';
import { FEED_AREA_SHARE } from './measure';

export interface Line { kind: 'step' | 'measure' | 'note' | 'verdict'; text: string; flyMs: number; adId?: string }

export interface AdResult {
  id: string;
  name: string;
  video: boolean;
  metrics: Partial<Record<Variant, Metrics>>;
  pairShare: number[];        // share of the lamina response on this ad's side, one per pairing
  structure: number;          // glance(ad) - glance(scramble), Hz: the layout-driven part
  layoutShare: number;        // structure / glance(ad)
  brightnessOnly: number;     // glance(flat)
  sideBySide: number | null;  // mean pair share
  feedShare: number | null;   // share of the response on the ad when dropped into a busy feed
  pop: number | null;         // feedShare / the screen area the ad covers; 1 means it vanishes into the feed
}

export interface Verdict { ranking: AdResult[]; winner: AdResult | null; summary: string; caveat: string }

const fmt = (x: number, d = 1) => x.toFixed(d);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export class Narrator {
  readonly ads = new Map<string, AdResult>();
  baselineHz = 0;

  constructor(ads: { id: string; name: string; video: boolean }[]) {
    for (const a of ads) this.ads.set(a.id, { ...a, metrics: {}, pairShare: [], structure: 0, layoutShare: 0, brightnessOnly: 0, sideBySide: null, feedShare: null, pop: null });
  }

  name(id?: string | null): string { return (id && this.ads.get(id)?.name) || 'the ad'; }

  lines(e: JudgeEvent): Line[] {
    const out: Line[] = [];
    const push = (kind: Line['kind'], text: string, adId?: string) => out.push({ kind, text, flyMs: 'flyMs' in e ? e.flyMs : 0, adId });
    switch (e.type) {
      case 'judge-step':
        if (e.step === 'settle') push('step', 'Grey screen. Letting my eye settle for half a second so nothing carries over.');
        else if (e.step === 'baseline') {
          this.baselineHz = e.baselineLaminaHz ?? 0;
          push('measure', `Resting. On grey my lamina cells fire at ${fmt(this.baselineHz)} Hz. Everything from here is measured as a change from that.`);
        } else if (e.step === 'show') {
          const n = this.name(e.adId);
          if (e.variant === 'ad') push('step', `Looking at ${n} for one second.`, e.adId);
          else if (e.variant === 'scramble') push('step', `Now the same pixels of ${n}, shuffled. Same brightness and colours, no layout.`, e.adId);
          else if (e.variant === 'flat') push('step', `Now a flat grey as bright as ${n}, on average. Brightness alone.`, e.adId);
          else push('step', `Now ${n} at half size in a busy feed made of everyone's pixels.`, e.adId);
        } else if (e.step === 'pair') push('step', `Both at once: ${this.name(e.left)} in my left eye, ${this.name(e.right)} in my right.`);
        break;
      case 'judge-measure': {
        const r = this.ads.get(e.adId)!;
        r.metrics[e.variant] = e.metrics;
        const m = e.metrics;
        if (e.variant === 'ad') {
          push('measure', `${r.name} moved my first synapse by ${fmt(m.glance, 2)} Hz per cell on average.`, e.adId);
          const where = m.leftShare > 0.58 ? 'mostly on my left' : m.leftShare < 0.42 ? 'mostly on my right' : 'evenly across both eyes';
          push('measure', `${pct(m.hotFraction)} of my columns lit up hard, the hottest ${fmt(m.peakRatio)}× above the average, ${where}.`, e.adId);
          if (r.video || m.motion > 0.25) push('measure', `It keeps changing: window to window my response swings by ${pct(m.motion)} of its mean.`, e.adId);
          push('measure', m.hold > 0.85 ? `After a second I am still at ${pct(m.hold)} of my first reaction. It holds.`
            : m.hold > 0.6 ? `After a second I am down to ${pct(m.hold)} of my first reaction. It fades a little.`
            : `After a second I am down to ${pct(m.hold)} of my first reaction. I am already used to it.`, e.adId);
          if (Math.abs(m.blueMinusGreen) > 3) push('measure', `My ${m.blueMinusGreen > 0 ? 'blue' : 'green'} receptors moved ${fmt(Math.abs(m.blueMinusGreen))} Hz more than the ${m.blueMinusGreen > 0 ? 'green' : 'blue'} ones. I have no red ones.`, e.adId);
        } else if (e.variant === 'scramble') {
          const ad = r.metrics.ad!;
          r.structure = Math.max(0, ad.glance - m.glance);
          r.layoutShare = ad.glance > 0 ? r.structure / ad.glance : 0;
          push('measure', `Shuffled: ${fmt(m.glance, 2)} Hz. So ${pct(r.layoutShare)} of what ${r.name} does to me is layout; the rest is just how bright and how colourful it is.`, e.adId);
        } else if (e.variant === 'flat') {
          r.brightnessOnly = m.glance;
          push('measure', m.glance < 0.5 ? `Flat grey: ${fmt(m.glance, 2)} Hz. Brightness alone barely registers.`
            : `Flat grey: ${fmt(m.glance, 2)} Hz. ${r.name} is bright enough to register even as a blank.`, e.adId);
        } else {
          r.feedShare = m.regionShare ?? null;
          r.pop = r.feedShare === null ? null : r.feedShare / FEED_AREA_SHARE;
          if (r.pop !== null) push('measure', r.pop > 1.5 ? `In the feed, ${pct(r.feedShare!)} of my response landed on ${r.name}, which covers a quarter of my screen. It pops ${fmt(r.pop)}× harder than its surroundings.`
            : r.pop > 0.9 ? `In the feed, ${pct(r.feedShare!)} of my response landed on ${r.name}, about its share of the screen. It blends in.`
            : `In the feed, only ${pct(r.feedShare!)} of my response landed on ${r.name}. The surroundings pull harder than the ad. It disappears.`, e.adId);
        }
        break;
      }
      case 'judge-pair': {
        const L = this.ads.get(e.left)!, R = this.ads.get(e.right)!;
        L.pairShare.push(e.leftShare); R.pairShare.push(1 - e.leftShare);
        push('measure', `${pct(e.leftShare)} of my response landed on ${L.name}'s side, ${pct(1 - e.leftShare)} on ${R.name}'s.`);
        break;
      }
      case 'judge-done': {
        const v = this.verdict();
        push('verdict', v.summary);
        push('note', v.caveat);
        break;
      }
      case 'judge-aborted':
        push('note', 'Stopped. Back to looking.');
        break;
    }
    return out;
  }

  verdict(): Verdict {
    const list = [...this.ads.values()].filter((a) => a.metrics.ad);
    for (const a of list) a.sideBySide = a.pairShare.length ? a.pairShare.reduce((s, x) => s + x, 0) / a.pairShare.length : null;
    const ranking = [...list].sort((a, b) => {
      if (Math.abs(a.structure - b.structure) > 0.1 * Math.max(a.structure, b.structure, 1e-9)) return b.structure - a.structure;
      if (a.sideBySide !== null && b.sideBySide !== null && Math.abs(a.sideBySide - b.sideBySide) > 0.04) return b.sideBySide - a.sideBySide;
      if (a.pop !== null && b.pop !== null && Math.abs(a.pop - b.pop) > 0.15) return b.pop - a.pop;
      return (b.metrics.ad!.hold) - (a.metrics.ad!.hold);
    });
    const caveat = 'I am 29,195 neurons of a fly’s eye and its first synapse. I cannot read, I have no memory of brands, and nothing deeper in the fly’s brain sees layout in this model. This is pre-attentive salience, not persuasion.';
    if (!ranking.length) return { ranking, winner: null, summary: 'Nothing to judge yet.', caveat };
    const w = ranking[0], m = w.metrics.ad!;
    if (ranking.length === 1) {
      const summary = `${w.name}: ${fmt(m.glance, 2)} Hz of first-synapse change, ${pct(w.layoutShare)} of it layout. ` +
        (w.layoutShare > 0.5 ? 'The arrangement matters more than the brightness. ' : 'Most of my reaction is to brightness and colour, not to where things are. ') +
        (w.pop !== null ? (w.pop > 1.5 ? `In a busy feed it pops ${fmt(w.pop)}×. ` : 'In a busy feed it blends in. ') : '') +
        (m.hold > 0.8 ? 'It holds my eye.' : 'It fades fast.');
      return { ranking, winner: w, summary, caveat };
    }
    const r = ranking[1];
    let summary = `${w.name} wins. It changes my lamina more through layout: ${fmt(w.structure, 2)} Hz of its glance is arrangement, against ${fmt(r.structure, 2)} Hz for ${r.name}.`;
    if (w.sideBySide !== null && r.sideBySide !== null) {
      summary += w.sideBySide >= 0.5
        ? ` Side by side it also took ${pct(w.sideBySide)} of my response.`
        : ` Side by side ${r.name} pulled harder (${pct(r.sideBySide)}), but that pull is mostly brightness and colour; shuffle its pixels and it hardly changes.`;
    }
    if (w.pop !== null && r.pop !== null) summary += w.pop >= r.pop ? ` In a busy feed it pops ${fmt(w.pop)}× to ${r.name}'s ${fmt(r.pop)}×.` : ` In a busy feed ${r.name} pops harder (${fmt(r.pop)}× to ${fmt(w.pop)}×), so for a crowded placement, ${r.name}.`;
    const rm = r.metrics.ad!;
    if (rm.hold > m.hold + 0.1) summary += ` ${r.name} holds my eye longer (${pct(rm.hold)} vs ${pct(m.hold)}).`;
    if (ranking.length > 2) summary += ` Then ${ranking.slice(2).map((a) => a.name).join(', ')}.`;
    return { ranking, winner: w, summary, caveat };
  }
}
