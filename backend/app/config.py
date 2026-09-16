from pathlib import Path

import imageio_ffmpeg

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VIDEOS_DIR = PROJECT_ROOT / "videos"
OUTPUT_DIR = PROJECT_ROOT / "outputs"
FULL_DIR = OUTPUT_DIR / "full"
TMP_DIR = OUTPUT_DIR / "tmp"
PROXY_DIR = OUTPUT_DIR / "proxy"

for d in (VIDEOS_DIR, OUTPUT_DIR, FULL_DIR, TMP_DIR, PROXY_DIR):
    d.mkdir(parents=True, exist_ok=True)

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".avi"}
