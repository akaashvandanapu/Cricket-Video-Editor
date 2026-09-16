"""Browser-friendly preview copy of the source video.

The left-hand panel plays the raw video and has to seek to an exact moment
whenever a clip is reviewed. Playing the original is unreliable in general:
phone footage is often HEVC (which some browsers refuse), 4K seeking is
slow, and an uploaded file could be any codec or container.

So for anything that isn't already small and plainly playable, a 480p
H.264 copy is built once with dense keyframes (-g 30) so scrubbing is
instant. The original file is never modified.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from . import ffmpeg_io
from .config import FFMPEG_EXE, PROXY_DIR

# codecs every current browser plays without help
BROWSER_SAFE_CODECS = {"avc1", "h264", "x264", "mp4v", "vp09", "vp80", "vp90"}
MAX_DIRECT_HEIGHT = 1080


def proxy_path(video_path: Path) -> Path:
    stub = re.sub(r"[^A-Za-z0-9_-]+", "_", video_path.stem)
    return PROXY_DIR / f"{stub}.mp4"


def needs_proxy(video_path: Path, meta: dict) -> bool:
    codec = (meta.get("codec") or "").lower().strip("\x00 ")
    height = max(meta.get("width") or 0, meta.get("height") or 0)
    if codec not in BROWSER_SAFE_CODECS:
        return True
    return height > MAX_DIRECT_HEIGHT


def build_proxy(video_path: Path) -> Path:
    out = proxy_path(video_path)
    if out.exists() and out.stat().st_size > 0:
        return out
    tmp = out.with_suffix(".partial.mp4")
    last_err = b""
    for hwaccel in (ffmpeg_io.detect_hwaccel(video_path), None):
        cmd = [FFMPEG_EXE, "-y"]
        if hwaccel:
            cmd += ["-hwaccel", hwaccel, "-hwaccel_output_format", "nv12"]
        cmd += ["-i", str(video_path),
                "-vf", "scale=-2:480",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                "-g", "30",                      # keyframe every second: fast seeking
                "-c:a", "aac", "-b:a", "96k",
                "-movflags", "+faststart",
                str(tmp)]
        res = subprocess.run(cmd, capture_output=True)
        if res.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            tmp.replace(out)                     # publish atomically
            return out
        last_err = res.stderr
        tmp.unlink(missing_ok=True)
        if hwaccel is None:
            break
    raise RuntimeError(
        f"could not build a preview copy of {video_path.name}: "
        f"{last_err.decode(errors='ignore')[-400:]}"
    )
