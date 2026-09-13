#!/usr/bin/env python3
"""Reference firing rates from the full-brain Python simulator, for validating the browser kernel.

Shows grey, white, black, a dark disc and a left-half-black screen for 500 ms after a 500 ms
grey settle, and records mean spikes/s per cell for each retina and lamina type, plus the
per-cell spike counts of the lamina so the browser kernel's glance map can be compared.
Output: app/public/data/reference-rates.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from swatorbuy.fly.common import annotations  # noqa: E402
from swatorbuy.protocols import Fly  # noqa: E402
from swatorbuy.stimuli import BLANK, H, W, Clip  # noqa: E402

OUT = ROOT / "app" / "public" / "data" / "reference-rates.json"
TYPES = ["R1-R6", "R7", "R8p", "R8y", "L1", "L2", "L3", "L4", "L5", "C2", "C3", "Lawf1", "Lawf2", "T1"]


def grey(v):
    return np.full((H, W, 3), v, np.uint8)


def main():
    fly = Fly()
    a = annotations(fly.brain.ids)
    types = a.type.fillna("")
    disc = grey(128)
    yy, xx = np.mgrid[0:H, 0:W]
    disc[(xx - W // 2) ** 2 + (yy - H // 2) ** 2 < 45 ** 2] = 0
    half = grey(128)
    half[:, : W // 2] = 0
    stimuli = {"grey": grey(128), "white": grey(255), "black": grey(0), "disc": disc, "left_black": half}
    out = {"exposure_ms": 500, "settle_ms": 500, "rates": {}, "lamina_bodyIds": None, "lamina_spikes": {}}
    lam = np.flatnonzero(types.isin(["L1", "L2", "L3"]).to_numpy())
    out["lamina_bodyIds"] = [str(int(i)) for i in fly.brain.ids[lam]]
    for name, frame in stimuli.items():
        fly.settle()
        fly.restore()
        t = fly.show(Clip.still(frame, 500, name))
        out["rates"][name] = {k: (float(t.spikes[types.eq(k).to_numpy()].mean() * 2) if types.eq(k).any() else None) for k in TYPES}
        out["lamina_spikes"][name] = t.spikes[lam].astype(int).tolist()
        print(name, {k: round(v, 1) for k, v in out["rates"][name].items() if k in ("R1-R6", "L1", "L2", "L3")})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out))
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
