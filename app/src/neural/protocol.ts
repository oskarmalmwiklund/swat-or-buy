import type { CircuitData, CircuitManifest } from './circuit';

export interface Rect { x: number; y: number; w: number; h: number }

/** One creative prepared for judging: 320x180 RGBA frames, each shown for frameMs. */
export interface JudgeAd {
  id: string;
  name: string;
  frames: ArrayBuffer[];
  frameMs: number;
  /** The same ad dropped into a busy mock feed, with the rectangle it occupies. */
  feed?: { frames: ArrayBuffer[]; rect: Rect };
}

export type Variant = 'ad' | 'scramble' | 'flat' | 'feed';

export interface Metrics {
  /** mean |Δ rate| over L1-L3 cells vs grey, steady state (last half of the exposure), Hz */
  glance: number;
  /** fraction of lamina columns changed more than twice the mean */
  hotFraction: number;
  /** 95th percentile change over the mean change */
  peakRatio: number;
  /** share of the lamina change carried by the left eye, 0..1 */
  leftShare: number;
  /** glance per 100 ms window over the exposure */
  series: number[];
  /** last window over the peak window: 1 means no fading */
  hold: number;
  /** blue-channel (R8p) minus green-channel (R8y) receptor rate change, Hz */
  blueMinusGreen: number;
  /** mean window-to-window change of glance over its mean; 0 for a still */
  motion: number;
  /** mean receptor rate during the exposure, Hz (brightness proxy) */
  receptorHz: number;
  /** share of the lamina change inside a given screen rectangle (feed variant), 0..1 */
  regionShare?: number;
}

export type WorkerCommand =
  | { type: 'init'; circuit: CircuitData; dtMs?: number }
  | { type: 'reset' }
  | { type: 'settle'; settleMs: number; measureMs: number }
  | { type: 'frame'; rgba: ArrayBuffer | null }
  | { type: 'advance'; ms: number; budgetMs: number }
  | { type: 'perturb'; sigmaMv: number; seed: number }
  | { type: 'judge'; ads: JudgeAd[]; exposureMs: number; seed: number }
  | { type: 'judge-continue' }
  | { type: 'abort' };

export interface Snapshot {
  type: 'snapshot';
  flyMs: number;
  advancedMs: number;
  spikes: number;
  wallMs: number;
  activity: Float32Array;
  rate: Float32Array;
  glance: Float32Array;
  glanceMeanHz: number;
  ratePerType: Float32Array;
  hasBaseline: boolean;
  /** during judging: which prepared frame the fly is looking at right now */
  showing?: { adId: string | null; variant: Variant | 'pair' | 'grey'; frameIndex: number; pairWith?: string | null };
}

export type JudgeEvent =
  | { type: 'judge-step'; step: 'settle' | 'baseline' | 'show' | 'pair'; adId?: string; variant?: Variant; left?: string; right?: string; flyMs: number; baselineLaminaHz?: number }
  | { type: 'judge-measure'; adId: string; variant: Variant; metrics: Metrics; flyMs: number }
  | { type: 'judge-pair'; left: string; right: string; leftShare: number; flyMs: number }
  | { type: 'judge-done'; flyMs: number; wallMs: number }
  | { type: 'judge-aborted' };

export type WorkerEvent =
  | { type: 'ready'; manifest: CircuitManifest; types: string[]; dtMs: number }
  | { type: 'reset' }
  | { type: 'settled'; baselineRate: Float32Array; flyMs: number }
  | Snapshot
  | JudgeEvent
  | { type: 'error'; message: string };
