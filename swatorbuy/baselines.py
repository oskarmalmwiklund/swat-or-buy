"""Pixel statistics the fly must beat. If a fly readout is fully explained by one of these,
the connectome added nothing, and the report should say so."""

from __future__ import annotations

import cv2
import numpy as np

from .stimuli import Clip, luminance


def spectral_residual(frame: np.ndarray, sigma: float = 8.0) -> np.ndarray:
    """Hou & Zhang 2007 spectral residual saliency, on linear luminance, in [0, 1]."""
    y = luminance(frame)
    small = cv2.resize(y, (64, 36), interpolation=cv2.INTER_AREA)
    f = np.fft.fft2(small)
    log_amp = np.log(np.abs(f) + 1e-6)
    residual = log_amp - cv2.blur(log_amp, (3, 3))
    sal = np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(f)))) ** 2
    sal = cv2.GaussianBlur(sal.astype(np.float32), (0, 0), 2.0)
    sal = cv2.resize(sal, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_LINEAR)
    sal = cv2.GaussianBlur(sal, (0, 0), sigma)
    return (sal / sal.max()).astype(np.float32) if sal.max() > 0 else sal.astype(np.float32)


def frame_stats(frame: np.ndarray) -> dict[str, float]:
    y = luminance(frame)
    gx = cv2.Sobel(y, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(y, cv2.CV_32F, 0, 1)
    edges = np.hypot(gx, gy)
    rg = frame[:, :, 0].astype(np.float32) - frame[:, :, 1]
    yb = 0.5 * (frame[:, :, 0].astype(np.float32) + frame[:, :, 1]) - frame[:, :, 2]
    colourfulness = float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))
    half = frame.shape[1] // 2
    return {
        "mean_luminance": float(y.mean()),
        "rms_contrast": float(y.std()),
        "edge_density": float((edges > 0.1).mean()),
        "colourfulness": colourfulness / 255,
        "blue_minus_green": float(frame[:, :, 2].mean() - frame[:, :, 1].mean()) / 255,
        "left_minus_right_luminance": float(y[:, :half].mean() - y[:, half:].mean()),
    }


def clip_stats(clip: Clip) -> dict[str, float]:
    per = [frame_stats(f) for f in clip.frames[:: max(1, len(clip.frames) // 20)]]
    out = {k: float(np.mean([p[k] for p in per])) for k in per[0]}
    if clip.is_video:
        diffs = [np.abs(luminance(clip.frames[i + 1]) - luminance(clip.frames[i])).mean()
                 for i in range(len(clip.frames) - 1)]
        out["motion_energy"] = float(np.mean(diffs))
    else:
        out["motion_energy"] = 0.0
    return out


BASELINE_DESCRIPTIONS = {
    "mean_luminance": "mean linear luminance, 0 to 1",
    "rms_contrast": "standard deviation of linear luminance",
    "edge_density": "fraction of pixels on an edge (Sobel magnitude above 0.1)",
    "colourfulness": "Hasler and Suesstrunk colourfulness, normalised",
    "blue_minus_green": "mean blue minus mean green, the two channels the R8 cells see",
    "left_minus_right_luminance": "luminance imbalance between screen halves",
    "motion_energy": "mean absolute frame-to-frame luminance change (video only)",
}
