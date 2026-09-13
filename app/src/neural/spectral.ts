/**
 * How the screen's three primaries land on the fly's photoreceptors.
 *
 * R1-R6 carry rhodopsin Rh1, which peaks near 480 nm (with a UV shoulder the screen cannot
 * reach) and is almost blind past 600 nm. Weighted against a typical sRGB display's
 * primaries that is roughly 3 % red, 42 % green, 55 % blue, normalised to sum to one so a
 * grey screen gives the same drive as it did under human luminance. R8p (Rh5) reads the blue
 * primary and R8y (Rh6) the green one, as before. Red on screen is therefore nearly dark to
 * this eye: the source of "your red button is grey to a fly".
 *
 * Weights are a rounded reading of published Drosophila spectral sensitivities, not a
 * calibrated display model.
 */
export const FLY_LUMA = [0.03, 0.42, 0.55] as const;

function srgbToLinear(v8: number): number {
  const v = v8 / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
export const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = srgbToLinear(i);

export function linearToSrgb8(y: number): number {
  const s = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** Linear drive on an R1-R6 cell from one sRGB pixel. */
export function flyLuminance(r8: number, g8: number, b8: number): number {
  return LINEAR[r8] * FLY_LUMA[0] + LINEAR[g8] * FLY_LUMA[1] + LINEAR[b8] * FLY_LUMA[2];
}
