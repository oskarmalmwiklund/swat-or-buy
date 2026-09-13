"""Presentation protocols: solo, pair, tournament.

Every protocol: settle the brain on grey, snapshot, then from that snapshot show the grey
baseline once and the stimulus (and each control) several times with jitter. Scores are
stimulus minus baseline. The brain state is restored after each trial, so trials are
independent and the whole run is deterministic for a given seed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .readouts import Populations, Recorder, Trace, evaluate, motion_direction, salience_map
from .stimuli import BLANK, CHUNK_MS, JITTERS, Clip, control_clips, jitter, pair_clip

SETTLE_MS = 500
VOLTAGE_NOISE_MV = 0.5


class Fly:
    """One MaleCNS brain with frozen weights, plus the bookkeeping to show it clips."""

    def __init__(self, tonic: np.ndarray | None = None):
        from .fly.visual import VisualMemoryBrain

        t0 = time.perf_counter()
        self.brain = VisualMemoryBrain(tonic=tonic)
        self.brain.weights_frozen = True
        self.pops = Populations.build(self.brain)
        self.recorder = Recorder(self.brain, self.pops)
        self.load_seconds = time.perf_counter() - t0
        self._snap = None

    # -- state -------------------------------------------------------------------------
    def snapshot(self):
        b = self.brain
        self._snap = ({k: getattr(b, k).copy() for k in b.fields}, b.cursor)

    def restore(self):
        fields, cursor = self._snap
        b = self.brain
        for k, v in fields.items():
            getattr(b, k)[:] = v
        b.cursor = cursor
        b.sim_ms = cursor * b.dt

    def settle(self, ms: int = SETTLE_MS):
        """Start every experiment from the same fresh brain: reset, then grey for ``ms``."""
        self.brain.reset()
        for _ in range(ms // CHUNK_MS):
            self.brain.rgb_step(BLANK, CHUNK_MS, learning=False)
        self.snapshot()

    def perturb(self, rng: np.random.Generator, sigma_mv: float = VOLTAGE_NOISE_MV):
        b = self.brain
        free = b.refractory == 0
        b.v[free] += rng.normal(0, sigma_mv, int(free.sum())).astype(np.float32)

    # -- showing ------------------------------------------------------------------------
    def show(self, clip: Clip) -> Trace:
        self.recorder.reset()
        for frame in clip.frames:
            for _ in range(clip.frame_ms // CHUNK_MS):
                counts, _ = self.brain.rgb_step(frame, CHUNK_MS, learning=False)
                self.recorder.record_chunk(counts, CHUNK_MS)
        return self.recorder.trace()

    def baseline(self, ms: int) -> Trace:
        self.restore()
        return self.show(Clip.still(BLANK, ms, "baseline"))

    def trial(self, clip: Clip, k: int, rng: np.random.Generator) -> Trace:
        dx, dy, gain = JITTERS[k % len(JITTERS)]
        self.restore()
        if k > 0:
            self.perturb(rng)
        return self.show(clip.map(lambda f: jitter(f, dx, dy, gain)) if k > 0 else clip)


@dataclass
class Scored:
    """Readout samples for one clip against a shared baseline."""

    name: str
    samples: dict[str, list[float]]
    direction: dict[str, float]
    salience: np.ndarray | None = None
    trace_summary: dict = field(default_factory=dict)

    def mean(self, key: str) -> float:
        return float(np.mean(self.samples[key]))


def score(fly: Fly, clip: Clip, base: Trace, trials: int, rng: np.random.Generator, with_map: bool = False) -> Scored:
    samples: dict[str, list[float]] = {}
    direction = None
    salience = None
    first = None
    for k in range(trials):
        t = fly.trial(clip, k, rng)
        for key, val in evaluate(t, base, fly.pops).items():
            samples.setdefault(key, []).append(val)
        if k == 0:
            first = t
            direction = motion_direction(t, base, fly.pops)
            if with_map:
                salience = salience_map(t, base, fly.pops)
    summary = {
        "spikes_total": int(first.spikes.sum()),
        "optic_rate_hz": float(first.chunk_rate["optic"].mean()),
        "central_rate_hz": float(first.chunk_rate["central"].mean()),
        "valence_mv": float(first.valence.mean()),
    }
    return Scored(clip.name, samples, direction, salience, summary)


def solo(fly: Fly, clip: Clip, trials: int = 5, controls: list[str] | None = None,
         seed: int = 0, progress=None) -> dict:
    """Show one ad and its null controls. Returns a plain dict (see report.py for schema)."""
    rng = np.random.default_rng(seed)
    t0 = time.perf_counter()
    fly.settle()
    base = fly.baseline(clip.total_ms)
    ad = score(fly, clip, base, trials, rng, with_map=True)
    if progress:
        progress("ad", 1)
    ctrl_clips = control_clips(clip, rng, controls) if controls is None or controls else {}
    ctrl: dict[str, Scored] = {}
    for i, (name, c) in enumerate(ctrl_clips.items()):
        ctrl[name] = score(fly, c, base, trials, rng)
        if progress:
            progress(name, i + 2)
    return {
        "protocol": "solo",
        "clip": {"name": clip.name, "frames": len(clip.frames), "frame_ms": clip.frame_ms,
                 "total_ms": clip.total_ms, "video": clip.is_video},
        "trials": trials,
        "seed": seed,
        "ad": ad,
        "controls": ctrl,
        "baseline": {"spikes_total": int(base.spikes.sum()), "valence_mv": float(base.valence.mean()),
                     "optic_rate_hz": float(base.chunk_rate["optic"].mean())},
        "wall_seconds": time.perf_counter() - t0,
    }


def pair(fly: Fly, a: Clip, b: Clip, trials: int = 5, seed: int = 0, progress=None) -> dict:
    """Two ads side by side, both orders. The ``turn`` readout is positive toward the left
    of the screen, so A's steering score is turn(A left) minus turn(A right), halved.
    Salience mass on each half says where the optic lobe changed more."""
    rng = np.random.default_rng(seed)
    t0 = time.perf_counter()
    fly.settle()
    ab, ba = pair_clip(a, b), pair_clip(b, a)
    base = fly.baseline(ab.total_ms)
    s_ab = score(fly, ab, base, trials, rng, with_map=True)
    if progress:
        progress("A|B", 1)
    s_ba = score(fly, ba, base, trials, rng, with_map=True)
    if progress:
        progress("B|A", 2)
    half = s_ab.salience.shape[1] // 2

    def mass(m: np.ndarray, left: bool) -> float:
        return float(m[:, :half].sum() if left else m[:, half:].sum())

    total_ab = s_ab.salience.sum() or 1.0
    total_ba = s_ba.salience.sum() or 1.0
    salience_a = 0.5 * (mass(s_ab.salience, True) / total_ab + mass(s_ba.salience, False) / total_ba)
    turn_a = [0.5 * (x - y) for x, y in zip(s_ab.samples["turn"], s_ba.samples["turn"])]
    per_readout = {}
    for key in s_ab.samples:
        if key == "turn":
            continue
        # readout when A is on the left vs when B is on the left, both orders; not a
        # per-ad number since both ads are on screen, kept for the report
        per_readout[key] = {"ab": s_ab.samples[key], "ba": s_ba.samples[key]}
    return {
        "protocol": "pair",
        "a": a.name, "b": b.name,
        "trials": trials, "seed": seed,
        "turn_toward_a": turn_a,
        "salience_share_a": salience_a,
        "readouts": per_readout,
        "maps": {"ab": s_ab.salience, "ba": s_ba.salience},
        "frames": {"ab": ab.representative(), "ba": ba.representative()},
        "wall_seconds": time.perf_counter() - t0,
    }


def tournament(fly: Fly, clips: list[Clip], trials: int = 3, seed: int = 0, progress=None) -> dict:
    """Every ordered pair, then Bradley-Terry ratings from salience share and steering."""
    from .stats import bradley_terry

    n = len(clips)
    wins_sal = np.zeros((n, n))
    wins_turn = np.zeros((n, n))
    pairs = []
    k = 0
    for i in range(n):
        for j in range(i + 1, n):
            r = pair(fly, clips[i], clips[j], trials, seed + k)
            k += 1
            if progress:
                progress(f"{clips[i].name} vs {clips[j].name}", k)
            share = r["salience_share_a"]
            wins_sal[i, j] += share
            wins_sal[j, i] += 1 - share
            t = float(np.mean(r["turn_toward_a"]))
            wins_turn[i, j] += 1.0 if t > 0 else 0.0 if t < 0 else 0.5
            wins_turn[j, i] += 1.0 if t < 0 else 0.0 if t > 0 else 0.5
            pairs.append({"a": clips[i].name, "b": clips[j].name, "salience_share_a": share,
                          "turn_toward_a": t})
    return {
        "protocol": "tournament",
        "names": [c.name for c in clips],
        "pairs": pairs,
        "rating_salience": bradley_terry(wins_sal).tolist(),
        "rating_turn": bradley_terry(wins_turn).tolist(),
    }
