"""Turn protocol results into JSON plus PNGs, and a self-contained HTML page."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from .baselines import BASELINE_DESCRIPTIONS, clip_stats, spectral_residual
from .readouts import READOUTS
from .stats import separation, summarize
from .stimuli import CONTROLS, Clip

WEB = Path(__file__).with_name("web")


def overlay(frame: np.ndarray, sal: np.ndarray, alpha: float = 0.6) -> np.ndarray:
    heat = cv2.applyColorMap((np.clip(sal, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    heat = cv2.cvtColor(heat, cv2.COLOR_BGR2RGB)
    a = (alpha * np.clip(sal, 0, 1)[:, :, None]).astype(np.float32)
    dim = frame.astype(np.float32) * 0.55
    return np.clip(dim * (1 - a) + heat * a, 0, 255).astype(np.uint8)


def save_png(path: Path, rgb: np.ndarray, scale: int = 2):
    big = cv2.resize(rgb, (rgb.shape[1] * scale, rgb.shape[0] * scale), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(path), cv2.cvtColor(big, cv2.COLOR_RGB2BGR))


def _scored_json(s) -> dict:
    return {
        "name": s.name,
        "readouts": {k: summarize(v) for k, v in s.samples.items()},
        "direction": s.direction,
        "summary": s.trace_summary,
    }


def solo_json(result: dict, clip: Clip, out: Path, tag: str, gate: dict | None) -> dict:
    """Write PNGs for one solo result and return its JSON-ready dict."""
    out.mkdir(parents=True, exist_ok=True)
    frame = clip.representative()
    ad = result["ad"]
    save_png(out / f"{tag}.png", frame)
    save_png(out / f"{tag}.fly.png", overlay(frame, ad.salience))
    save_png(out / f"{tag}.pixels.png", overlay(frame, spectral_residual(frame)))
    controls = {}
    for name, s in result["controls"].items():
        controls[name] = {
            "description": CONTROLS.get(name, name),
            "readouts": {k: summarize(v) for k, v in s.samples.items()},
            "versus_ad": {k: separation(ad.samples[k], s.samples[k]) for k in ad.samples},
        }
    fly_map = ad.salience
    pix_map = spectral_residual(frame)
    corr = float(np.corrcoef(fly_map.ravel(), pix_map.ravel())[0, 1]) if fly_map.std() > 0 and pix_map.std() > 0 else 0.0
    return {
        "tag": tag,
        "clip": result["clip"],
        "trials": result["trials"],
        "seed": result["seed"],
        "wall_seconds": result["wall_seconds"],
        "images": {"ad": f"{tag}.png", "fly_map": f"{tag}.fly.png", "pixel_map": f"{tag}.pixels.png"},
        "ad": _scored_json(ad),
        "controls": controls,
        "baseline": result["baseline"],
        "pixel_stats": clip_stats(clip),
        "map_correlation_with_pixel_saliency": corr,
        "verdict": verdict(ad, result["controls"], gate),
    }


def verdict(ad, controls: dict, gate: dict | None) -> dict:
    """Plain-language findings. Which readouts differ from which controls beyond noise."""
    lines = []
    structured = {k: (gate["readouts"][k]["structured"] if gate else True) for k in READOUTS}
    for key, r in READOUTS.items():
        beats = [n for n, s in controls.items() if separation(ad.samples[key], s.samples[key])["distinct"]]
        if not beats:
            continue
        if key in ("glance", "boredom") or structured.get(key):
            lines.append(f"{key}: differs from {', '.join(beats)}")
    flat_same = {k: not separation(ad.samples[k], controls["flat"].samples[k])["distinct"]
                 for k in READOUTS} if "flat" in controls else {}
    scramble_same = {k: not separation(ad.samples[k], controls["scramble"].samples[k])["distinct"]
                     for k in READOUTS} if "scramble" in controls else {}
    layout_matters = bool(scramble_same) and not scramble_same.get("glance", True)
    brightness_only = [k for k, same in scramble_same.items() if same and not flat_same.get(k, True)]
    return {
        "lines": lines,
        "layout_matters_to_lamina": layout_matters,
        "brightness_only_readouts": brightness_only,
        "deep_structured": bool(gate and gate.get("deep_structured")),
    }


def pair_json(result: dict, out: Path, tag: str) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    for order in ("ab", "ba"):
        save_png(out / f"{tag}.{order}.png", result["frames"][order])
        save_png(out / f"{tag}.{order}.fly.png", overlay(result["frames"][order], result["maps"][order]))
    turn = summarize(result["turn_toward_a"])
    share = result["salience_share_a"]
    if share > 0.55:
        winner, why = result["a"], "the optic lobe changed more on its side of the screen"
    elif share < 0.45:
        winner, why = result["b"], "the optic lobe changed more on its side of the screen"
    else:
        winner, why = None, "the two halves of the screen changed the optic lobe about equally"
    return {
        "tag": tag,
        "a": result["a"], "b": result["b"],
        "trials": result["trials"], "seed": result["seed"], "wall_seconds": result["wall_seconds"],
        "images": {k: f"{tag}.{k}.png" for k in ("ab", "ba")} | {f"{k}_fly": f"{tag}.{k}.fly.png" for k in ("ab", "ba")},
        "turn_toward_a": turn,
        "salience_share_a": share,
        "readouts": {k: {"ab": summarize(v["ab"]), "ba": summarize(v["ba"])} for k, v in result["readouts"].items()},
        "winner": winner, "why": why,
    }


def bundle(ads: list[dict], pair: dict | None, gate: dict | None, meta: dict | None = None) -> dict:
    return {
        "version": 1,
        "meta": meta or {},
        "gate": gate,
        "readouts": {k: {"level": r.level, "unit": r.unit, "reads_as": r.reads_as} for k, r in READOUTS.items()},
        "baselines": BASELINE_DESCRIPTIONS,
        "controls": CONTROLS,
        "ads": ads,
        "pair": pair,
    }


def write_bundle(out: Path, data: dict) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(data, indent=2, default=_default) + "\n")
    html = (WEB / "index.html").read_text()
    css = (WEB / "style.css").read_text()
    js = (WEB / "app.js").read_text()
    embedded = json.dumps(data, default=_default).replace("</", "<\\/")
    page = (html.replace('<link rel="stylesheet" href="style.css">', f"<style>{css}</style>")
                .replace('<script src="app.js"></script>', f'<script id="result" type="application/json">{embedded}</script>\n<script>{js}</script>'))
    (out / "index.html").write_text(page)
    return out / "index.html"


def _default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))
