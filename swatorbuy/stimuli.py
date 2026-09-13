"""Stimuli: fit ads to the fly's screen, decode video, build null controls and reference clips.

The fly's screen is 320x180 RGB uint8. Fly time equals wall time: a 25 fps video frame
is shown for 40 ms of neural time. Nothing here knows about neurons.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

H, W = 180, 320
GREY = 128
CHUNK_MS = 10
BLANK = np.full((H, W, 3), GREY, dtype=np.uint8)

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"}

# (dx, dy, brightness gain). Trial 0 is the unjittered stimulus. The simulator is
# deterministic; these stand in for trial-to-trial noise, together with a small
# random perturbation of membrane voltages applied by the protocol.
JITTERS = [(0, 0, 1.0), (2, 1, 1.05), (-2, -1, 0.95), (1, -2, 1.03), (-1, 2, 0.97),
           (3, 0, 1.0), (0, 3, 0.98), (-3, 1, 1.02), (2, -3, 0.96), (-2, 2, 1.04)]


@dataclass
class Clip:
    """A sequence of screen frames, each shown for ``frame_ms`` of neural time."""

    frames: list[np.ndarray]
    frame_ms: int
    name: str = "clip"
    source: str = ""

    @classmethod
    def still(cls, frame: np.ndarray, ms: int = 1000, name: str = "still") -> "Clip":
        return cls([frame], int(ms), name)

    @property
    def total_ms(self) -> int:
        return len(self.frames) * self.frame_ms

    @property
    def is_video(self) -> bool:
        return len(self.frames) > 1

    def map(self, fn, name: str | None = None) -> "Clip":
        return Clip([fn(f) for f in self.frames], self.frame_ms, name or self.name, self.source)

    def representative(self) -> np.ndarray:
        return self.frames[len(self.frames) // 2]


def fit(rgb: np.ndarray) -> np.ndarray:
    """Letterbox any RGB image onto the 320x180 grey screen without stretching."""
    rgb = np.asarray(rgb)
    if rgb.ndim == 2:
        rgb = np.repeat(rgb[:, :, None], 3, axis=2)
    if rgb.shape[2] == 4:
        alpha = rgb[:, :, 3:4].astype(np.float32) / 255
        rgb = (rgb[:, :, :3].astype(np.float32) * alpha + GREY * (1 - alpha)).astype(np.uint8)
    h, w = rgb.shape[:2]
    scale = min(W / w, H / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    resized = cv2.resize(rgb[:, :, :3], (nw, nh), interpolation=interp)
    out = BLANK.copy()
    y0, x0 = (H - nh) // 2, (W - nw) // 2
    out[y0:y0 + nh, x0:x0 + nw] = resized
    return out


def load_image(path: str | Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    bgr = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if bgr is None:
        raise ValueError(f"Cannot decode image: {path}")
    if bgr.ndim == 2:
        rgb = bgr
    elif bgr.shape[2] == 4:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGRA2RGBA)
    else:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return fit(rgb)


def load_video(path: str | Path, max_seconds: float = 5.0, max_fps: float = 25.0) -> Clip:
    """Decode a video to screen frames. Fly time equals real time, capped at ``max_seconds``."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {path}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    if not np.isfinite(src_fps) or src_fps <= 0:
        src_fps = 25.0
    fps = min(src_fps, max_fps)
    frame_ms = max(CHUNK_MS, int(round(1000 / fps / CHUNK_MS)) * CHUNK_MS)
    fps = 1000 / frame_ms
    frames: list[np.ndarray] = []
    t_next = 0.0
    index = 0
    while len(frames) * frame_ms < max_seconds * 1000:
        ok, bgr = cap.read()
        if not ok:
            break
        t = index / src_fps
        index += 1
        if t + 1e-9 < t_next:
            continue
        t_next += 1 / fps
        frames.append(fit(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    cap.release()
    if not frames:
        raise ValueError(f"No frames decoded from {path}")
    return Clip(frames, frame_ms, Path(path).stem, str(path))


def load(path: str | Path, max_seconds: float = 5.0, still_ms: int = 1000) -> Clip:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in VIDEO_SUFFIXES:
        return load_video(path, max_seconds=max_seconds)
    if suffix in IMAGE_SUFFIXES:
        return Clip.still(load_image(path), still_ms, path.stem)
    raise ValueError(f"Unsupported file type: {suffix}")


def jitter(frame: np.ndarray, dx: int, dy: int, gain: float) -> np.ndarray:
    if (dx, dy, gain) == (0, 0, 1.0):
        return frame
    shifted = np.roll(frame, (dy, dx), axis=(0, 1))
    return np.clip(shifted.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def _srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float32) / 255
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def luminance(frame: np.ndarray) -> np.ndarray:
    """Linear luminance in [0, 1], the same transform the photoreceptors use."""
    lin = _srgb_to_linear(frame)
    return lin @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _linear_to_srgb8(y: np.ndarray) -> np.ndarray:
    y = np.clip(y, 0, 1)
    s = np.where(y <= 0.0031308, y * 12.92, 1.055 * np.power(y, 1 / 2.4) - 0.055)
    return np.clip(s * 255 + 0.5, 0, 255).astype(np.uint8)


# ---- null controls -------------------------------------------------------------------

def scramble(frame: np.ndarray, rng: np.random.Generator, perm: np.ndarray | None = None) -> np.ndarray:
    """Same pixels, random positions. Preserves the histogram, destroys structure."""
    flat = frame.reshape(-1, 3)
    if perm is None:
        perm = rng.permutation(len(flat))
    return flat[perm].reshape(frame.shape)


def phase_scramble(frame: np.ndarray, rng: np.random.Generator, phase: np.ndarray | None = None) -> np.ndarray:
    """Same amplitude spectrum, random phases. Preserves spatial frequency content."""
    out = np.empty_like(frame)
    if phase is None:
        phase = rng.uniform(-np.pi, np.pi, (H, W))
    for c in range(3):
        f = np.fft.fft2(frame[:, :, c].astype(np.float32))
        g = np.fft.ifft2(np.abs(f) * np.exp(1j * (np.angle(f) + phase))).real
        out[:, :, c] = np.clip(g, 0, 255).astype(np.uint8)
    return out


def blur(frame: np.ndarray, sigma: float = 8.0) -> np.ndarray:
    return cv2.GaussianBlur(frame, (0, 0), sigma)


def greyscale(frame: np.ndarray) -> np.ndarray:
    y = _linear_to_srgb8(luminance(frame))
    return np.repeat(y[:, :, None], 3, axis=2)


def flat(frame: np.ndarray) -> np.ndarray:
    """A uniform screen with the same mean linear luminance."""
    return np.full_like(frame, _linear_to_srgb8(np.asarray(luminance(frame).mean())))


def mirror(frame: np.ndarray) -> np.ndarray:
    return frame[:, ::-1].copy()


def invert(frame: np.ndarray) -> np.ndarray:
    return (255 - frame).astype(np.uint8)


CONTROLS = {
    "scramble": "same pixels, random positions (brightness and colour kept, layout destroyed)",
    "phase_scramble": "same spatial frequencies, random phases (texture kept, objects destroyed)",
    "blur": "Gaussian blur, sigma 8 px (fine detail removed)",
    "greyscale": "colour removed, luminance kept",
    "flat": "uniform grey with the same mean luminance (only brightness kept)",
    "mirror": "left-right mirrored (tests screen-side bias)",
}


def control_clips(clip: Clip, rng: np.random.Generator, names: list[str] | None = None) -> dict[str, Clip]:
    """Build every control version of a clip. Random controls reuse one draw across frames."""
    names = names or list(CONTROLS)
    perm = rng.permutation(H * W)
    phase = rng.uniform(-np.pi, np.pi, (H, W))
    makers = {
        "scramble": lambda f: scramble(f, rng, perm),
        "phase_scramble": lambda f: phase_scramble(f, rng, phase),
        "blur": blur,
        "greyscale": greyscale,
        "flat": flat,
        "mirror": mirror,
        "invert": invert,
    }
    return {n: clip.map(makers[n], f"{clip.name}:{n}") for n in names}


# ---- side by side ----------------------------------------------------------------------

def pair_frame(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """Two ads on one screen. Left half is seen mostly by the left eye and vice versa;
    the eyes overlap in the middle fifth, which the swap protocol cancels."""
    out = BLANK.copy()
    half = W // 2
    for x0, src in ((0, left), (half, right)):
        h, w = src.shape[:2]
        scale = min(half / w, H / h)
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        resized = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_AREA)
        y0 = (H - nh) // 2
        x = x0 + (half - nw) // 2
        out[y0:y0 + nh, x:x + nw] = resized
    return out


def pair_clip(a: Clip, b: Clip) -> Clip:
    n = max(len(a.frames), len(b.frames))
    frame_ms = min(a.frame_ms, b.frame_ms) if (a.is_video or b.is_video) else a.frame_ms
    total = max(a.total_ms, b.total_ms)
    n = max(1, total // frame_ms)

    def at(clip: Clip, i: int) -> np.ndarray:
        t = i * frame_ms
        return clip.frames[min(len(clip.frames) - 1, t // clip.frame_ms)]

    return Clip([pair_frame(at(a, i), at(b, i)) for i in range(n)], frame_ms, f"{a.name}|{b.name}")


# ---- reference stimuli with known real-fly answers ---------------------------------------

def _disc(r: float, cx: float = W / 2, cy: float = H / 2, fg: int = 0, bg: int = GREY) -> np.ndarray:
    f = np.full((H, W, 3), bg, dtype=np.uint8)
    yy, xx = np.mgrid[0:H, 0:W]
    f[(xx - cx) ** 2 + (yy - cy) ** 2 < r * r] = fg
    return f


def looming_disc(ms: int = 500, r0: float = 4, r1: float = 80) -> Clip:
    n = ms // CHUNK_MS
    return Clip([_disc(r0 + (r1 - r0) * i / (n - 1)) for i in range(n)], CHUNK_MS, "looming")


def receding_disc(ms: int = 500, r0: float = 80, r1: float = 4) -> Clip:
    return Clip(looming_disc(ms, r1, r0).frames[::-1], CHUNK_MS, "receding")


def grating(direction: str, ms: int = 500, period: int = 24, speed: int = 3) -> Clip:
    base = np.full((H, W, 3), GREY, dtype=np.uint8)
    xs = np.arange(W)
    base[:, (xs % period) < period // 2] = 255
    base[:, (xs % period) >= period // 2] = 0
    n = ms // CHUNK_MS
    sign = {"right": 1, "left": -1}[direction]
    return Clip([np.roll(base, sign * speed * i, axis=1) for i in range(n)], CHUNK_MS, f"grating_{direction}")


def small_dot(ms: int = 500, r: float = 6) -> Clip:
    n = ms // CHUNK_MS
    return Clip([_disc(r, cx=W * 0.2 + W * 0.6 * i / (n - 1), cy=H / 2) for i in range(n)], CHUNK_MS, "small_dot")


def flash(kind: str, ms: int = 500) -> Clip:
    v = {"on": 255, "off": 0}[kind]
    return Clip.still(np.full((H, W, 3), v, dtype=np.uint8), ms, f"flash_{kind}")


def reference_set() -> dict[str, Clip]:
    disc = Clip.still(_disc(45), 500, "disc")
    rng = np.random.default_rng(7)
    return {
        "grey": Clip.still(BLANK, 500, "grey"),
        "disc": disc,
        "disc_scramble": disc.map(lambda f: scramble(f, rng), "disc_scramble"),
        "looming": looming_disc(),
        "receding": receding_disc(),
        "grating_right": grating("right"),
        "grating_left": grating("left"),
        "small_dot": small_dot(),
        "flash_on": flash("on"),
        "flash_off": flash("off"),
    }
