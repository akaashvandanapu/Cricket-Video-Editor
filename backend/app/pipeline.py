"""Detect-and-cut pipeline.

Three stages, wired as a producer/consumer pipeline so cutting overlaps
with detection and clips appear as soon as each one is ready:

    audio scan (1 pass, whole video)
        │  time-ordered deliveries, split into K contiguous segments
        ▼
    verify workers (K threads, one segment each)
        │  each event: pose check → keep / reject → hand kept events on
        ▼  (queue)
    cut workers (M threads, shared queue)
        │  ffmpeg cut → clip published to the job
        ▼
    job.result.clips grows live; the UI polls it

Why the audio scan is NOT split across threads: its two thresholds are
relative to the whole recording (the SNR floor is measured against the
video's own noise level, and strongest-first gap suppression must see
neighbours on both sides of any cut point). Splitting it would change the
answer at segment boundaries. It is also cheap - a few seconds for a
4-minute file - so nothing is gained. The expensive work (decoding video
around each candidate for the pose check, and encoding each clip) is what
runs in parallel.

Why verify workers own a segment rather than share a queue: pose checks
cost about the same per event, so contiguous chunks balance well, and each
worker walks its part of the video in order. Cut workers DO share a queue,
because cut cost varies (resolution, motion) and a shared queue keeps them
all busy.

Cutting is the slow stage: it re-decodes 4K source video for every clip.
Measured on this machine the Intel hardware decoder saturates at 3
parallel ffmpeg processes (a 4th or 6th made it slower), but the CPU still
has cores to spare, so the cutter pool is HYBRID: 3 workers on the
hardware decoder plus 3 on software decode, sharing one queue. That was
~16% faster than hardware-only in a side-by-side test (4.55s vs 5.43s per
1080p clip) and, more importantly, the queue is deep enough that the pose
check is never throttled by cutting - verification finishes at its own
pace and clips keep streaming in behind it.
"""
from __future__ import annotations

import queue
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import ffmpeg_io, pose_verifier
from .clipper import cut_clip
from .detector import Event, scan_audio
from .video_probe import probe

VERIFY_WORKERS = 4
HW_CUT_WORKERS = 3          # what the hardware decoder can feed
SW_CUT_WORKERS = 3          # extra cutters on spare CPU cores
CUT_QUEUE_DEPTH = 512       # effectively unbounded: never throttle verification

_SENTINEL = object()


@dataclass
class PipelineParams:
    sensitivity: float
    min_gap: float
    strictness: float
    use_visual: bool
    pre_roll: float
    post_roll: float
    resolution: str
    # keep deliveries the visual stage could not assess (player not found)?
    # Off by default: an unassessable clip is more often a throw-back than a
    # shot, and the user can opt back in from the Detect tab.
    include_unverified: bool = False


class JobState:
    """Thread-safe progress + results for one pipeline run."""

    def __init__(self, video_name: str = ""):
        self.lock = threading.Lock()
        self.video = video_name
        self.state = "running"
        self.stage = "scanning"
        self.error: Optional[str] = None
        self.candidates = 0
        self.rejected_audio = 0
        self.events_total = 0
        self.verified_done = 0
        self.rejected_visual = 0
        self.rejected_unverified = 0   # dropped: could not be visually checked
        self.unverified = 0            # kept although it could not be checked
        self.cut_total = 0
        self.cut_done = 0
        self.clips: list[dict] = []
        self.video_duration = 0.0
        self.session = ""
        self.events: list[dict] = []

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "video": self.video,
                "state": self.state,
                "stage": self.stage,
                "error": self.error,
                "candidates": self.candidates,
                "rejected_audio": self.rejected_audio,
                "events_total": self.events_total,
                "verified_done": self.verified_done,
                "rejected_visual": self.rejected_visual,
                "rejected_unverified": self.rejected_unverified,
                "unverified": self.unverified,
                "cut_total": self.cut_total,
                "cut_done": self.cut_done,
                "video_duration": self.video_duration,
                "session": self.session,
                "events": list(self.events),
                "clips": sorted(self.clips, key=lambda c: c["event_time"]),
            }


def _split_contiguous(items: list, parts: int) -> list[list]:
    parts = max(1, min(parts, len(items)))
    size, extra = divmod(len(items), parts)
    out, start = [], 0
    for i in range(parts):
        end = start + size + (1 if i < extra else 0)
        out.append(items[start:end])
        start = end
    return [c for c in out if c]


def run_pipeline(job: JobState, video: Path, params: PipelineParams, out_dir: Path,
                 prefix: str = "") -> None:
    """prefix: prepended to clip filenames so several videos can share one
    session directory (batch runs)."""
    try:
        meta = probe(video)
        job.video_duration = meta["duration"]

        # ---------------- stage A: audio scan (global, single pass) --------
        scan = scan_audio(video, params.sensitivity, params.min_gap, params.strictness)
        events: list[Event] = scan.events
        with job.lock:
            job.candidates = scan.candidates
            job.rejected_audio = scan.rejected_audio
            job.events_total = len(events)
            job.stage = "verifying" if events else "done"
        if not events:
            with job.lock:
                job.state = "done"
            return

        speed_floor = scan.speed_floor
        visual = params.use_visual
        if visual and not pose_verifier.pose_available():
            raise RuntimeError(
                "The swing check needs the mediapipe package (0.10.x). "
                "Install it in backend/.venv and restart: "
                "pip install -r requirements.txt"
            )

        cut_q: "queue.Queue[object]" = queue.Queue(maxsize=CUT_QUEUE_DEPTH)

        # ---------------- stage C: cut workers (shared queue) --------------
        def cut_worker(decoder: str):
            while True:
                item = cut_q.get()
                try:
                    if item is _SENTINEL:
                        return
                    idx, ev = item
                    start = max(0.0, ev.time - params.pre_roll)
                    end = min(meta["duration"], ev.time + params.post_roll)
                    filename = f"{prefix}clip_{idx + 1:03d}_t{ev.time:.1f}s.mp4"
                    cut_clip(video, start, end, out_dir / filename,
                             resolution=params.resolution, decoder=decoder)
                    clip = {
                        "video": video.name,
                        "index": idx + 1,
                        "filename": filename,
                        "event_time": round(ev.time, 2),
                        "audio_snr": round(ev.audio_snr, 1),
                        "hand_speed": round(ev.hand_speed, 2),
                        "verified": ev.visually_verified,
                        "start": round(start, 2),
                        "end": round(end, 2),
                        "url": f"/media/full/{out_dir.name}/{filename}",
                    }
                    with job.lock:
                        job.clips.append(clip)
                        job.cut_done += 1
                finally:
                    cut_q.task_done()

        hw_available = ffmpeg_io.detect_hwaccel(video) is not None
        if hw_available:
            plan = ["auto"] * HW_CUT_WORKERS + ["software"] * SW_CUT_WORKERS
        else:
            plan = ["software"] * (HW_CUT_WORKERS + 1)
        cutters = [threading.Thread(target=cut_worker, args=(dec,), daemon=True, name=f"cut-{i}-{dec}")
                   for i, dec in enumerate(plan)]
        for t in cutters:
            t.start()

        # ---------------- stage B: verify workers (one segment each) -------
        indexed = list(enumerate(events))
        segments = _split_contiguous(indexed, VERIFY_WORKERS)
        failures: list[str] = []

        def verify_worker(segment: list[tuple[int, Event]]):
            for idx, ev in segment:
                try:
                    keep = True
                    if visual:
                        res = pose_verifier.measure_swing(video, ev.time)
                        ev.hand_speed = res.hand_speed
                        ev.visually_verified = res.verified
                        ev.detail = res.detail
                        if res.verified and res.hand_speed < speed_floor:
                            keep = False
                            ev.rejected = f"no swing ({res.hand_speed:.1f} < {speed_floor:.1f})"
                        elif not res.verified and not params.include_unverified:
                            keep = False
                            ev.rejected = f"not visually checked ({res.detail})"
                    with job.lock:
                        job.verified_done += 1
                        if not keep:
                            if ev.visually_verified or not visual:
                                job.rejected_visual += 1
                            else:
                                job.rejected_unverified += 1
                        else:
                            if visual and not ev.visually_verified:
                                job.unverified += 1
                            job.cut_total += 1
                            job.events.append({
                                "time": round(ev.time, 2),
                                "audio_snr": round(ev.audio_snr, 1),
                                "hand_speed": round(ev.hand_speed, 2),
                                "verified": ev.visually_verified,
                            })
                    if keep:
                        cut_q.put((idx, ev))          # blocks if cutters are behind
                except Exception as exc:              # one bad event must not kill the run
                    failures.append(f"t={ev.time:.1f}s: {exc}")
                    with job.lock:
                        job.verified_done += 1

        verifiers = [threading.Thread(target=verify_worker, args=(seg,), daemon=True,
                                      name=f"verify-{i}") for i, seg in enumerate(segments)]
        for t in verifiers:
            t.start()
        for t in verifiers:
            t.join()

        with job.lock:
            job.stage = "cutting"
        for _ in cutters:
            cut_q.put(_SENTINEL)
        for t in cutters:
            t.join()

        with job.lock:
            job.events.sort(key=lambda e: e["time"])
            job.stage = "done"
            job.state = "done"
            if failures:
                job.error = "some deliveries could not be processed: " + "; ".join(failures[:5])
    except Exception as exc:
        with job.lock:
            job.state = "error"
            job.error = str(exc)


class BatchJob:
    """Several videos processed one after another into one session.

    Videos run sequentially because a single run already saturates the
    machine (4 pose workers + 6 cutters); running two videos at once would
    only make both slower. Clips from every video land in the same session
    directory so one export can combine them.
    """

    def __init__(self, session: str):
        self.session = session
        self.jobs: list[JobState] = []
        self.state = "running"
        self.error: Optional[str] = None
        self.current = 0

    def snapshot(self) -> dict:
        parts = [j.snapshot() for j in self.jobs]
        clips = [c for pj in parts for c in pj["clips"]]
        clips.sort(key=lambda c: (c["video"], c["event_time"]))
        agg = {k: sum(pj[k] for pj in parts) for k in
               ("candidates", "rejected_audio", "events_total", "verified_done",
                "rejected_visual", "rejected_unverified", "unverified", "cut_total", "cut_done")}
        running = next((pj for pj in parts if pj["state"] == "running"), None)
        stage = running["stage"] if running else ("done" if self.state != "running" else "scanning")
        errors = [f'{pj["video"]}: {pj["error"]}' for pj in parts if pj["error"]]
        if self.error:
            errors.append(self.error)
        return {
            "state": self.state,
            "stage": stage,
            "error": "; ".join(errors) if errors else None,
            "session": self.session,
            "current": self.current,
            "videos": [{"video": pj["video"], "state": pj["state"], "stage": pj["stage"],
                        "error": pj["error"],
                        "events_total": pj["events_total"], "verified_done": pj["verified_done"],
                        "cut_done": pj["cut_done"], "cut_total": pj["cut_total"],
                        "video_duration": pj["video_duration"], "events": pj["events"]}
                       for pj in parts],
            "clips": clips,
            **agg,
        }


def run_batch(batch: BatchJob, videos: list[Path], params: PipelineParams, out_dir: Path) -> None:
    import re
    try:
        for i, (job, video) in enumerate(zip(batch.jobs, videos)):
            batch.current = i
            stub = re.sub(r"[^A-Za-z0-9_-]+", "_", video.stem)
            run_pipeline(job, video, params, out_dir, prefix=f"{stub}__")
        batch.state = "done"
    except Exception as exc:
        batch.state = "error"
        batch.error = str(exc)
