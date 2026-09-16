"""Second visual signal: was a ball actually delivered to the batsman?

The swing check answers "did the player swing?". This answers "was there
something to swing at?" - it looks for a small object travelling towards
the player in the moments before the sound, whatever its colour.

Why a TRACK and not a blob. An earlier attempt looked for a ball-shaped
blob per frame at 480 px analysis width and scored AUC 0.62: the ball was
1-3 px and the detector saturated on background motion (netting, leaves,
camera shake). Two things fix that:

 1. Resolution. At 1280 px analysis width a ball near the batsman on 4K
    phone footage is 15-25 px. The cost is not the width - 4K HEVC decode
    dominates - so the pipeline decodes ONE 1280 px window per delivery
    and shares it with the swing check.
 2. Physics instead of appearance. Per frame, everything that differs
    from the window's temporal median (after cancelling camera shake) is a
    candidate. Candidates are linked into constant-velocity tracks, and a
    track counts as the ball only if it
      - starts at least 0.4 body-heights away from the player,
      - closes in on the player monotonically (a bounce is allowed: the
        path bends but the distance keeps shrinking),
      - stays no higher than half a body above the head - near the batsman
        a delivery is between the ground and about head height from any
        camera angle; thrashing netting and leaves above the head are not,
      - ends at body height, next to the player, and
      - arrives within about a third of a second of the sound.
    and it must be the ONLY such track: a person walking through the
    frame fragments into several blobs that all "approach" together, a
    ball is one object.
    Nothing else in a net session (a lifting bat, a walking feeder, a
    swaying net, a ball thrown back - which moves AWAY) survives all of these.

Measured on the labelled 4-minute sample (14 real deliveries, 6 loud
non-shots): 9/14 deliveries produce a ball track, 0/6 non-shots do. The
misses are deliveries where the ball is inside a burst of other motion -
the feeder's arm close to the lens, or the net thrashing - so the signal
has high precision but only ~65% recall. That is why it is an OPTIONAL
gate, off by default, independent of the swing check; when on, every clip
card shows its verdict. On 720p sources the ball is rarely resolvable.

Colour is never used: the ball may be red, white, pink or anything else.
All sizes and distances are fractions of the player's height, so camera
distance and resolution cancel out.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

ANALYSIS_WIDTH = 1280        # px; see module docstring
PRE_SECONDS = 0.5            # how long before the sound the ball is looked for
POST_SECONDS = 0.3           # after the sound (the swing check needs this much too)
MIN_TRACK = 5                # frames a track must span
MAX_PASSING_TRACKS = 2       # more "balls" than this at once is a person walking through


@dataclass
class BallResult:
    seen: Optional[bool]     # True = ball track found, False = none, None = could not assess
    track_len: int           # frames the ball was followed for (0 if none)
    detail: str


def _stabilise(g: np.ndarray) -> np.ndarray:
    """Shift every frame onto the middle one to cancel handheld shake.
    Integer translation on a quarter-size copy is enough: a ball moves far
    more than a hand tremor between frames."""
    ref = cv2.resize(g[len(g) // 2], None, fx=0.25, fy=0.25)
    out = np.empty_like(g)
    for k in range(len(g)):
        small = cv2.resize(g[k], None, fx=0.25, fy=0.25)
        (dx, dy), _ = cv2.phaseCorrelate(ref, small)
        dx, dy = int(round(dx * 4)), int(round(dy * 4))
        if dx == 0 and dy == 0:
            out[k] = g[k]
        else:
            m = np.float32([[1, 0, -dx], [0, 1, -dy]])
            out[k] = cv2.warpAffine(g[k], m, (g.shape[2], g.shape[1]), borderMode=cv2.BORDER_REPLICATE)
    return out


def _candidates(g: np.ndarray, exclude: tuple[int, int, int, int],
                min_area: int, max_area: int) -> list[list[tuple[float, float, float]]]:
    """Per frame: small compact blobs that differ from the temporal median."""
    bg = np.median(g, axis=0)
    diff = np.abs(g - bg)
    med = float(np.median(diff))
    mad = float(np.median(np.abs(diff - med))) + 1e-6
    thr = max(16.0, med + 8.0 * 1.4826 * mad)          # noise-adaptive
    ey0, ey1, ex0, ex1 = exclude
    out = []
    for k in range(len(g)):
        m = (diff[k] > thr).astype(np.uint8)
        m[ey0:ey1, ex0:ex1] = 0                            # the player moves; ignore
        n, _, stats, cent = cv2.connectedComponentsWithStats(m, 8)
        cs = []
        for i in range(1, n):
            x, y, w, h, a = stats[i]
            if a < min_area or a > max_area:
                continue
            if max(w, h) > 6 * min(w, h):                  # thin edge, not an object
                continue
            if a < 0.25 * w * h:                           # hollow / ragged
                continue
            cs.append((float(cent[i][0]), float(cent[i][1]), float(a)))
        out.append(cs)
    return out


Track = list[tuple[int, float, float, float]]      # (frame, x, y, area)


def _tracks(cands: list[list[tuple[float, float, float]]], max_step: float) -> list[Track]:
    """Greedy constant-velocity linking; a track may skip up to 2 frames."""
    done: list[Track] = []
    active: list[Track] = []
    for k, cs in enumerate(cands):
        used: set[int] = set()
        nxt = []
        for tr in active:
            k0, x0, y0, _ = tr[-1]
            if k - k0 > 2:
                done.append(tr)
                continue
            if len(tr) >= 2:
                k1, x1, y1, _ = tr[-2]
                vx, vy = (x0 - x1) / (k0 - k1), (y0 - y1) / (k0 - k1)
                px, py = x0 + vx * (k - k0), y0 + vy * (k - k0)
                tol = 0.35 * float(np.hypot(vx, vy)) * (k - k0) + 0.15 * max_step
            else:
                px, py, tol = x0, y0, max_step * (k - k0)
            best, bd = None, tol
            for i, (x, y, _) in enumerate(cs):
                if i in used:
                    continue
                d = float(np.hypot(x - px, y - py))
                if d < bd:
                    best, bd = i, d
            if best is None:
                nxt.append(tr)
            else:
                used.add(best)
                nxt.append(tr + [(k, *cs[best])])
        for i, (x, y, a) in enumerate(cs):
            if i not in used:
                nxt.append([(k, x, y, a)])
        active = nxt
    done += active
    return [t for t in done if len(t) >= MIN_TRACK]


def _box_distance(x: float, y: float, box: tuple[int, int, int, int]) -> float:
    y0, y1, x0, x1 = box
    return float(np.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1)))


def _score(tr: Track, body: tuple[int, int, int, int], fps: float, onset_k: int) -> float:
    """Track length if it behaves like a delivery reaching the player, else 0."""
    y0, y1, _, _ = body
    ph = max(1, y1 - y0)
    pts = np.array([[x, y] for _, x, y, _ in tr])
    ks = np.array([k for k, _, _, _ in tr])
    dists = np.array([_box_distance(x, y, body) for x, y in pts])
    steps = np.diff(dists)
    mono = float((steps < 0.02 * ph).mean()) if len(steps) else 0.0
    path = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
    speed = path / max(1, ks[-1] - ks[0]) * fps / ph     # body-heights per second
    when = (ks[-1] - onset_k) / fps
    ok = (dists[0] >= 0.4 * ph                             # starts away from the player
          and dists[-1] <= 0.35 * ph                       # ends next to them
          and mono >= 0.75 and speed >= 1.0                # closes in, and fast
          and (pts[:, 1] >= y0 - 0.5 * ph).all()           # never far above the head
          and y0 <= pts[-1][1] <= (y1 + 0.25 * ph)         # ends between head and feet
          and -0.3 <= when <= 0.12)                        # arrives at the sound
    return len(tr) * mono if ok else 0.0


def find_ball(frames: np.ndarray, fps: float, onset_k: int,
              player_box: Optional[tuple[float, float, float, float]]) -> BallResult:
    """frames: (n, h, w, 3) bgr24 covering [onset - PRE, onset + POST];
    player_box: (y0, y1, x0, x1) as frame fractions from the pose check."""
    if player_box is None:
        return BallResult(None, 0, "player position unknown")
    n = len(frames)
    if n < 8:
        return BallResult(None, 0, "too few frames")
    H, W = frames.shape[1], frames.shape[2]
    y0, y1 = int(player_box[0] * H), int(player_box[1] * H)
    x0, x1 = int(player_box[2] * W), int(player_box[3] * W)
    ph = y1 - y0
    if ph < 40:
        return BallResult(None, 0, "player too small")

    # only the band the ball can reach the player through
    by0, by1 = max(0, y0 - ph), min(H, y1 + ph)
    g = frames[:, by0:by1, :, 1].astype(np.float32)        # green channel as luma
    y0, y1 = y0 - by0, y1 - by0
    body = (y0, y1, x0, x1)
    pad = int(0.08 * ph)
    exclude = (max(0, y0 - pad), min(by1 - by0, y1 + pad), max(0, x0 - pad), min(W, x1 + pad))

    g = _stabilise(g)
    cands = _candidates(g, exclude, min_area=max(4, int((0.01 * ph) ** 2)),
                        max_area=int((0.09 * ph) ** 2))     # a ball, even as a blur streak
    passing = sorted((_score(tr, body, fps, onset_k) for tr in _tracks(cands, max_step=0.6 * ph)),
                     reverse=True)
    passing = [p for p in passing if p > 0]
    if len(passing) > MAX_PASSING_TRACKS:
        return BallResult(False, 0, f"{len(passing)} objects approached together (a person, not a ball)")
    if passing:
        n_frames = int(round(passing[0]))
        return BallResult(True, n_frames, f"ball tracked for {n_frames} frames")
    return BallResult(False, 0, "no object seen travelling to the player")
