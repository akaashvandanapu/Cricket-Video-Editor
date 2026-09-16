"""ffmpeg plumbing: hardware-accelerated decode with automatic fallback,
plus raw frame-window extraction for analysis.

Hardware decode is probed once at runtime and cached. It is a pure
optimisation - every call falls back to software decode if the hardware
path is unavailable or fails, so this works on Intel/NVIDIA/AMD/no-GPU
machines alike.

Note on rotation: frames are always taken through ffmpeg's normal
(software) filter chain, which applies the file's rotation metadata. GPU
filter chains like scale_qsv bypass that and silently emit sideways video,
so they are deliberately not used here.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional

import numpy as np

from .config import FFMPEG_EXE

# candidate hwaccel backends, tried in order; None = software
_HWACCEL_CANDIDATES = ["qsv", "d3d11va", "cuda", "videotoolbox", "vaapi"]
_hwaccel: Optional[str] = None
_hwaccel_probed = False


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True)


def _hwaccel_args(backend: Optional[str]) -> list[str]:
    if not backend:
        return []
    # download frames back to system memory so software filters (including
    # auto-rotation) still apply
    return ["-hwaccel", backend, "-hwaccel_output_format", "nv12"]


def detect_hwaccel(sample_video: Path) -> Optional[str]:
    """Probe once for a working hardware decoder. Returns the backend name
    or None for software decoding."""
    global _hwaccel, _hwaccel_probed
    if _hwaccel_probed:
        return _hwaccel
    _hwaccel_probed = True
    for backend in _HWACCEL_CANDIDATES:
        cmd = [FFMPEG_EXE, "-hide_banner", "-loglevel", "error",
               *_hwaccel_args(backend),
               "-ss", "0", "-i", str(sample_video), "-frames:v", "2",
               "-vf", "scale=128:-2,format=gray",
               "-f", "rawvideo", "-pix_fmt", "gray", "-"]
        try:
            res = _run(cmd)
        except Exception:
            continue
        if res.returncode == 0 and len(res.stdout) > 0:
            _hwaccel = backend
            return _hwaccel
    _hwaccel = None
    return None


def current_hwaccel() -> Optional[str]:
    return _hwaccel


def probe_frame_size(video: Path, width: int, pix: str = "gray") -> tuple[int, int]:
    """Decode a single frame to learn the exact (height, width) ffmpeg
    emits at this analysis width, after rotation metadata is applied."""
    bpp = {"gray": 1, "bgr24": 3}[pix]
    cmd = [FFMPEG_EXE, "-hide_banner", "-loglevel", "error",
           "-i", str(video), "-frames:v", "1",
           "-vf", f"scale={width}:-2" + (",format=gray" if pix == "gray" else ""),
           "-f", "rawvideo", "-pix_fmt", pix, "-"]
    out = _run(cmd).stdout
    if not out:
        raise RuntimeError(f"could not decode a frame from {video.name}")
    h = len(out) // (width * bpp)
    return h, width


def decode_window(video: Path, start: float, duration: float, width: int,
                  height: int, pix: str = "gray") -> np.ndarray:
    """Decode a short window of frames at `width` px wide.

    Returns (n, h, w) for gray or (n, h, w, 3) for bgr24. Tries hardware
    decode first, falls back to software on failure.
    """
    bpp = {"gray": 1, "bgr24": 3}[pix]
    vf = f"scale={width}:-2" + (",format=gray" if pix == "gray" else "")
    for backend in (detect_hwaccel(video), None):
        cmd = [FFMPEG_EXE, "-hide_banner", "-loglevel", "error",
               *_hwaccel_args(backend),
               "-ss", f"{max(0.0, start):.3f}", "-i", str(video),
               "-t", f"{max(0.01, duration):.3f}",
               "-vf", vf, "-f", "rawvideo", "-pix_fmt", pix, "-"]
        buf = _run(cmd).stdout
        frame_bytes = height * width * bpp
        n = len(buf) // frame_bytes if frame_bytes else 0
        if n:
            arr = np.frombuffer(buf[: n * frame_bytes], dtype=np.uint8)
            return arr.reshape((n, height, width, 3) if pix == "bgr24" else (n, height, width))
        if backend is None:
            break
    shape = (0, height, width, 3) if pix == "bgr24" else (0, height, width)
    return np.zeros(shape, dtype=np.uint8)


def has_audio_stream(video: Path) -> bool:
    """True if ffmpeg can pull any audio out of this file."""
    cmd = [FFMPEG_EXE, "-hide_banner", "-loglevel", "error",
           "-i", str(video), "-vn", "-t", "0.2", "-ac", "1", "-ar", "8000",
           "-f", "s16le", "-"]
    res = _run(cmd)
    return res.returncode == 0 and len(res.stdout) > 0
