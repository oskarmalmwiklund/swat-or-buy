"""Named neuron populations, recording, and the readout registry.

A readout turns a recorded trace of the stimulus and a trace of the grey baseline into
one number. Every readout is an engineered interface onto the model, not fly behaviour.
``level`` says how deep in the brain the population sits:

- ``glance``: photoreceptor and lamina cells. These carry image structure in the current
  model.
- ``deep``: medulla, lobula, mushroom body and descending neurons. Whether these see
  structure at all is decided by the reference-stimulus gate (see ``gate.py``).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .fly.common import annotations
from .stimuli import CHUNK_MS, H, W

APPROACH_MBON = ["MBON07", "MBON09", "MBON11", "MBON12", "MBON13", "MBON14"]
AVOID_MBON = ["MBON01", "MBON03", "MBON04", "MBON05", "MBON06"]

POPULATION_TYPES = {
    "lamina": ["L1", "L2", "L3"],
    "swat": ["LC4", "LPLC2", "LC6", "LC16", "DNp02", "DNp11"],
    "gaze": ["LC10a", "LC10b", "LC10c", "LC10d", "LC11", "LC18"],
    "dna02_L": ["DNa02"],
    "dna02_R": ["DNa02"],
}


@dataclass
class Populations:
    """Index arrays into the brain for every population a readout needs."""

    index: dict[str, np.ndarray]
    column_cells: np.ndarray            # cells with an optic-lobe column assignment, not photoreceptors
    column_uv: np.ndarray               # their screen position in [0, 1]^2
    approach: np.ndarray
    avoid: np.ndarray
    n: int

    @classmethod
    def build(cls, brain) -> "Populations":
        a = annotations(brain.ids)
        types = a.type.fillna("")
        superclass = a.superclass.fillna("")
        side = a.somaSide.fillna(a.rootSide.fillna("")) if "somaSide" in a else a.rootSide.fillna("")
        index: dict[str, np.ndarray] = {}
        for name, tl in POPULATION_TYPES.items():
            mask = types.isin(tl).to_numpy().copy()
            if name.endswith("_L"):
                mask &= side.eq("L").to_numpy()
            if name.endswith("_R"):
                mask &= side.eq("R").to_numpy()
            index[name] = np.flatnonzero(mask).astype(np.int32)
        index["t4t5"] = np.flatnonzero(types.str.match(r"^T[45][abcd]$").to_numpy()).astype(np.int32)
        for sub in "abcd":
            index[f"t4t5_{sub}"] = np.flatnonzero(types.isin([f"T4{sub}", f"T5{sub}"]).to_numpy()).astype(np.int32)
        index["medulla"] = np.flatnonzero(
            (superclass.eq("ol_intrinsic") & ~types.isin(["L1", "L2", "L3", "L4", "L5"])).to_numpy()
        ).astype(np.int32)
        index["vpn"] = np.flatnonzero(superclass.eq("visual_projection").to_numpy()).astype(np.int32)
        index["optic"] = np.flatnonzero(superclass.isin(["ol_intrinsic", "visual_projection"]).to_numpy()).astype(np.int32)
        index["central"] = np.flatnonzero(superclass.eq("cb_intrinsic").to_numpy()).astype(np.int32)
        index["descending"] = np.flatnonzero(superclass.eq("descending_neuron").to_numpy()).astype(np.int32)
        approach = np.flatnonzero(types.isin(APPROACH_MBON).to_numpy()).astype(np.int32)
        avoid = np.flatnonzero(types.isin(AVOID_MBON).to_numpy()).astype(np.int32)
        column_cells, column_uv = _column_projection(brain, a, types)
        return cls(index, column_cells, column_uv, approach, avoid, brain.n)


def _column_projection(brain, a, types):
    """Screen position for every optic-lobe cell with a column assignment, using the same
    per-eye viewport transform the photoreceptors use (see fly/prepare.py)."""
    has = a.assignedOlHex1.notna().to_numpy() & a.assignedOlHex2.notna().to_numpy()
    not_receptor = ~types.str.startswith("R").to_numpy()
    side = a.somaSide.fillna(a.rootSide).fillna("").to_numpy()
    cells = np.flatnonzero(has & not_receptor & np.isin(side, ["L", "R"]))
    h1 = a.assignedOlHex1.to_numpy(dtype=float)[cells]
    h2 = a.assignedOlHex2.to_numpy(dtype=float)[cells]
    xy = np.column_stack([h1 - 0.5 * h2, np.sqrt(3) / 2 * h2])
    from .fly.common import GRAPH

    with np.load(GRAPH) as g:
        oldhex = g["hexes"]
    oldxy = np.column_stack([oldhex[:, 0] - 0.5 * oldhex[:, 1], np.sqrt(3) / 2 * oldhex[:, 1]])
    retina_side = a.rootSide.iloc[brain.retina].to_numpy()
    uv = np.empty_like(xy)
    for s in ["L", "R"]:
        ref = oldxy[retina_side == s]
        lo, span = ref.min(axis=0), np.ptp(ref, axis=0)
        sel = side[cells] == s
        z = (xy[sel] - lo) / span
        uv[sel, 0] = 0.6 * z[:, 0] if s == "L" else 0.4 + 0.6 * (1 - z[:, 0])
        uv[sel, 1] = 1 - z[:, 1]
    keep = np.all((uv >= -0.05) & (uv <= 1.05), axis=1)
    return cells[keep].astype(np.int32), np.clip(uv[keep], 0, 1).astype(np.float32)


@dataclass
class Trace:
    """What was recorded while a clip was shown."""

    spikes: np.ndarray            # per-cell spike count over the whole window
    chunk_rate: dict[str, np.ndarray]   # population -> mean spikes/s per cell, per 10 ms chunk
    valence: np.ndarray           # approach minus avoid MBON voltage above rest, per chunk (mV)
    duration_ms: int

    @property
    def seconds(self) -> float:
        return self.duration_ms / 1000

    def rate(self, cells: np.ndarray) -> float:
        return float(self.spikes[cells].mean() / self.seconds) if len(cells) else 0.0


class Recorder:
    CHUNK_POPS = ["lamina", "medulla", "vpn", "optic", "t4t5", "swat", "gaze", "central", "descending"]

    def __init__(self, brain, pops: Populations):
        self.brain, self.pops = brain, pops
        self.reset()

    def reset(self):
        self.spikes = np.zeros(self.brain.n, dtype=np.int64)
        self.chunks = {k: [] for k in self.CHUNK_POPS}
        self.valence = []
        self.ms = 0

    def record_chunk(self, counts: np.ndarray, chunk_ms: int = CHUNK_MS):
        self.spikes += counts
        s = chunk_ms / 1000
        for k in self.CHUNK_POPS:
            ix = self.pops.index[k]
            self.chunks[k].append(counts[ix].mean() / s if len(ix) else 0.0)
        above = self.brain.v - self.brain.rest
        self.valence.append(float(above[self.pops.approach].mean() - above[self.pops.avoid].mean()))
        self.ms += chunk_ms

    def trace(self) -> Trace:
        return Trace(
            self.spikes.copy(),
            {k: np.asarray(v, dtype=np.float64) for k, v in self.chunks.items()},
            np.asarray(self.valence, dtype=np.float64),
            self.ms,
        )


# ---- readouts -------------------------------------------------------------------------

@dataclass
class Readout:
    name: str
    level: str
    unit: str
    reads_as: str
    fn: callable = field(repr=False)


def _rate_change(pop: str):
    def f(t: Trace, b: Trace, p: Populations) -> float:
        ix = p.index[pop]
        return t.rate(ix) - b.rate(ix)
    return f


def glance(t: Trace, b: Trace, p: Populations) -> float:
    """Mean absolute per-cell rate change in the lamina: how much local contrast structure
    the first synapse sees, regardless of sign."""
    ix = p.index["lamina"]
    return float(np.abs(t.spikes[ix] / t.seconds - b.spikes[ix] / b.seconds).mean())


def buy(t: Trace, b: Trace, p: Populations) -> float:
    return float(t.valence.mean() - b.valence.mean())


def turn(t: Trace, b: Trace, p: Populations) -> float:
    def lr(x: Trace) -> float:
        return x.rate(p.index["dna02_L"]) - x.rate(p.index["dna02_R"])
    return lr(t) - lr(b)


def motion_direction(t: Trace, b: Trace, p: Populations) -> dict[str, float]:
    return {sub: t.rate(p.index[f"t4t5_{sub}"]) - b.rate(p.index[f"t4t5_{sub}"]) for sub in "abcd"}


def boredom(t: Trace, b: Trace, p: Populations) -> float:
    """Habituation: relative slope of optic-lobe firing over the exposure, in fraction per
    second, stimulus minus baseline. Negative means the response decays."""
    def slope(x: Trace) -> float:
        r = x.chunk_rate["optic"]
        if len(r) < 4 or r.mean() <= 0:
            return 0.0
        time = np.arange(len(r)) * CHUNK_MS / 1000
        k = np.polyfit(time, r, 1)[0]
        return float(k / r.mean())
    return slope(t) - slope(b)


READOUTS: dict[str, Readout] = {
    "glance": Readout("glance", "glance", "Hz", "local contrast the lamina sees", glance),
    "boredom": Readout("boredom", "glance", "1/s", "habituation of the optic lobe over the exposure", boredom),
    "swat": Readout("swat", "deep", "Hz", "looming and escape drive (LC4, LPLC2, LC6, LC16, DNp02, DNp11)", _rate_change("swat")),
    "buy": Readout("buy", "deep", "mV", "innate valence, approach minus avoidance MBONs", buy),
    "gaze": Readout("gaze", "deep", "Hz", "small-object interest (LC10, LC11, LC18)", _rate_change("gaze")),
    "motion": Readout("motion", "deep", "Hz", "motion energy in T4 and T5", _rate_change("t4t5")),
    "turn": Readout("turn", "deep", "Hz", "steering, DNa02 left minus right (positive = toward the left of screen)", turn),
    "vpn": Readout("vpn", "deep", "Hz", "everything leaving the optic lobe", _rate_change("vpn")),
}


def evaluate(t: Trace, b: Trace, p: Populations) -> dict[str, float]:
    return {name: float(r.fn(t, b, p)) for name, r in READOUTS.items()}


def salience_map(t: Trace, b: Trace, p: Populations, sigma_px: float = 9.0) -> np.ndarray:
    """Where on the screen the optic lobe changed most. Absolute per-cell rate change of
    every column-assigned cell, splatted at its column's screen position and smoothed.
    Returned in [0, 1]; an all-zero map means nothing changed."""
    cells = p.column_cells
    change = np.abs(t.spikes[cells] / t.seconds - b.spikes[cells] / b.seconds)
    img = np.zeros((H, W), dtype=np.float32)
    x = np.minimum((p.column_uv[:, 0] * (W - 1)).astype(int), W - 1)
    y = np.minimum((p.column_uv[:, 1] * (H - 1)).astype(int), H - 1)
    np.add.at(img, (y, x), change.astype(np.float32))
    density = np.zeros((H, W), dtype=np.float32)
    np.add.at(density, (y, x), 1.0)
    img = cv2.GaussianBlur(img, (0, 0), sigma_px)
    density = cv2.GaussianBlur(density, (0, 0), sigma_px)
    img = np.where(density > 1e-6, img / np.maximum(density, 1e-6), 0.0)
    peak = img.max()
    return (img / peak).astype(np.float32) if peak > 0 else img.astype(np.float32)
