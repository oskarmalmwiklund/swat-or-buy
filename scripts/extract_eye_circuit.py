#!/usr/bin/env python3
"""Cut the browser-sized eye circuit out of the prepared MaleCNS graph.

Retina (R1-R6, R7, R8) plus lamina (L1-L5, C2, C3, Lawf1, Lawf2, T1), with every original
edge between retained cells, the same signed weights the full simulator uses, each
photoreceptor's screen sample position and colour channel, each column-assigned cell's
screen position for the glance map, and real soma coordinates where the source has them.

Output: app/public/data/eye-circuit.json (flat typed arrays, gzips to a few MB).
Run after `swat prepare`: .venv/bin/python scripts/extract_eye_circuit.py
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow.feather as feather

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from swatorbuy.fly.common import DATA, GRAPH  # noqa: E402
from swatorbuy.fly.visual import VisualMemoryBrain  # noqa: E402

OUT = ROOT / "app" / "public" / "data" / "eye-circuit.json"
RECEPTOR_TYPES = ["R1-R6", "R7", "R8p", "R8y"]                 # plus every other R7*/R8* variant via KEEP_PATTERN
LAMINA_TYPES = ["L1", "L2", "L3", "L4", "L5", "C2", "C3", "Lawf1", "Lawf2", "T1"]
# Distal medulla amacrine cells (Dm) inhibit L2, L3 and L5 strongly and fire in the full
# model, so the lamina only behaves like the full brain when they are retained.
KEEP_PATTERN = r"^(R1-R6|R7.*|R8.*|L[1-5]|C2|C3|Lawf1|Lawf2|T1|Dm\d+.*)$"
BIAS_TYPES = ["L1", "L2", "L3", "L5"]          # the full model's 12 mV lamina bias
VOXEL_NM = 8


def main() -> None:
    t0 = time.perf_counter()
    brain = VisualMemoryBrain()                # gives us r8 mapping and corrected weights
    g = np.load(GRAPH)
    ptr, post, weight, ids = brain.ptr, brain.post, brain.weight, brain.ids
    a = feather.read_table(DATA / "annotations.feather").to_pandas().set_index("bodyId").loc[ids]
    types = a.type.fillna("")
    keep_mask = types.str.match(KEEP_PATTERN).to_numpy()
    keep = np.flatnonzero(keep_mask)
    local = np.full(brain.n, -1, dtype=np.int64)
    local[keep] = np.arange(len(keep))
    n = len(keep)

    # edges among retained cells, CSR by presynaptic local index
    pre_all = np.repeat(np.arange(brain.n), np.diff(ptr))
    emask = keep_mask[pre_all] & keep_mask[post]
    e_pre = local[pre_all[emask]]
    e_post = local[post[emask]]
    e_w = weight[emask].astype(np.float32)
    order = np.argsort(e_pre, kind="stable")
    e_pre, e_post, e_w = e_pre[order], e_post[order], e_w[order]
    offsets = np.r_[0, np.cumsum(np.bincount(e_pre, minlength=n))].astype(np.int64)

    # photoreceptor drive: luminance channel for R1-R6 (from the retina uv), blue/green for R8
    drive_channel = np.zeros(n, dtype=np.int8)         # 0 none, 1 luminance, 2 blue, 3 green
    drive_u = np.full(n, -1.0, dtype=np.float32)
    drive_v = np.full(n, -1.0, dtype=np.float32)
    r_local = local[brain.retina]
    drive_channel[r_local] = 1
    drive_u[r_local] = brain.uv[:, 0]
    drive_v[r_local] = brain.uv[:, 1]
    r8_local = local[brain.r8]
    drive_channel[r8_local] = np.where(brain.r8_channel == 2, 2, 3)
    drive_u[r8_local] = brain.r8_uv[:, 0]
    drive_v[r8_local] = brain.r8_uv[:, 1]
    bias = types.iloc[keep].isin(BIAS_TYPES).to_numpy().astype(np.int8)

    # column screen position for the glance map (same transform as readouts.py)
    from swatorbuy.readouts import _column_projection

    col_cells, col_uv = _column_projection(brain, a, types)
    col_u = np.full(n, -1.0, dtype=np.float32)
    col_v = np.full(n, -1.0, dtype=np.float32)
    uv_source = np.zeros(n, dtype=np.int8)               # 0 none, 1 photoreceptor sample, 2 column, 3 neighbour
    sel = local[col_cells] >= 0
    col_u[local[col_cells[sel]]] = col_uv[sel, 0]
    col_v[local[col_cells[sel]]] = col_uv[sel, 1]
    uv_source[local[col_cells[sel]]] = 2
    has_drive = drive_channel > 0
    col_u[has_drive & (uv_source == 0)] = drive_u[has_drive & (uv_source == 0)]
    col_v[has_drive & (uv_source == 0)] = drive_v[has_drive & (uv_source == 0)]
    uv_source[has_drive & (uv_source == 0)] = 1
    # Cells without a column (L4, Lawf, a few C2) take the position of their strongest
    # retained synaptic partner, in or out, that has one. Display layout, not anatomy.
    for _ in range(3):
        todo = np.flatnonzero(uv_source == 0)
        if not len(todo):
            break
        best_w = np.zeros(n, dtype=np.float32)
        best_j = np.full(n, -1, dtype=np.int64)
        aw = np.abs(e_w)
        for i, j, w in zip(np.r_[e_pre, e_post], np.r_[e_post, e_pre], np.r_[aw, aw]):
            if uv_source[i] == 0 and uv_source[j] > 0 and w > best_w[i]:
                best_w[i], best_j[i] = w, j
        found = todo[best_j[todo] >= 0]
        col_u[found] = col_u[best_j[found]]
        col_v[found] = col_v[best_j[found]]
        uv_source[found] = 3

    # soma coordinates: 8 nm voxels to microns, centred on the whole-CNS soma cloud so the
    # eyes sit where they really are relative to the brain
    soma = a.somaLocation
    have = soma.notna().to_numpy()
    all_xyz = np.stack(soma[have].to_list()).astype(np.float64) * VOXEL_NM / 1000
    center = all_xyz.mean(axis=0)
    xyz = np.full((n, 3), np.nan, dtype=np.float32)
    sub_have = have[keep]
    xyz[sub_have] = (np.stack(soma.iloc[keep][sub_have].to_list()).astype(np.float64) * VOXEL_NM / 1000 - center)
    missing = int((~sub_have).sum())

    side = a.somaSide.fillna(a.rootSide).fillna("").iloc[keep].to_numpy()
    type_names = sorted(set(types.iloc[keep]))
    type_index = np.asarray([type_names.index(t) for t in types.iloc[keep]], dtype=np.int16)

    def sha(x: np.ndarray) -> str:
        return hashlib.sha256(np.ascontiguousarray(x).tobytes()).hexdigest()

    payload = {
        "manifest": {
            "dataset": "MaleCNS v1.0 (flat connectome, minconf 0.5), CC BY 4.0, the MaleCNS collaboration",
            "source_graph_ids_sha256": sha(ids),
            "selection": "all annotated cells whose type matches " + KEEP_PATTERN
                         + "; every original edge between retained cells; weights = synapse count x transmitter sign x 0.275 mV, "
                           "with the full model's R8 to aMe12 sign correction applied (no aMe12 retained here)",
            "neurons": n,
            "edges": int(len(e_w)),
            "synaptic_contacts": int(np.abs(e_w).sum() / 0.275 + 0.5),
            "neurons_without_soma_position": missing,
            "coordinates": "soma positions are not shipped: the retina is outside the imaged volume and most lamina somas are unannotated; the app lays cells out by column position",
            "screen": {"width": 320, "height": 180,
                        "note": "drive_u/drive_v are the sampled screen position per photoreceptor in [0,1]; "
                                "left eye sees x 0.0-0.6, right eye 0.4-1.0. col_u/col_v is the column position used for the glance map."},
            "model": {"dt_ms_reference": 0.1, "membrane_tau_ms": 20, "synapse_tau_ms": 5, "delay_ms": 1.8, "refractory_ms": 2.2,
                      "rest_mv": -52, "threshold_mv": -45, "lamina_bias_mv": 12, "receptor_gain_mv": 30, "receptor_half": 0.02,
                      "luminance_tau_ms": 10,
                      "note": "identical to swatorbuy/fly (Bananflugakompassen / Stonkfly); photoreceptors are a LIF proxy for graded cells"},
            "types": type_names,
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "bodyId": [str(int(i)) for i in ids[keep]],
        "type": type_index.tolist(),
        "side": "".join(s if s in ("L", "R") else "?" for s in side),
        "driveChannel": drive_channel.tolist(),
        "driveU": np.round(drive_u, 4).tolist(),
        "driveV": np.round(drive_v, 4).tolist(),
        "bias": bias.tolist(),
        "colU": np.round(col_u, 4).tolist(),
        "colV": np.round(col_v, 4).tolist(),
        "uvSource": uv_source.tolist(),
        "offsets": offsets.tolist(),
        "targets": e_post.astype(np.int32).tolist(),
        "weights": np.round(e_w, 4).tolist(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), allow_nan=True).replace("NaN", "null")
    OUT.write_text(text)
    counts = {t: int((types.iloc[keep] == t).sum()) for t in type_names}
    print(json.dumps({"neurons": n, "edges": int(len(e_w)), "contacts": payload["manifest"]["synaptic_contacts"],
                      "missing_soma": missing, "bytes": OUT.stat().st_size, "types": counts,
                      "seconds": round(time.perf_counter() - t0, 1)}, indent=1))


if __name__ == "__main__":
    main()
