"""Video metadata probing via OpenCV (avoids depending on ffprobe, which
imageio-ffmpeg does not bundle)."""
from pathlib import Path

import cv2


def probe(video_path: Path) -> dict:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path.name}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC) or 0)
    cap.release()
    duration = (frame_count / fps) if fps > 0 else 0.0
    codec = "".join(chr((fourcc >> (8 * i)) & 0xFF) for i in range(4)).strip()
    return {
        "duration": duration,
        "fps": fps,
        "width": width,
        "height": height,
        "codec": codec,
    }
