"""Command line: prepare data, run the gate, score ads, compare, run a tournament, serve."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def _progress(label: str, i: int):
    print(f"  [{i}] {label}", file=sys.stderr, flush=True)


def cmd_prepare(args):
    from .fly.download import prepare

    print(json.dumps(prepare()))


def cmd_gate(args):
    from .gate import GATE_PATH, load_gate
    from .protocols import Fly

    fly = Fly()
    gate = load_gate(fly, recompute=args.recompute)
    for c in gate["checks"]:
        print(f"  {'PASS' if c['passed'] else 'FAIL'}  {c['name']}: {c['detail']}")
    print(gate["summary"])
    print(f"saved to {GATE_PATH}")


def _load_clips(paths, max_seconds):
    from .stimuli import load

    return [load(p, max_seconds=max_seconds) for p in paths]


def cmd_score(args):
    from .gate import load_gate
    from .protocols import Fly, pair, solo
    from .report import bundle, pair_json, solo_json, write_bundle

    fly = Fly()
    gate = load_gate(fly)
    clips = _load_clips(args.files, args.max_seconds)
    out = Path(args.out) / time.strftime("%Y%m%d-%H%M%S")
    ads = []
    for i, clip in enumerate(clips):
        print(f"{clip.name}: {clip.total_ms} ms, {len(clip.frames)} frame(s)", file=sys.stderr)
        r = solo(fly, clip, trials=args.trials, seed=args.seed, progress=_progress)
        ads.append(solo_json(r, clip, out, f"ad{i}", gate))
        print(f"  done in {r['wall_seconds']:.0f}s", file=sys.stderr)
    pj = None
    if len(clips) == 2 and not args.no_pair:
        r = pair(fly, clips[0], clips[1], trials=args.trials, seed=args.seed, progress=_progress)
        pj = pair_json(r, out, "pair")
    page = write_bundle(out, bundle(ads, pj, gate, {"source": "cli", "files": [str(f) for f in args.files]}))
    for a in ads:
        print(f"\n{a['clip']['name']}")
        for k, v in a["ad"]["readouts"].items():
            print(f"  {k:<8} {v['mean']:>+8.3f}  [{v['lo']:+.3f}, {v['hi']:+.3f}]")
        for line in a["verdict"]["lines"]:
            print(f"  · {line}")
    if pj:
        print(f"\npair: salience share A {pj['salience_share_a']:.2f}, turn toward A {pj['turn_toward_a']['mean']:+.3f} Hz"
              f" → {pj['winner'] or 'no preference'} ({pj['why']})")
    print(f"\nreport: {page}")


def cmd_tournament(args):
    from .protocols import Fly, tournament
    from .stimuli import IMAGE_SUFFIXES, VIDEO_SUFFIXES

    files = sorted(p for p in Path(args.dir).iterdir() if p.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES)
    clips = _load_clips(files, args.max_seconds)
    fly = Fly()
    r = tournament(fly, clips, trials=args.trials, seed=args.seed, progress=_progress)
    out = Path(args.out) / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    (out / "tournament.json").write_text(json.dumps(r, indent=2) + "\n")
    order = sorted(zip(r["rating_salience"], r["names"]), reverse=True)
    print("rating (salience share, Bradley-Terry log strength):")
    for rating, name in order:
        print(f"  {rating:>+6.2f}  {name}")
    print(f"saved to {out / 'tournament.json'}")


def cmd_serve(args):
    import uvicorn

    uvicorn.run("swatorbuy.service:app", host=args.host, port=args.port, workers=1)


def main(argv=None):
    p = argparse.ArgumentParser(prog="swat", description="Ad creative, judged by a simulated fruit fly brain.")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare", help="download MaleCNS v1.0 (1.1 GB) and compile the graph").set_defaults(fn=cmd_prepare)
    g = sub.add_parser("gate", help="run the reference-stimulus gate and cache it")
    g.add_argument("--recompute", action="store_true")
    g.set_defaults(fn=cmd_gate)
    s = sub.add_parser("score", help="score one or two ads (image or video); two ads also run side by side")
    s.add_argument("files", nargs="+")
    s.add_argument("--trials", type=int, default=5)
    s.add_argument("--seed", type=int, default=0)
    s.add_argument("--max-seconds", type=float, default=5.0, help="video cap in seconds")
    s.add_argument("--out", default="results")
    s.add_argument("--no-pair", action="store_true")
    s.set_defaults(fn=cmd_score)
    t = sub.add_parser("tournament", help="every pair in a folder, Bradley-Terry ratings")
    t.add_argument("dir")
    t.add_argument("--trials", type=int, default=3)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--max-seconds", type=float, default=5.0)
    t.add_argument("--out", default="results")
    t.set_defaults(fn=cmd_tournament)
    v = sub.add_parser("serve", help="run the hosted experiment")
    v.add_argument("--host", default="0.0.0.0")
    v.add_argument("--port", type=int, default=8000)
    v.set_defaults(fn=cmd_serve)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
