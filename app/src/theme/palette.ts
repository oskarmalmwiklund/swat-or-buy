/**
 * Swat or Buy palette, on the Multiply brand. Off-white paper and near-black ink for the
 * studio; a near-black violet ground for the eye. Violet (#9747FF) is the primary and the
 * action colour, yellow is the BUY, orange is the SWAT, pink is the fly thinking.
 * Neural roles: orange-coral for the photoreceptors, aqua for the lamina, yellow for the
 * cells that feed back onto it. Contestants get eight colours of their own so the
 * scoreboard and the bracket never borrow a neural one.
 */
export const palette = {
  paper: '#FBFAF9',
  ink: '#0A0A0A',
  muted: '#5E5B66',
  line: '#E2DFE8',
  wash: '#F1EEF6',
  controlLine: '#8A8494',
  inkHover: '#2A2433',
  violet: '#9747FF',
  violetHover: '#A862FF',
  violetEdge: '#6A2BD0',
  violetInk: '#5B1FB8',
  violetWash: '#EFE6FF',
  yellow: '#FFD400',
  yellowHover: '#FFDE3D',
  yellowEdge: '#C9A600',
  yellowInk: '#6B5800',
  yellowWash: '#FFF6C2',
  orange: '#FE5300',
  orangeHover: '#FF6F2B',
  orangeEdge: '#B83A00',
  orangeInk: '#A33500',
  orangeWash: '#FFE8DC',
  pink: '#FE67EF',
  pinkInk: '#A8299A',
  pinkWash: '#FFE3FB',
  green: '#16A34A',
  focus: '#9747FF',
  brain: '#120C1F',
  brainRaised: '#1F1633',
  brainLine: '#37294F',
  onBrain: '#F3EFF9',
  onBrainMuted: '#A79FBA',
  nodeRest: '#7D7390',
  stageDark: '#0B0714',
  /** The fly's screen at rest: 128 grey, the same value the worker uses for blanks. */
  screen: '#808080',
} as const;

export const neuralColors = {
  receptor: '#FF7B5A',
  lamina: '#56D0DC',
  feedback: '#FFD400',
} as const;

/** Contestant colours A to H, used on the tray, the scoreboard, the bracket and the banners. */
export const contestantColors = [
  { fill: '#FE67EF', ink: '#A8299A' },
  { fill: '#5AD1FF', ink: '#0F6E96' },
  { fill: '#FFD400', ink: '#6B5800' },
  { fill: '#7CE28F', ink: '#1F7A36' },
  { fill: '#FF9F6E', ink: '#A33500' },
  { fill: '#C9B8FF', ink: '#5B1FB8' },
  { fill: '#8AEFE0', ink: '#0E7A6C' },
  { fill: '#FFB3C7', ink: '#A0284F' },
] as const;

export type Role = keyof typeof neuralColors;

export function roleOf(type: string): Role {
  if (type.startsWith('R')) return 'receptor';
  if (/^L[1-5]$/.test(type)) return 'lamina';
  return 'feedback';
}

export function applyPalette(style: Pick<CSSStyleDeclaration, 'setProperty'>): void {
  for (const [key, value] of Object.entries(palette)) {
    const name = key.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
    style.setProperty(`--${name}`, value);
    style.setProperty(`--base-${name}`, value);   // survives the dark-stage overrides
  }
  for (const [key, value] of Object.entries(neuralColors)) style.setProperty(`--role-${key}`, value);
  contestantColors.forEach((c, i) => {
    style.setProperty(`--c${i}`, c.fill);
    style.setProperty(`--c${i}-ink`, c.ink);
  });
}
