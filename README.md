# Cricket Video Editor

Point it at a recording of a batting session and it finds every delivery,
cuts each one to a few seconds either side of contact, lets you tick the
ones you want, and exports them as separate clips or one combined video.

No manual scrubbing. A 20-minute net session becomes a reviewable grid of
clips in a few minutes.

---

## Contents

- [Quick start](#quick-start)
- [Using it](#using-it)
- [How detection works](#how-detection-works)
- [How the run is parallelised](#how-the-run-is-parallelised)
- [Built for any video, not just the test footage](#built-for-any-video-not-just-the-test-footage)
- [Project layout](#project-layout)
- [API](#api)
- [Troubleshooting](#troubleshooting)

---

## Quick start

**Requirements:** Windows with PowerShell, Python 3.11. Everything else
(including ffmpeg) is installed automatically into a project-local
virtual environment.

One-time setup — adds the `cve` commands to your PowerShell profile:

```powershell
git clone https://github.com/akaashvandanapu/Cricket-Video-Editor.git
cd Cricket-Video-Editor
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\install-shell.ps1
```

Then, in **two new PowerShell windows**:

```powershell
cve-be        # backend API  ->  http://localhost:8500
```
```powershell
cve-fe        # frontend UI  ->  http://localhost:8501   <- open this
```

The first `cve-be` creates `backend\.venv` and installs the dependencies
(a few minutes). `cve` prints help; `cve-be 8502` / `cve-fe 8503` pick
other ports.

<details>
<summary>Without the shortcuts</summary>

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --app-dir . --port 8500

# second terminal
cd frontend
python -m http.server 8501
```
The UI looks for the API on port 8500; set `window.CVE_API_BASE` before
`app.js` loads if the backend runs elsewhere.
</details>

---

## Using it

Upload one or several videos from the button top-right, or drop files
anywhere on the page. Every video in the batch is shown as its own player
in the left panel (the `x` drops one from the batch without deleting the
file); the right panel is the workflow and runs over all of them.

1. **Parameters** — seconds to keep before / after each delivery,
   detection sensitivity, strictness, whether to check the video for a
   swing, minimum gap between deliveries, output resolution.
2. **Detect deliveries** — one button runs the whole pipeline. The stage
   board shows *listen -> check swing -> cut* progressing live, and **Next**
   unlocks when every clip is done.
3. **Cut clips & review** — every delivery from every video as its own
   clip, labelled with its source and its sound / hand-speed scores. Untick
   what you don't want (*Weakest first* puts the doubtful ones at the top).
   Playing a clip jumps the matching source player on the left to that
   exact moment. Choose *separate clips* or *one combined video* in the
   footer and export — a combined video can span several sources, and
   mixed portrait / landscape clips are letterboxed to one size.

Changing anything in an earlier step clears everything derived from it,
so you can never export clips that don't match the settings on screen.

**Tuning**

| You see | Do |
|---|---|
| bat taps or ball throw-backs getting through | raise **strictness** |
| soft / defensive shots being missed | lower **strictness**, or raise **sensitivity** |
| two quick deliveries merged into one | lower **minimum gap** |

---

## How detection works

Three stages. Each exists because the one before it isn't enough on its own.

**1. Sound.** Bat-on-ball is a sharp transient well above the ambient
floor, so onset-strength peaks locate candidate moments across the whole
video cheaply. Peak height is converted to an SNR against *that video's
own* noise floor, so the threshold means the same thing on a quiet phone
recording and a loud one.

**2. Timing.** Strongest-first non-max suppression over the minimum-gap
setting: a real hit's echo, or a bat tap a second later, cannot survive as
a separate event — only the loudest peak in each window does.

**3. Did anyone actually swing?** Sound alone *cannot* separate bat-on-ball
from a bat tapped on the ground or a ball thrown back — all three are
sharp transients. So around each surviving candidate the player's body
pose is measured (MediaPipe) and peak hand speed is computed in
torso-lengths per second. Loud moments where nobody swung are dropped.

### What was tried and rejected

Measured on hand-labelled footage (22 real shots vs 27 taps / throw-backs
/ idle moments), as area-under-curve — 0.5 is a coin flip, 1.0 is perfect:

| signal | AUC |
|---|---|
| audio onset strength | 0.93 |
| frame-difference motion burst | 0.65 |
| bat "streak" length / eccentricity | 0.59 / 0.60 |
| follow-through (motion after contact) | 0.59 |
| ball approaching down the pitch | 0.62 |
| **hand speed from body pose** | **0.93** |

Every classical pixel-difference idea failed for one reason: a bat *tap*
also lifts and drops the bat, so the pixels move either way. Body pose
works because it measures kinematics — a shot whips the hands through
several body-lengths per second and a tap does not. Combining sound with
pose as an AND-gate cut false positives roughly 4x with no loss of real
shots on the labelled set.

On a 4-minute sample: 64 candidate sounds -> 24 kept. All 14 known real
shots survived; 8 of 10 known false positives were removed, including a
loud noise recorded while the batsman stood still — which no audio
threshold could ever have rejected.

---

## How the run is parallelised

"Detect & cut" is one streaming pipeline (`backend/app/pipeline.py`):

```
audio scan  (1 pass over the whole video, seconds)
    |  time-ordered deliveries, split into 4 contiguous segments
    v
verify workers  x4   (pose check per delivery, one segment each)
    |  every confirmed delivery is handed straight on
    v  deep queue - verification is never throttled by cutting
cut workers  x6      (3 on the hardware decoder + 3 software, shared queue)
    |
    v  clips appear in the review tab as each one finishes
```

- **Several videos** run back to back into one session (`BatchJob`): a
  single run already saturates the machine, so running two videos at once
  would only make both slower. Clips from every video share the session
  so one export can combine them.
- The **audio scan is deliberately one pass**: its thresholds are relative
  to the whole recording (noise floor, and gap suppression needs neighbours
  on both sides of any cut point). Splitting it would change the answer at
  the seams, and it costs only seconds anyway.
- **Cutting is the expensive stage** — every clip re-decodes 4K source
  video. On an Intel iGPU the hardware decoder saturates at 3 parallel
  ffmpeg processes, so the pool is hybrid: 3 hardware + 3 software
  decoders sharing one queue (measured ~16% faster than hardware-only).
- GPU-side scaling (`vpp_qsv`) was tried and would be ~2.5x faster still,
  but it produces corrupted frames on the Intel driver tested, so it is
  not used. Hardware acceleration is probed at runtime and falls back to
  software decode automatically.

---

## Built for any video, not just the test footage

Nothing is tuned to one camera, phone, ground or recording level:

- audio thresholds are an **SNR against that video's own noise floor**
- hand speed is in **torso-lengths per second**, so distance, zoom, framing
  and resolution cancel out
- hand speed is measured **relative to the player's hips**, so camera pan,
  handheld shake and the player walking cancel out
- the real frame rate is used, so 24 / 30 / 60 fps behave the same
- the player is found with a **noise-adaptive** threshold, so brightness,
  exposure and codec noise don't matter
- phone HEVC, rotation metadata and any container ffmpeg reads are handled;
  a 480p preview copy is built so the left-hand player scrubs instantly in
  any browser

It **fails open** per delivery: if the player can't be found in that moment
(too small, occluded) the clip is kept and flagged rather than silently
dropped.

Verified by re-running detection on deliberately degraded copies of a
known clip — quiet (-14 dB), loud (+8 dB), added background noise, dark,
bright, 480p, 24 fps, 60 fps, handheld shake, half-size player, mono audio.
All 12 variants returned exactly the same deliveries.

**Known limitation:** slow-motion footage (recorded at 120/240 fps and
played back slowed) lowers apparent hand speed, so the swing check is
conservative there — lower the strictness, or turn the check off.

---

## Project layout

```
backend/
  app/
    main.py           FastAPI routes (API only - no UI is served here)
    pipeline.py       detect -> verify -> cut, as parallel stages
    detector.py       audio scan: onset peaks, SNR gate, gap suppression
    pose_verifier.py  hand-speed check from body pose (MediaPipe)
    clipper.py        ffmpeg cutting / concat / zip, hw-decode fallback
    proxy.py          480p preview copy of the source for the UI
    ffmpeg_io.py      hardware-decode probing, frame-window decoding
    video_probe.py    duration / fps / codec via OpenCV
    quiet_stderr.py   filters MediaPipe's native log spam
    config.py         paths
  requirements.txt
frontend/
  index.html / app.js / style.css   static UI, no build step
scripts/dev/
  cve-commands.ps1    cve / cve-be / cve-fe
  run-backend.ps1     creates the venv on first run, checks mediapipe
  run-frontend.ps1    static server for the UI
  install-shell.ps1   adds the commands to your PowerShell profile
videos/     your source videos          (git-ignored)
outputs/    clips, exports, proxies     (git-ignored)
```

---

## API

All routes are on the backend (`:8500`), JSON unless noted.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/library` | videos in `videos/`, newest first |
| POST | `/api/upload` | multipart upload of one or more files into `videos/` |
| GET | `/api/preview-source?video=` | what the left panel should play; whether a proxy is needed |
| POST | `/api/proxy?video=` | build the 480p preview copy (job) |
| POST | `/api/process` | run detect -> verify -> cut over a list of videos (job) |
| GET | `/api/jobs/{id}` | job progress; for a pipeline job, `clips` grows as they finish |
| POST | `/api/export` | zip and/or concatenate a chosen subset of a session's clips |
| GET | `/api/capabilities` | pose library available? which hardware decoder? |
| GET | `/media/...`, `/source/...` | clips, exports, proxies, original videos |

Interactive docs at `http://localhost:8500/docs`.

---

## Troubleshooting

- **"The swing check needs mediapipe 0.10.x"** — later MediaPipe releases
  removed the pose API this app uses. `cve-be` checks on every start and
  reinstalls `requirements.txt` if needed; to do it by hand:
  `backend\.venv\Scripts\pip install -r backend\requirements.txt`.
- **"Port 8500 is already in use"** — an earlier backend is still running;
  close that window, or use `cve-be 8502` (and set `window.CVE_API_BASE`).
- **Left-hand video is black** — the browser can't play the original
  codec; a preview copy is being built in the background and will replace
  it (a 20-minute 4K file takes a few minutes).
- **A run is slow** — cutting is bound by video decode speed. Choose 720p
  output, or trim the source before uploading.
