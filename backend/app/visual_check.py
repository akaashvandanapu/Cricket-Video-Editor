"""One decode per delivery, shared by both visual checks.

Decoding is the cost: 4K HEVC runs at a handful of frames per second even
on the hardware decoder, and every `-ss` seek re-decodes from the previous
keyframe. The output width is almost free by comparison. So instead of the
swing check decoding its own 640 px window and the ball check another at
1280 px, the pipeline decodes [onset - 0.5 s, onset + 0.3 s] once at
1280 px; the swing check gets a 640 px resize of the last 0.6 s of it, the
ball check gets all of it.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from . import ball_verifier, ffmpeg_io, pose_verifier
from .ball_verifier import BallResult
from .pose_verifier import SwingResult

_frame_size_cache: dict[str, tuple[int, int]] = {}


@dataclass
class VisualWindow:
    frames: np.ndarray       # (n, h, w, 3) bgr24, ANALYSIS_WIDTH wide
    fps: float
    onset_k: int             # frame index of the sound

    @property
    def swing_start(self) -> int:
        return max(0, self.onset_k - int(round(pose_verifier.HALF_WINDOW * self.fps)))

    @property
    def swing_frames(self) -> np.ndarray:
        """The +-HALF_WINDOW slice the swing check was calibrated on."""
        return self.frames[self.swing_start:]


def decode_window(video: Path, event_time: float) -> VisualWindow:
    key = str(video)
    if key not in _frame_size_cache:
        _frame_size_cache[key] = ffmpeg_io.probe_frame_size(video, ball_verifier.ANALYSIS_WIDTH, "bgr24")
    h, w = _frame_size_cache[key]
    pre, post = ball_verifier.PRE_SECONDS, ball_verifier.POST_SECONDS
    start = max(0.0, event_time - pre)
    frames = ffmpeg_io.decode_window(video, start, event_time + post - start, w, h, "bgr24")
    n = len(frames)
    duration = event_time + post - start
    fps = n / duration if duration > 0 else 0.0
    return VisualWindow(frames, fps, int(round((event_time - start) * fps)))


def check_swing(win: VisualWindow) -> SwingResult:
    return pose_verifier.measure_swing_frames(win.swing_frames, win.fps)


def player_box_at_onset(win: VisualWindow, swing: SwingResult,
                        reach: int = 4) -> Optional[tuple[float, float, float, float]]:
    """Union of the pose extents within `reach` frames of the sound. The
    whole-swing union would be inflated by the backlift and follow-through;
    around contact the box is the player as the ball meets them."""
    near = [b for k, b in swing.player_extents if abs(k + win.swing_start - win.onset_k) <= reach]
    if not near:
        near = [b for _, b in swing.player_extents]
    if not near:
        return None
    e = np.array(near)
    return (float(max(0.0, e[:, 0].min())), float(min(1.0, e[:, 1].max())),
            float(max(0.0, e[:, 2].min())), float(min(1.0, e[:, 3].max())))


def check_ball(win: VisualWindow, swing: SwingResult) -> BallResult:
    """Only meaningful after the swing check: it supplies the player box.
    The whole window is examined even though the ball has arrived by the
    sound: the audio onset is a frame or two uncertain and the ball is
    still visible just after it, and the extra frames sharpen the
    background estimate."""
    try:
        box = player_box_at_onset(win, swing)
        return ball_verifier.find_ball(win.frames, win.fps, win.onset_k, box)
    except Exception as exc:                    # never let the extra check kill a run
        return BallResult(None, 0, f"ball check failed: {exc}")
