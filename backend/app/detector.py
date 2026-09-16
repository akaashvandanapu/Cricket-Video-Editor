"""Delivery detection: a sharp sound, then a check that a shot was played.

Stage 1 - audio (scans the whole video, cheap)
    A bat-ball contact is a sharp transient well above the ambient floor.
    Onset-strength peaks find those moments. Peak height is converted to
    an SNR against the video's OWN noise floor, so the threshold means the
    same thing on a quiet phone recording and a loud one.

Stage 2 - timing
    Strongest-first non-max suppression over `min_gap`, so a real hit's
    echo, or a tap right beside it, cannot survive as a separate event.

Stage 3 - visual (only around surviving candidates, optional)
    Hand speed from body pose, in torso-lengths per second. Rejects loud
    moments where nobody swung - a bat tapped on the ground, a ball thrown
    back, a door banging. See pose_verifier for what else was tried.

Nothing here is tuned to a particular camera, phone, ground or recording
level: every threshold is either an SNR against that video's own noise, a
body-relative speed, or a duration in seconds.
"""
from __future__ import annotations

import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import librosa
import numpy as np

from . import ffmpeg_io
from .config import FFMPEG_EXE, TMP_DIR

HOP_SECONDS = 0.01
SAMPLE_RATE = 22050

# Local-contrast floor for peak picking, i.e. how far a peak must stand out
# from its immediate neighbourhood. "sensitivity" maps onto this.
DELTA_MAX = 5.5
DELTA_MIN = 0.5

# Absolute-ish gates, both expressed in units that transfer between videos.
# Calibrated against hand-labelled footage; "strictness" scales them.
AUDIO_SNR_BASE = 25.0        # peak height in robust sigmas above the noise floor
HAND_SPEED_BASE = 3.0        # torso-lengths per second

CANDIDATE_WAIT_SECONDS = 0.15


@dataclass
class Event:
    time: float
    strength: float
    audio_snr: float
    hand_speed: float = 0.0
    visually_verified: bool = False
    detail: str = ""
    rejected: Optional[str] = None


def _sensitivity_to_delta(sensitivity: float) -> float:
    sensitivity = max(0.0, min(100.0, sensitivity))
    return DELTA_MAX - (sensitivity / 100.0) * (DELTA_MAX - DELTA_MIN)


def _strictness_to_gates(strictness: float) -> tuple[float, float]:
    """strictness 0..100 -> (audio SNR floor, hand-speed floor).
    50 reproduces the calibrated operating point; 0 disables both gates."""
    f = max(0.0, min(100.0, strictness)) / 50.0
    return AUDIO_SNR_BASE * f, HAND_SPEED_BASE * f


def _extract_mono_audio(video_path: Path) -> Path:
    if not ffmpeg_io.has_audio_stream(video_path):
        raise RuntimeError(
            f'"{video_path.name}" has no audio track. Deliveries are found by '
            f"the sound of bat on ball, so a silent video cannot be processed."
        )
    tmp_wav = TMP_DIR / f"audio_{uuid.uuid4().hex[:10]}.wav"
    cmd = [FFMPEG_EXE, "-y", "-i", str(video_path),
           "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), str(tmp_wav)]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0 or not tmp_wav.exists():
        raise RuntimeError(
            f'Could not read the audio in "{video_path.name}" '
            f"(ffmpeg exited {result.returncode})."
        )
    return tmp_wav


def _suppress_nearby(cands: list[Event], min_gap: float) -> list[Event]:
    kept: list[Event] = []
    for ev in sorted(cands, key=lambda e: -e.strength):
        if all(abs(ev.time - k.time) >= min_gap for k in kept):
            kept.append(ev)
    kept.sort(key=lambda e: e.time)
    return kept


@dataclass
class AudioScan:
    events: list[Event] = field(default_factory=list)   # time-ordered survivors
    candidates: int = 0
    rejected_audio: int = 0
    noise_floor: float = 0.0
    speed_floor: float = 0.0     # hand-speed gate the caller should apply


def scan_audio(video_path: Path, sensitivity: float = 50.0, min_gap: float = 3.5,
               strictness: float = 50.0) -> AudioScan:
    """Stages 1 + 2: one pass over the whole recording. Stage 3 (the pose
    check) is run per event by the pipeline so it can be parallelised."""
    out = AudioScan()
    audio_floor, out.speed_floor = _strictness_to_gates(strictness)

    tmp_wav = _extract_mono_audio(video_path)
    try:
        y, sr = librosa.load(str(tmp_wav), sr=None)
        if y.size == 0:
            return out
        hop = max(1, int(sr * HOP_SECONDS))
        env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        if env.size == 0:
            return out

        # noise floor of THIS video, so the SNR gate transfers across
        # recording levels, microphones and distances
        med = float(np.median(env))
        mad = float(np.median(np.abs(env - med)))
        sigma = max(1.4826 * mad, 1e-6)
        out.noise_floor = med

        peaks = librosa.util.peak_pick(
            env, pre_max=15, post_max=15, pre_avg=40, post_avg=40,
            delta=_sensitivity_to_delta(sensitivity),
            wait=max(1, int(CANDIDATE_WAIT_SECONDS / (hop / sr))),
        )
        if len(peaks) == 0:
            return out

        times = librosa.frames_to_time(peaks, sr=sr, hop_length=hop)
        cands: list[Event] = []
        for p, t in zip(peaks, times):
            # take the local max: a single frame can sit in a trough right
            # beside the true peak
            s = float(env[max(0, p - 2): p + 3].max())
            cands.append(Event(time=float(t), strength=s, audio_snr=(s - med) / sigma))
        out.candidates = len(cands)
    finally:
        tmp_wav.unlink(missing_ok=True)

    loud = [c for c in cands if c.audio_snr >= audio_floor]
    out.rejected_audio = len(cands) - len(loud)
    out.events = _suppress_nearby(loud, min_gap)
    return out
