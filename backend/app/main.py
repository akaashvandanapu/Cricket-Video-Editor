import asyncio
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
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


def _unique_destination(name: str) -> Path:
    """Never overwrite: a second upload of `clip.mov` becomes `clip_2.mov`.
    Silently replacing a file would also invalidate its proxy and any
    session cut from it while the UI still lists the old one."""
    dest = VIDEOS_DIR / name
    stem, suffix = dest.stem, dest.suffix
    n = 2
    while dest.exists():
        dest = VIDEOS_DIR / f"{stem}_{n}{suffix}"
        n += 1
    return dest


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    saved = []
    for file in files:
        safe_name = Path(file.filename or "").name
        if not safe_name or Path(safe_name).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise HTTPException(400, f"Unsupported file type: {safe_name or '(unnamed)'}")
        dest = _unique_destination(safe_name)
        tmp = dest.with_name(dest.name + ".uploading")
        try:
            with tmp.open("wb") as out:
                while chunk := await file.read(4 * 1024 * 1024):
                    out.write(chunk)
            tmp.replace(dest)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        saved.append(dest.name)
    return {"names": saved}


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
    videos: list[str] = Field(min_length=1)
    sensitivity: float = Field(50.0, ge=0, le=100)
    min_gap: float = Field(3.5, ge=1.0, le=10)
    strictness: float = Field(50.0, ge=0, le=100)
    use_visual: bool = True
    pre_roll: float = Field(3.0, ge=0.2, le=15)
    post_roll: float = Field(3.0, ge=0.2, le=15)
    resolution: str = Field("1080", pattern="^(original|1080|720)$")
    include_unverified: bool = False
    check_ball: bool = False


pipeline_jobs: dict[str, pipeline.BatchJob] = {}


@app.post("/api/process")
def process(req: ProcessRequest):
    """Detect every delivery in each video and cut it - one streaming
    pipeline per video, run back to back into one session. Poll
    /api/jobs/{id}: clips appear in the result as each one finishes."""
    paths = [resolve_video(v) for v in dict.fromkeys(req.videos)]   # de-dupe, keep order
    if (req.use_visual or req.check_ball) and not pose_verifier.pose_available():
        raise HTTPException(
            500,
            "The swing check needs mediapipe 0.10.x in backend/.venv. Run: "
            "pip install -r requirements.txt, then restart the backend.",
        )
    job_id = uuid.uuid4().hex[:8]
    stamp = time.strftime("%Y%m%d_%H%M%S")
    stub = re.sub(r"[^A-Za-z0-9_-]+", "_", paths[0].stem)
    if len(paths) > 1:
        stub += f"_and_{len(paths) - 1}_more"
    out_dir = FULL_DIR / f"{stub}_{stamp}_{job_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    batch = pipeline.BatchJob(out_dir.name)
    for p in paths:
        j = pipeline.JobState(p.name)
        j.session = out_dir.name
        batch.jobs.append(j)
    pipeline_jobs[job_id] = batch
    params = pipeline.PipelineParams(
        sensitivity=req.sensitivity, min_gap=req.min_gap, strictness=req.strictness,
        use_visual=req.use_visual, pre_roll=req.pre_roll, post_roll=req.post_roll,
        resolution=req.resolution, include_unverified=req.include_unverified,
        check_ball=req.check_ball,
    )
    threading.Thread(target=pipeline.run_batch, args=(batch, paths, params, out_dir),
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
        result["zip_url"] = f"/api/download/{out_dir.name}/{zip_path.name}"

    if req.mode in ("concat", "both"):
        concat_path = out_dir / f"combined_{export_id}.mp4"
        concat_clips(ordered_clips, concat_path)
        result["concat_url"] = f"/api/download/{out_dir.name}/{concat_path.name}"

    return result


@app.api_route("/api/download/{session}/{filename}", methods=["GET", "HEAD"])
def download(session: str, filename: str):
    """Serve an export as a file download. The UI lives on a different
    origin from the API, and browsers ignore <a download> across origins -
    without Content-Disposition the browser just plays the video inline."""
    path = _resolve_session_clip(session, filename)
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")


app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")
# the source video is shown in the left-hand panel, so it has to be servable
app.mount("/source", StaticFiles(directory=str(VIDEOS_DIR)), name="source")
