"""Visual verification: did the player actually swing at the ball?

Audio alone cannot tell a bat-ball crack from a bat hitting the ground or
a ball being thrown back - all three are sharp transients. This stage
looks at the player's body around each candidate moment and measures how
fast the hands travel, which is what a real shot requires.

What was tried and rejected (measured on hand-labelled footage, 22 real
shots vs 27 taps/throws/idle moments):

    signal                                   AUC
    audio onset strength (baseline)          0.93
    frame-difference motion burst            0.65
    bat "streak" length / eccentricity       0.59 / 0.60
    follow-through (motion after contact)    0.59
    ball approaching down the pitch          0.62
    >> hand speed from body pose             0.93

Classical pixel-difference features all failed for a simple reason: a bat
tap also lifts and drops the bat, so the pixels move either way. Body
pose works because it measures kinematics - a shot whips the hands through
several body-lengths per second, a tap does not.

Generalisation notes (this must work on anyone's video, not just the
footage it was built against):
 - speed is expressed in TORSO LENGTHS PER SECOND, so camera distance,
   resolution, framing and zoom all cancel out
 - speed is measured RELATIVE TO THE PLAYER'S HIPS, so camera pan,
   handheld shake and the player walking cancel out
 - real frame rate is used, so 24/30/60 fps footage behaves the same
 - the player is located from motion with a noise-adaptive threshold, so
   brightness / exposure / codec noise do not matter
 - it FAILS OPEN: if pose can't be found (player too small, occluded,
   mediapipe not installed) the candidate is kept and flagged unverified,
   never silently dropped

Limitation worth knowing: slow-motion footage (recorded at 120/240fps and
played back slowed) lowers apparent hand speed, so the visual stage will
be conservative there.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from . import ffmpeg_io

ANALYSIS_WIDTH = 640
HALF_WINDOW = 0.30          # seconds of video examined either side of the sound
MIN_POSE_FRACTION = 0.5     # need landmarks on this share of frames to judge

_pose_import_error: Optional[str] = None


def pose_available() -> bool:
    return _load_pose() is not None


def _load_pose():
    """Import mediapipe lazily - it is an optional dependency and a slow
    import, and the app must work without it."""
    global _pose_import_error
    try:
        os.environ.setdefault("GLOG_minloglevel", "3")
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
        from mediapipe.python.solutions import pose as mp_pose
        return mp_pose
    except Exception as exc:  # pragma: no cover - depends on environment
        _pose_import_error = str(exc)
        return None


def pose_unavailable_reason() -> Optional[str]:
    return _pose_import_error


@dataclass
class SwingResult:
    hand_speed: float       # peak hand speed, torso-lengths per second
    verified: bool          # False = could not measure (fails open)
    detail: str


def _player_box(gray: np.ndarray) -> Optional[tuple[int, int, int, int]]:
    """Locate the player from what moves, using a threshold derived from
    the clip's own noise level rather than a fixed pixel value."""
    a = gray.astype(np.float32)
    diff = np.abs(np.diff(a, axis=0))
    med = float(np.median(diff))
    mad = float(np.median(np.abs(diff - med))) + 1e-6
    thr = max(6.0, 4.0 * (med + 1.4826 * mad))

    fg = np.abs(a - np.median(a, axis=0)) > thr
    persistent = fg.mean(axis=0) > 0.45          # moves through most of the window
    if persistent.sum() < 40:
        persistent = fg.mean(axis=0) > 0.25
    if persistent.sum() < 40:
        return None
    ys, xs = np.nonzero(persistent)
    return int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())


def measure_swing(video: Path, event_time: float) -> SwingResult:
    """Peak hand speed around `event_time`, in torso-lengths per second."""
    mp_pose = _load_pose()
    if mp_pose is None:
        return SwingResult(0.0, False, "pose library unavailable")

    try:
        import cv2
        h, w = ffmpeg_io.probe_frame_size(video, ANALYSIS_WIDTH, "bgr24")
        frames = ffmpeg_io.decode_window(video, event_time - HALF_WINDOW,
                                         2 * HALF_WINDOW, ANALYSIS_WIDTH, h, "bgr24")
    except Exception as exc:
        return SwingResult(0.0, False, f"decode failed: {exc}")

    n = len(frames)
    if n < 6:
        return SwingResult(0.0, False, "too few frames")
    fps = n / (2 * HALF_WINDOW)

    gray = frames[..., 1]  # green channel as a cheap luma proxy
    box = _player_box(gray)
    if box is None:
        cy0, cy1, cx0, cx1 = 0, h, 0, ANALYSIS_WIDTH
    else:
        y0, y1, x0, x1 = box
        my, mx = 0.35 * (y1 - y0), 0.6 * (x1 - x0)
        cy0, cy1 = int(max(0, y0 - my)), int(min(h, y1 + my))
        cx0, cx1 = int(max(0, x0 - mx)), int(min(ANALYSIS_WIDTH, x1 + mx))
    if cy1 - cy0 < 32 or cx1 - cx0 < 32:
        cy0, cy1, cx0, cx1 = 0, h, 0, ANALYSIS_WIDTH

    LM = mp_pose.PoseLandmark
    wrists: list[Optional[np.ndarray]] = []
    hips: list[Optional[np.ndarray]] = []
    torsos: list[float] = []
    found = 0

    with mp_pose.Pose(model_complexity=1, min_detection_confidence=0.3,
                      min_tracking_confidence=0.3) as pose:
        for k in range(n):
            crop = frames[k, cy0:cy1, cx0:cx1]
            res = pose.process(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            if not res.pose_landmarks:
                wrists.append(None); hips.append(None); torsos.append(0.0)
                continue
            L = res.pose_landmarks.landmark
            hh, ww = crop.shape[0], crop.shape[1]

            def pt(idx: int) -> np.ndarray:
                return np.array([L[idx].x * ww, L[idx].y * hh])

            shoulder = (pt(LM.LEFT_SHOULDER.value) + pt(LM.RIGHT_SHOULDER.value)) / 2
            hip = (pt(LM.LEFT_HIP.value) + pt(LM.RIGHT_HIP.value)) / 2
            wrists.append((pt(LM.LEFT_WRIST.value) + pt(LM.RIGHT_WRIST.value)) / 2)
            hips.append(hip)
            torsos.append(float(np.linalg.norm(shoulder - hip)))
            found += 1

    if found < MIN_POSE_FRACTION * n:
        return SwingResult(0.0, False, f"player not found in {n - found}/{n} frames")

    torso = float(np.median([t for t in torsos if t > 0]))
    if torso < 4:
        return SwingResult(0.0, False, "player too small to measure")

    speeds = []
    for k in range(n - 1):
        if wrists[k] is None or wrists[k + 1] is None:
            continue
        # hand movement relative to the hips cancels camera/player translation
        r0 = wrists[k] - hips[k]
        r1 = wrists[k + 1] - hips[k + 1]
        speeds.append(float(np.linalg.norm(r1 - r0) / torso * fps))

    if not speeds:
        return SwingResult(0.0, False, "no usable landmark pairs")
    return SwingResult(float(max(speeds)), True, f"pose on {found}/{n} frames")
