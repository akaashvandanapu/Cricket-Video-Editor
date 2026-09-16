"""ffmpeg-backed clip cutting, concatenation and zipping."""
from pathlib import Path
import subprocess
import zipfile

from . import ffmpeg_io
from .config import FFMPEG_EXE

RESOLUTION_FILTERS = {
    "original": None,
    "1080": "scale=-2:1080",
    "720": "scale=-2:720",
}


def _cut_cmd(video_path: Path, start: float, duration: float, out_path: Path,
             resolution: str, hwaccel: str | None) -> list[str]:
    cmd = [FFMPEG_EXE, "-y"]
    if hwaccel:
        # decode on the GPU but hand frames back to system memory, so the
        # software filter chain (and rotation metadata) still applies
        cmd += ["-hwaccel", hwaccel, "-hwaccel_output_format", "nv12"]
    cmd += [
        "-ss", f"{start:.3f}",
        "-i", str(video_path),
        "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-avoid_negative_ts", "make_zero",
    ]
    vf = RESOLUTION_FILTERS.get(resolution)
    if vf:
        cmd += ["-vf", vf]
    cmd.append(str(out_path))
    return cmd


def cut_clip(video_path: Path, start: float, end: float, out_path: Path,
             resolution: str = "1080", decoder: str = "auto") -> None:
    """decoder: "auto" = hardware if available, else software;
    "software" = force CPU decode (used to add cutters beyond what the
    hardware decoder can feed - see pipeline.py)."""
    start = max(0.0, start)
    duration = max(0.05, end - start)
    if decoder == "software":
        attempts = (None,)
    else:
        # decoding is the bottleneck on 4K phone footage: hardware first,
        # software fallback if it is unavailable or fails
        attempts = (ffmpeg_io.detect_hwaccel(video_path), None)
    last_err = b""
    for hwaccel in attempts:
        result = subprocess.run(_cut_cmd(video_path, start, duration, out_path,
                                         resolution, hwaccel), capture_output=True)
        if result.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
            return
        last_err = result.stderr
        if hwaccel is None:
            break
    raise RuntimeError(
        f"ffmpeg failed cutting {start:.2f}-{end:.2f}s: "
        f"{last_err.decode(errors='ignore')[-800:]}"
    )


def _dims(path: Path) -> tuple[int, int]:
    import cv2
    cap = cv2.VideoCapture(str(path))
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return w, h


def concat_clips(clip_paths: list[Path], out_path: Path) -> None:
    """Join clips in order. Clips from one video share a frame size, so a
    stream copy is enough; a batch across videos can mix portrait and
    landscape, in which case every clip is letterboxed to the first clip's
    size and re-encoded."""
    if len({_dims(p) for p in clip_paths}) > 1:
        w, h = _dims(clip_paths[0])
        n = len(clip_paths)
        cmd = [FFMPEG_EXE, "-y"]
        for p in clip_paths:
            cmd += ["-i", str(p)]
        chains = "".join(
            f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}];"
            f"[{i}:a]aresample=48000[a{i}];" for i in range(n))
        streams = "".join(f"[v{i}][a{i}]" for i in range(n))
        cmd += ["-filter_complex", f"{chains}{streams}concat=n={n}:v=1:a=1[v][a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", "-b:a", "128k", str(out_path)]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0 or not out_path.exists():
            raise RuntimeError("ffmpeg concat (mixed sizes) failed: "
                               + result.stderr.decode(errors="ignore")[-800:])
        return

    list_file = out_path.with_suffix(".txt")
    with list_file.open("w", encoding="utf-8") as f:
        for p in clip_paths:
            escaped = str(p).replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")
    cmd = [
        FFMPEG_EXE, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c", "copy",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True)
    list_file.unlink(missing_ok=True)
    if result.returncode != 0 or not out_path.exists():
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr.decode(errors='ignore')[-800:]}")


def zip_clips(clip_paths: list[Path], out_path: Path) -> None:
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in clip_paths:
            zf.write(p, arcname=p.name)
