import asyncio
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ffmpeg_io, pipeline, pose_verifier, proxy, quiet_stderr
from .clipper import concat_clips, zip_clips
from .config import FULL_DIR, OUTPUT_DIR, SUPPORTED_EXTENSIONS, VIDEOS_DIR
from .video_probe import probe

app = FastAPI(title="Cricket Video Editor")
# the UI is served separately (cve-fe); the API is local-only, so any
# localhost origin is fine
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


@app.get("/")
def root():
    return {"service": "cricket-video-editor backend", "ui": "run cve-fe and open http://localhost:8501"}


def _ignore_client_resets(loop, context):
    """Browsers abort video range requests constantly (seeking, scrubbing,
    switching clips). On Windows asyncio reports each one as a
    ConnectionResetError traceback; it is not an error for this app."""
    if isinstance(context.get("exception"), ConnectionResetError):
        return
    loop.default_exception_handler(context)


@app.on_event("startup")
def warm_up():
    quiet_stderr.install()
    asyncio.get_running_loop().set_exception_handler(_ignore_client_resets)
    # importing the pose library takes a few seconds: do it now, in the
    # background, so the first run doesn't pay for it
    threading.Thread(target=pose_verifier.pose_available, daemon=True).start()


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


def resolve_video(name: str) -> Path:
    # prevent path traversal - only allow a bare filename that exists in videos/
    safe_name = Path(name).name
    path = VIDEOS_DIR / safe_name
    if not path.exists() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(404, f"Video not found: {safe_name}")
    return path


def human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def set_job(job_id: str, **fields):
    with jobs_lock:
        jobs[job_id].update(fields)


@app.get("/api/capabilities")
def capabilities():
    hwaccel = ffmpeg_io.current_hwaccel()
    if hwaccel is None:
        # the probe is lazy; run it now against any video so the UI can
        # report what will actually be used
        sample = next((p for p in sorted(VIDEOS_DIR.iterdir())
                       if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS), None)
        if sample:
            hwaccel = ffmpeg_io.detect_hwaccel(sample)
    return {
        "pose_available": pose_verifier.pose_available(),
        "pose_note": pose_verifier.pose_unavailable_reason(),
        "hwaccel": hwaccel,
    }


@app.get("/api/library")
def library():
    items = []
    for path in sorted(VIDEOS_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        try:
            meta = probe(path)
        except Exception:
            meta = {"duration": 0, "fps": 0, "width": 0, "height": 0}
        stat = path.stat()
        items.append({
            "name": path.name,
            "size_bytes": stat.st_size,
            "size_human": human_size(stat.st_size),
            "modified": stat.st_mtime,
            **meta,
        })
    # newest first: with no picker in the UI, the most recent upload is the
    # one the user means
    items.sort(key=lambda i: i["modified"], reverse=True)
    return {"videos": items}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    safe_name = Path(file.filename).name
    if Path(safe_name).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, "Unsupported file type")
    dest = VIDEOS_DIR / safe_name
    with dest.open("wb") as out:
        while chunk := await file.read(4 * 1024 * 1024):
            out.write(chunk)
    return {"name": safe_name}


@app.get("/api/preview-source")
def preview_source(video: str):
    """What the left-hand panel should play, and whether a browser-friendly
    copy still has to be built."""
    path = resolve_video(video)
    meta = probe(path)
    p = proxy.proxy_path(path)
    ready = p.exists() and p.stat().st_size > 0
    needed = proxy.needs_proxy(path, meta)
    return {
        "video": path.name,
        "meta": meta,
        "needs_proxy": needed,
        "proxy_ready": ready,
        # play the original until the lighter copy exists
        "url": f"/media/proxy/{p.name}" if ready else f"/source/{path.name}",
        "using_proxy": ready,
    }


def _run_proxy_job(job_id: str, path: Path):
    try:
        out = proxy.build_proxy(path)
        set_job(job_id, state="done", done=1, total=1,
                result={"url": f"/media/proxy/{out.name}"})
    except Exception as exc:
        set_job(job_id, state="error", error=str(exc))


@app.post("/api/proxy")
def make_proxy(video: str):
    path = resolve_video(video)
    existing = proxy.proxy_path(path)
    if existing.exists() and existing.stat().st_size > 0:
        return {"job_id": None, "url": f"/media/proxy/{existing.name}"}
    job_id = uuid.uuid4().hex[:8]
    with jobs_lock:
        jobs[job_id] = {"state": "running", "done": 0, "total": 1,
                        "result": None, "error": None}
    threading.Thread(target=_run_proxy_job, args=(job_id, path), daemon=True).start()
    return {"job_id": job_id, "url": None}


class ProcessRequest(BaseModel):
    video: str
    sensitivity: float = Field(50.0, ge=0, le=100)
    min_gap: float = Field(3.5, ge=1.0, le=10)
    strictness: float = Field(50.0, ge=0, le=100)
    use_visual: bool = True
    pre_roll: float = Field(3.0, ge=0.2, le=15)
    post_roll: float = Field(3.0, ge=0.2, le=15)
    resolution: str = "1080"


pipeline_jobs: dict[str, pipeline.JobState] = {}


@app.post("/api/process")
def process(req: ProcessRequest):
    """Detect every delivery and cut it, as one streaming pipeline. Poll
    /api/jobs/{id}: clips appear in the result as each one finishes."""
    path = resolve_video(req.video)
    if req.use_visual and not pose_verifier.pose_available():
        raise HTTPException(
            500,
            "The swing check needs mediapipe 0.10.x in backend/.venv. Run: "
            "pip install -r requirements.txt, then restart the backend.",
        )
    job_id = uuid.uuid4().hex[:8]
    stamp = time.strftime("%Y%m%d_%H%M%S")
    safe_stub = re.sub(r"[^A-Za-z0-9_-]+", "_", path.stem)
    out_dir = FULL_DIR / f"{safe_stub}_{stamp}_{job_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    job = pipeline.JobState()
    job.session = out_dir.name
    pipeline_jobs[job_id] = job
    params = pipeline.PipelineParams(
        sensitivity=req.sensitivity, min_gap=req.min_gap, strictness=req.strictness,
        use_visual=req.use_visual, pre_roll=req.pre_roll, post_roll=req.post_roll,
        resolution=req.resolution,
    )
    threading.Thread(target=pipeline.run_pipeline, args=(job, path, params, out_dir),
                     daemon=True, name=f"pipeline-{job_id}").start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    pj = pipeline_jobs.get(job_id)
    if pj is not None:
        return pj.snapshot()
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return job


class ExportRequest(BaseModel):
    session: str
    filenames: list[str] = Field(min_length=1)
    mode: str = Field("separate", pattern="^(separate|concat|both)$")


def _resolve_session_clip(session: str, filename: str) -> Path:
    # prevent path traversal - only bare filenames inside a known session dir
    path = FULL_DIR / Path(session).name / Path(filename).name
    if not path.exists():
        raise HTTPException(404, f"Clip not found: {filename}")
    return path


@app.post("/api/export")
def export(req: ExportRequest):
    """Zip and/or concatenate a user-selected subset of already-cut clips.
    Cheap - the clips are already encoded, so nothing is re-encoded here."""
    out_dir = FULL_DIR / Path(req.session).name
    if not out_dir.is_dir():
        raise HTTPException(404, f"Unknown session: {req.session}")

    ordered_clips = [_resolve_session_clip(req.session, name) for name in req.filenames]
    export_id = uuid.uuid4().hex[:8]
    result = {"zip_url": None, "concat_url": None}

    if req.mode in ("separate", "both"):
        zip_path = out_dir / f"selected_{export_id}.zip"
        zip_clips(ordered_clips, zip_path)
        result["zip_url"] = f"/media/full/{out_dir.name}/{zip_path.name}"

    if req.mode in ("concat", "both"):
        concat_path = out_dir / f"combined_{export_id}.mp4"
        concat_clips(ordered_clips, concat_path)
        result["concat_url"] = f"/media/full/{out_dir.name}/{concat_path.name}"

    return result


app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")
# the source video is shown in the left-hand panel, so it has to be servable
app.mount("/source", StaticFiles(directory=str(VIDEOS_DIR)), name="source")
