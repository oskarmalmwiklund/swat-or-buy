"""The reference-stimulus gate.

Real flies have known answers to a few stimuli: a looming disc drives LC4 and LPLC2, a
drifting grating drives T4/T5 in a direction-selective way, a small moving dot drives
LC11 and LC18. We show the same stimuli to the model and record which readouts respond.
Deep readouts that fail the gate are still reported, labelled as not seeing structure.

The gate is a property of the model build, not of any ad, so it is computed once and
cached next to the data as ``gate.json``.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from .fly.common import DATA, digest
from .readouts import READOUTS
from .stats import separation
from .stimuli import reference_set

GATE_PATH = DATA / "gate.json"
MIN_HZ = 0.2


def run_gate(fly, trials: int = 3, seed: int = 0) -> dict:
    from .protocols import score

    rng = np.random.default_rng(seed)
    refs = reference_set()
    fly.settle()
    base = fly.baseline(500)
    scored = {name: score(fly, clip, base, trials, rng) for name, clip in refs.items()}

    def m(name: str, key: str) -> float:
        return float(np.mean(scored[name].samples[key]))

    def distinct(x: str, y: str, key: str) -> bool:
        return bool(separation(scored[x].samples[key], scored[y].samples[key])["distinct"])

    checks = []

    def check(name, passed, detail, readouts):
        checks.append({"name": name, "passed": bool(passed), "detail": detail, "readouts": readouts})

    check("lamina sees contrast",
          m("disc", "glance") > m("grey", "glance") + MIN_HZ and distinct("disc", "grey", "glance"),
          f"glance disc {m('disc', 'glance'):.2f} Hz vs grey {m('grey', 'glance'):.2f} Hz",
          ["glance", "boredom"])
    check("looming drives LC4 / LPLC2",
          m("looming", "swat") > m("receding", "swat") + MIN_HZ and distinct("looming", "receding", "swat"),
          f"swat looming {m('looming', 'swat'):.2f} Hz vs receding {m('receding', 'swat'):.2f} Hz",
          ["swat"])
    dr, dl = scored["grating_right"].direction, scored["grating_left"].direction
    asym = sum(abs(dr[s] - dl[s]) for s in "abcd")
    check("T4 / T5 direction selectivity",
          asym > MIN_HZ and m("grating_right", "motion") > m("grey", "motion") + MIN_HZ,
          f"subtype asymmetry right vs left {asym:.2f} Hz; motion grating {m('grating_right', 'motion'):.2f} Hz vs grey {m('grey', 'motion'):.2f} Hz",
          ["motion"])
    check("small moving dot drives LC11 / LC18",
          m("small_dot", "gaze") > m("grey", "gaze") + MIN_HZ and distinct("small_dot", "grey", "gaze"),
          f"gaze dot {m('small_dot', 'gaze'):.2f} Hz vs grey {m('grey', 'gaze'):.2f} Hz",
          ["gaze"])
    check("projection neurons separate a disc from its scramble",
          abs(m("disc", "vpn") - m("disc_scramble", "vpn")) > MIN_HZ and distinct("disc", "disc_scramble", "vpn"),
          f"vpn disc {m('disc', 'vpn'):.2f} Hz vs scramble {m('disc_scramble', 'vpn'):.2f} Hz",
          ["vpn", "turn"])
    check("valence separates a disc from its scramble",
          distinct("disc", "disc_scramble", "buy") and abs(m("disc", "buy") - m("disc_scramble", "buy")) > 0.5,
          f"buy disc {m('disc', 'buy'):.2f} mV vs scramble {m('disc_scramble', 'buy'):.2f} mV",
          ["buy"])

    status = {}
    for key, r in READOUTS.items():
        relevant = [c for c in checks if key in c["readouts"]]
        passed = any(c["passed"] for c in relevant) if relevant else False
        status[key] = {"level": r.level, "structured": passed,
                       "label": "carries image structure" if passed else "not seeing image structure"}
    deep_ok = any(v["structured"] for k, v in status.items() if v["level"] == "deep")
    return {
        "model": fly.brain.build.get("model") if isinstance(fly.brain.build, dict) else None,
        "graph_ids_sha256": digest(fly.brain.ids),
        "trials": trials,
        "computed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "checks": checks,
        "readouts": status,
        "deep_structured": deep_ok,
        "summary": ("Deep readouts respond to image structure." if deep_ok else
                    "Only the photoreceptor and lamina readouts respond to image structure. "
                    "Everything downstream of the lamina is silent or brightness-driven in this model build; "
                    "deep readouts are shown for completeness and should not be read as judgments."),
        "reference_rates": {name: {k: float(np.mean(v)) for k, v in s.samples.items()} for name, s in scored.items()},
    }


def load_gate(fly=None, path: Path = GATE_PATH, recompute: bool = False) -> dict:
    if path.exists() and not recompute:
        gate = json.loads(path.read_text())
        if fly is None or gate.get("graph_ids_sha256") == digest(fly.brain.ids):
            return gate
    if fly is None:
        raise FileNotFoundError(f"No gate at {path}; run `swat gate` first")
    gate = run_gate(fly)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(gate, indent=2) + "\n")
    return gate
