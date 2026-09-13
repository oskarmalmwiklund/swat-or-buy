"""The hosted experiment: upload one or two ads, get a fly verdict.

One worker thread owns the brain (about 3 GB) and works through a queue. Jobs and results
live on disk under ``SWAT_RESULTS`` so a restart loses nothing finished. Limits are
deliberately tight so a public instance stays responsive: two files, 40 MB each, five
seconds of video, at most ten trials.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .stimuli import IMAGE_SUFFIXES, VIDEO_SUFFIXES

RESULTS = Path(os.environ.get("SWAT_RESULTS", "results")).resolve()
UPLOADS = RESULTS / "_uploads"
WEB = Path(__file__).with_name("web")
MAX_BYTES = 40 * 1024 * 1024
MAX_TRIALS = int(os.environ.get("SWAT_MAX_TRIALS", "10"))
MAX_SECONDS = float(os.environ.get("SWAT_MAX_SECONDS", "5"))
KEEP_JOBS = int(os.environ.get("SWAT_KEEP_JOBS", "500"))

app = FastAPI(title="Swat or Buy", version="0.1.0")
jobs: dict[str, dict] = {}
work: queue.Queue = queue.Queue()
state = {"ready": False, "gate": None, "error": None, "started": time.time(), "load_seconds": None}
lock = threading.Lock()


def _job_path(job_id: str) -> Path:
    return RESULTS / job_id


def _save(job: dict):
    p = _job_path(job["id"])
    p.mkdir(parents=True, exist_ok=True)
    (p / "job.json").write_text(json.dumps(job, indent=2) + "\n")


def _worker():
    from .gate import load_gate
    from .protocols import Fly, pair, solo
    from .report import bundle, pair_json, solo_json, write_bundle
    from .stimuli import load

    try:
        fly = Fly()
        state["load_seconds"] = fly.load_seconds
        state["gate"] = load_gate(fly)
        state["ready"] = True
    except Exception as e:  # noqa: BLE001
        state["error"] = f"{type(e).__name__}: {e}"
        traceback.print_exc()
        return
    while True:
        job_id = work.get()
        job = jobs.get(job_id)
        if not job:
            continue
        job["status"], job["started_at"] = "running", time.time()
        _save(job)

        def progress(label, i, _job=job):
            _job["progress"] = {"label": label, "step": i}

        try:
            clips = [load(f, max_seconds=job["max_seconds"]) for f in job["files"]]
            for clip, name in zip(clips, job["names"]):
                clip.name = Path(name).stem
            out = _job_path(job_id)
            ads = []
            for i, clip in enumerate(clips):
                job["progress"] = {"label": f"showing {clip.name}", "step": i}
                r = solo(fly, clip, trials=job["trials"], seed=0, progress=progress)
                ads.append(solo_json(r, clip, out, f"ad{i}", state["gate"]))
            pj = None
            if len(clips) == 2:
                job["progress"] = {"label": "side by side", "step": len(clips)}
                r = pair(fly, clips[0], clips[1], trials=job["trials"], seed=0, progress=progress)
                pj = pair_json(r, out, "pair")
            data = bundle(ads, pj, state["gate"], {"source": "service", "job": job_id,
                                                    "files": [Path(f).name for f in job["files"]]})
            write_bundle(out, data)
            job["status"], job["finished_at"] = "done", time.time()
            job["result"] = f"/results/{job_id}/result.json"
            job["page"] = f"/results/{job_id}/index.html"
        except Exception as e:  # noqa: BLE001
            job["status"], job["error"] = "error", f"{type(e).__name__}: {e}"
            traceback.print_exc()
        finally:
            for f in job["files"]:
                Path(f).unlink(missing_ok=True)
            job.pop("progress", None)
            _save(job)
            _trim()


def _trim():
    with lock:
        done = sorted((j for j in jobs.values() if j["status"] in ("done", "error")), key=lambda j: j["created_at"])
        for j in done[:-KEEP_JOBS] if len(done) > KEEP_JOBS else []:
            shutil.rmtree(_job_path(j["id"]), ignore_errors=True)
            jobs.pop(j["id"], None)


@app.on_event("startup")
def _startup():
    RESULTS.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    for p in RESULTS.glob("*/job.json"):
        try:
            j = json.loads(p.read_text())
            if j["status"] in ("done", "error"):
                jobs[j["id"]] = j
        except Exception:  # noqa: BLE001
            continue
    threading.Thread(target=_worker, daemon=True, name="fly").start()


@app.get("/api/status")
def status():
    return {
        "ready": state["ready"], "error": state["error"], "queue": work.qsize(),
        "load_seconds": state["load_seconds"], "uptime_seconds": time.time() - state["started"],
        "limits": {"files": 2, "max_bytes": MAX_BYTES, "max_trials": MAX_TRIALS, "max_seconds": MAX_SECONDS},
        "gate": None if state["gate"] is None else {k: state["gate"][k] for k in ("summary", "deep_structured", "readouts", "checks")},
    }


@app.get("/api/gate")
def gate():
    if state["gate"] is None:
        raise HTTPException(503, "brain still loading")
    return state["gate"]


@app.post("/api/jobs")
async def create_job(files: list[UploadFile] = File(...), trials: int = Form(5), max_seconds: float = Form(5.0)):
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "brain still loading, try again in a minute")
    if not 1 <= len(files) <= 2:
        raise HTTPException(400, "upload one or two files")
    trials = max(1, min(int(trials), MAX_TRIALS))
    max_seconds = max(0.5, min(float(max_seconds), MAX_SECONDS))
    job_id = uuid.uuid4().hex[:12]
    saved = []
    for f in files:
        suffix = Path(f.filename or "").suffix.lower()
        if suffix not in IMAGE_SUFFIXES | VIDEO_SUFFIXES:
            raise HTTPException(400, f"unsupported file type: {suffix or 'none'}")
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, f"{f.filename} is larger than {MAX_BYTES // (1024 * 1024)} MB")
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in Path(f.filename).stem)[:60] or "ad"
        path = UPLOADS / f"{job_id}-{len(saved)}-{safe}{suffix}"
        path.write_bytes(data)
        saved.append(str(path))
    job = {"id": job_id, "status": "queued", "created_at": time.time(), "files": saved,
           "names": [Path(f.filename).name for f in files], "trials": trials, "max_seconds": max_seconds,
           "position": work.qsize() + 1}
    jobs[job_id] = job
    _save(job)
    work.put(job_id)
    return {k: v for k, v in job.items() if k != "files"}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    public = {k: v for k, v in job.items() if k != "files"}
    if job["status"] == "queued":
        ahead = [j for j in jobs.values() if j["status"] == "queued" and j["created_at"] < job["created_at"]]
        public["position"] = len(ahead) + 1
    return public


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


app.mount("/results", StaticFiles(directory=str(RESULTS), check_dir=False), name="results")
app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
