// The UI is a static site (cve-fe); the API is the backend on port 8500.
// Set window.CVE_API_BASE before this script if the backend runs elsewhere.
// The two are different origins, so EVERY url that comes back from the API
// (players, clips, exports) has to go through api() - a bare relative url
// would resolve against the static server and 404.
const API_BASE = window.CVE_API_BASE ?? `${location.protocol}//${location.hostname}:8500`;
const api = (path) => API_BASE + path;

const $ = (id) => document.getElementById(id);

const els = {
  uploadBtn: $("uploadBtn"), uploadInput: $("uploadInput"), uploadStatus: $("uploadStatus"),
  uploadProgressWrap: $("uploadProgressWrap"), uploadProgressBar: $("uploadProgressBar"),
  dropOverlay: $("dropOverlay"),

  sourceEmpty: $("sourceEmpty"), sourceList: $("sourceList"), sourceSync: $("sourceSync"),

  tabs: $("tabs"),
  preRoll: $("preRoll"), preRollVal: $("preRollVal"),
  postRoll: $("postRoll"), postRollVal: $("postRollVal"),
  sensitivity: $("sensitivity"), sensitivityVal: $("sensitivityVal"),
  strictness: $("strictness"), strictnessVal: $("strictnessVal"),
  minGap: $("minGap"), minGapVal: $("minGapVal"),
  resolution: $("resolution"),
  toDetectBtn: $("toDetectBtn"),

  useVisual: $("useVisual"), checkBall: $("checkBall"),
  includeUnverified: $("includeUnverified"), includeUnverifiedRow: $("includeUnverifiedRow"),
  runBtn: $("runBtn"), runStatus: $("runStatus"), toReviewBtn: $("toReviewBtn"),
  stageBoard: $("stageBoard"),
  stScan: $("stScan"), stScanVal: $("stScanVal"), stScanTime: $("stScanTime"),
  stVerify: $("stVerify"), stVerifyVal: $("stVerifyVal"), stVerifyTime: $("stVerifyTime"),
  stCut: $("stCut"), stCutVal: $("stCutVal"), stCutTime: $("stCutTime"),
  detectProgressWrap: $("detectProgressWrap"), detectProgressBar: $("detectProgressBar"),
  detectProgressText: $("detectProgressText"),
  detectBreakdown: $("detectBreakdown"), timeline: $("timeline"),

  reviewEmpty: $("reviewEmpty"), clipControls: $("clipControls"),
  selectAllBtn: $("selectAllBtn"), selectNoneBtn: $("selectNoneBtn"),
  selectedCount: $("selectedCount"),
  clipGrid: $("clipGrid"),

  exportMode: $("exportMode"), exportBtn: $("exportBtn"),
  exportStatus: $("exportStatus"), exportResult: $("exportResult"),
};

const state = {
  videos: [],         // [{ name, meta, el (<video>), item (card), removed }] - the batch
  job: null,
  running: false,
  done: false,
  session: null,
  runParams: null,    // what the current run was started with
  clips: null,        // [{...clip, selected, card}]
  timelineRows: new Map(),   // video name -> { row, strip, ticks } (ticks redrawn only when the count changes)
};

let activeTab = "params";
let pollTimer = null;

// ---------------------------------------------------------------- helpers

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function plural(n, word, words = word + "s") {
  return `${n} ${n === 1 ? word : words}`;
}

/** Seconds -> "12s" / "1:05" for run timings. */
function fmtElapsed(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return sec < 60 ? `${sec}s` : fmtDuration(sec);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function currentParams() {
  return {
    videos: state.videos.map((v) => v.name),
    sensitivity: parseFloat(els.sensitivity.value),
    strictness: parseFloat(els.strictness.value),
    use_visual: els.useVisual.checked,
    check_ball: els.checkBall.checked,
    include_unverified: anyVisualCheck() && els.includeUnverified.checked,
    min_gap: parseFloat(els.minGap.value),
    pre_roll: parseFloat(els.preRoll.value),
    post_roll: parseFloat(els.postRoll.value),
    resolution: els.resolution.value,
  };
}

function anyVisualCheck() {
  return els.useVisual.checked || els.checkBall.checked;
}

function visualStageName() {
  if (els.useVisual.checked && els.checkBall.checked) return "Swing + ball";
  if (els.checkBall.checked) return "Check ball";
  if (els.useVisual.checked) return "Check swing";
  return "Check video";
}

// ---------------------------------------------------------------- tabs

function tabDisabled(name) {
  if (name === "params") return false;
  if (name === "detect") return state.videos.length === 0;
  if (name === "review") return !state.clips || state.clips.length === 0;
  return false;
}

function setTab(name) {
  if (tabDisabled(name)) return;
  activeTab = name;
  for (const btn of els.tabs.querySelectorAll(".tab")) btn.classList.toggle("active", btn.dataset.tab === name);
  for (const p of document.querySelectorAll(".tab-panel")) p.classList.toggle("active", p.dataset.panel === name);
  for (const f of document.querySelectorAll(".footer-step")) f.classList.toggle("active", f.dataset.footer === name);
}

function refreshTabState() {
  for (const btn of els.tabs.querySelectorAll(".tab")) btn.disabled = tabDisabled(btn.dataset.tab);
  els.toReviewBtn.disabled = !state.done || !state.clips || state.clips.length === 0;
  els.runBtn.disabled = state.running || state.videos.length === 0;
  els.uploadBtn.disabled = state.running;
  els.useVisual.disabled = els.checkBall.disabled = state.running;
  els.includeUnverified.disabled = state.running || !anyVisualCheck();
  els.includeUnverifiedRow.classList.toggle("muted", !anyVisualCheck());
  els.stVerify.querySelector(".stage-name").textContent = visualStageName();
  for (const v of state.videos) v.item.querySelector(".source-remove").disabled = state.running;
  if (tabDisabled(activeTab)) setTab("params");
}

els.tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn && !btn.disabled) setTab(btn.dataset.tab);
});
els.toDetectBtn.addEventListener("click", () => setTab("detect"));
els.toReviewBtn.addEventListener("click", () => setTab("review"));

// ------------------------------------------------- stage invalidation
// Changing the batch or any parameter invalidates the run and everything
// derived from it (clips, export).
function clearRun() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state.job = null; state.running = false; state.done = false;
  state.session = null; state.clips = null; state.runParams = null; state.timelineRows = new Map();

  els.runStatus.textContent = "";
  els.stageBoard.classList.add("hidden");
  for (const s of [els.stScan, els.stVerify, els.stCut]) s.classList.remove("active", "done");
  els.stScanVal.textContent = els.stVerifyVal.textContent = els.stCutVal.textContent = "–";
  els.stScanTime.textContent = els.stVerifyTime.textContent = els.stCutTime.textContent = "";
  els.detectProgressWrap.classList.add("hidden");
  els.detectProgressBar.style.width = "0%";
  els.detectBreakdown.classList.add("hidden");
  els.detectBreakdown.innerHTML = "";
  els.timeline.classList.add("hidden");
  els.timeline.innerHTML = "";

  els.clipGrid.innerHTML = "";
  els.clipControls.classList.add("hidden");
  els.reviewEmpty.classList.remove("hidden");
  els.sourceSync.textContent = "";
  for (const v of state.videos) v.item.classList.remove("active");
  clearExport();
  refreshTabState();
}

function clearExport() {
  els.exportStatus.textContent = "";
  els.exportResult.innerHTML = "";
  els.exportBtn.disabled = !state.done || !state.clips || !state.clips.some((c) => c.selected);
}

// ---------------------------------------------------------------- sources

function setBatchCount() {
  els.uploadStatus.textContent = state.videos.length ? plural(state.videos.length, "video") : "";
}

/** Add a video to the batch (no-op if already there) and show its player. */
async function addSourceVideo(name) {
  if (state.videos.some((v) => v.name === name)) return;

  const item = document.createElement("div");
  item.className = "source-item";
  item.innerHTML = `
    <div class="source-head">
      <span class="source-name"></span>
      <button class="source-remove" title="Remove from this batch (the file stays on disk)" aria-label="Remove from batch">✕</button>
    </div>
    <video controls preload="metadata"></video>
    <div class="meta"></div>
    <div class="hint"></div>
  `;
  const nameEl = item.querySelector(".source-name");
  nameEl.textContent = name; nameEl.title = name;
  const entry = { name, meta: null, el: item.querySelector("video"), item, removed: false };
  state.videos.push(entry);
  els.sourceList.appendChild(item);
  els.sourceEmpty.classList.add("hidden");
  els.sourceList.classList.remove("hidden");
  setBatchCount();
  item.querySelector(".source-remove").addEventListener("click", () => removeSourceVideo(name));
  clearRun();

  let info;
  try {
    const res = await fetch(api(`/api/preview-source?video=${encodeURIComponent(name)}`));
    info = await res.json();
    if (!res.ok) throw new Error(info.detail || "unreadable");
  } catch (err) {
    item.querySelector(".hint").textContent = "Could not read this video: " + err.message;
    return;
  }
  if (entry.removed) return;              // dropped from the batch while we were asking
  entry.meta = info.meta;
  entry.el.src = api(info.url);
  item.querySelector(".meta").textContent =
    `${info.meta.width}x${info.meta.height} · ${(info.meta.fps || 0).toFixed(0)}fps · ${fmtDuration(info.meta.duration)}`;
  const note = item.querySelector(".hint");
  if (info.needs_proxy && !info.proxy_ready) {
    note.textContent = "Building a light preview copy…";
    buildProxy(entry, note);
  }
  entry.el.addEventListener("error", () => {
    if (entry.removed) return;
    note.textContent = "This browser can't play the original — a preview copy is being built.";
    buildProxy(entry, note);
  });
}

function removeSourceVideo(name) {
  const i = state.videos.findIndex((v) => v.name === name);
  if (i < 0 || state.running) return;
  const entry = state.videos[i];
  entry.removed = true;
  entry.el.removeAttribute("src");       // stop any in-flight media request
  entry.el.load();
  entry.item.remove();
  state.videos.splice(i, 1);
  if (state.videos.length === 0) {
    els.sourceList.classList.add("hidden");
    els.sourceEmpty.classList.remove("hidden");
  }
  setBatchCount();
  clearRun();
}

async function buildProxy(entry, note) {
  if (entry.proxyRequested) return;      // "error" can fire more than once
  entry.proxyRequested = true;
  try {
    const res = await (await fetch(api(`/api/proxy?video=${encodeURIComponent(entry.name)}`), { method: "POST" })).json();
    const swap = (url) => {
      if (entry.removed) return;
      const at = entry.el.currentTime;
      entry.el.src = api(url);
      entry.el.addEventListener("loadeddata", () => { try { entry.el.currentTime = at; } catch { /* ignore */ } }, { once: true });
      note.textContent = "";
    };
    if (res.url) { swap(res.url); return; }
    if (!res.job_id) return;
    const poll = setInterval(async () => {
      // the backend keeps building (the copy is reused later); we just stop listening
      if (entry.removed) { clearInterval(poll); return; }
      let job;
      try { job = await (await fetch(api(`/api/jobs/${res.job_id}`))).json(); } catch { return; }
      if (job.state === "done") { clearInterval(poll); swap(job.result.url); }
      else if (job.state === "error") { clearInterval(poll); note.textContent = "Preview copy failed — playing the original."; }
    }, 1500);
  } catch { /* optimisation only */ }
}

/** Move the matching source player to where this clip starts, and bring it into view. */
function syncSourceTo(clip, card) {
  const src = state.videos.find((v) => v.name === clip.video);
  if (!src || !src.el.src) return;
  const v = src.el;
  const seek = () => { try { v.currentTime = Math.max(0, clip.start); } catch { /* not seekable yet */ } };
  if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
  for (const o of state.videos) o.item.classList.toggle("active", o === src);
  src.item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  els.sourceSync.textContent = `${clip.video} at ${clip.start.toFixed(2)}s (clip ${clip.start.toFixed(2)}–${clip.end.toFixed(2)}s)`;
  for (const c of els.clipGrid.querySelectorAll(".clip-card")) c.classList.remove("playing");
  if (card) card.classList.add("playing");
}

// ---------------------------------------------------------------- upload

function uploadFiles(files) {
  if (state.running) return;
  const list = [...files].filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|mkv|avi)$/i.test(f.name));
  if (!list.length) return;
  const form = new FormData();
  for (const f of list) form.append("files", f);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", api("/api/upload"));
  els.uploadProgressWrap.classList.remove("hidden");
  els.uploadStatus.textContent = `Uploading ${plural(list.length, "file")}…`;
  els.uploadBtn.disabled = true;
  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) els.uploadProgressBar.style.width = Math.round((e.loaded / e.total) * 100) + "%";
  });
  const finish = () => {
    els.uploadProgressWrap.classList.add("hidden");
    els.uploadProgressBar.style.width = "0%";
    refreshTabState();
  };
  xhr.onload = async () => {
    finish();
    if (xhr.status === 200) {
      for (const name of JSON.parse(xhr.responseText).names) await addSourceVideo(name);
      setTab("params");
    } else {
      let detail = xhr.responseText;
      try { detail = JSON.parse(xhr.responseText).detail || detail; } catch { /* plain text */ }
      els.uploadStatus.textContent = "Upload failed";
      alert("Upload failed: " + detail);
    }
  };
  xhr.onerror = () => {
    finish();
    els.uploadStatus.textContent = "Upload failed — is the backend running on " + API_BASE + "?";
  };
  xhr.send(form);
}

els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
els.uploadInput.addEventListener("change", () => {
  if (els.uploadInput.files.length) uploadFiles(els.uploadInput.files);
  els.uploadInput.value = "";
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
  e.preventDefault(); dragDepth++; els.dropOverlay.classList.remove("hidden");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; els.dropOverlay.classList.add("hidden"); }
});
window.addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; els.dropOverlay.classList.add("hidden");
  if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------- params

// Labels are always derived from the control's live value - never from the
// HTML default - so a browser that restores form state on reload can't
// leave the label and the thumb disagreeing.
function bindSlider(input, label, digits = 1) {
  const show = () => { label.textContent = parseFloat(input.value).toFixed(digits); };
  input.addEventListener("input", show);     // mouse drag AND arrow keys
  input.addEventListener("change", clearRun);
  show();
}
bindSlider(els.preRoll, els.preRollVal);
bindSlider(els.postRoll, els.postRollVal);
bindSlider(els.sensitivity, els.sensitivityVal, 0);
bindSlider(els.strictness, els.strictnessVal, 0);
bindSlider(els.minGap, els.minGapVal);
els.resolution.addEventListener("change", clearRun);
els.useVisual.addEventListener("change", clearRun);
els.checkBall.addEventListener("change", clearRun);
els.includeUnverified.addEventListener("change", clearRun);

// ---------------------------------------------------------------- run

els.runBtn.addEventListener("click", async () => {
  if (!state.videos.length || state.running) return;
  clearRun();
  state.running = true;
  refreshTabState();
  els.runStatus.textContent = "Starting…";
  els.stageBoard.classList.remove("hidden");
  els.stScan.classList.add("active");
  try {
    state.runParams = currentParams();
    const res = await fetch(api("/api/process"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.runParams),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not start");
    state.job = data.job_id;
    pollTimer = setInterval(pollJob, 800);
  } catch (err) {
    state.running = false;
    refreshTabState();
    els.runStatus.textContent = "Error: " + err.message;
  }
});

/** [row class, status text] for one video of the batch. */
function videoLine(v, i, j) {
  if (v.state === "error") return ["error", "failed — " + (v.error || "unknown error")];
  const took = v.timing?.total ? ` · ${fmtElapsed(v.timing.total)}` : "";
  if (v.state === "done") return ["done", plural(v.cut_done, "clip") + (v.events_total === 0 ? " (no deliveries heard)" : "") + took];
  const started = i < j.current || (i === j.current && v.stage !== "scanning");
  if (started) return ["running", `${v.verified_done}/${v.events_total} checked · ${v.cut_done}/${v.cut_total} cut${took}`];
  return [i === j.current && j.state === "running" ? "running" : "", i === j.current ? "listening…" : "waiting"];
}

async function pollJob() {
  if (!state.job) return;
  let j;
  try { j = await (await fetch(api(`/api/jobs/${state.job}`))).json(); } catch { return; }
  if (!state.job) return;                 // cleared while the request was in flight

  const videos = j.videos || [];
  const t = j.timing || {};

  // stage board (aggregate over the batch)
  const nVid = videos.length || 1;
  const scanned = j.stage !== "scanning" || j.events_total > 0;
  els.stScan.classList.toggle("done", scanned && j.current >= nVid - 1 && j.stage !== "scanning");
  els.stScanVal.textContent = scanned ? plural(j.events_total, "delivery", "deliveries") : "listening…";
  els.stVerify.classList.toggle("active", j.stage === "verifying");
  els.stVerify.classList.toggle("done", j.state !== "running" && j.events_total > 0);
  const dropped = (j.rejected_visual || 0) + (j.rejected_ball || 0) + (j.rejected_unverified || 0);
  els.stVerifyVal.textContent = scanned ? `${j.verified_done} / ${j.events_total}` + (dropped ? ` · ${dropped} dropped` : "") : "–";
  els.stCut.classList.toggle("active", j.stage === "verifying" || j.stage === "cutting");
  els.stCut.classList.toggle("done", j.state === "done");
  els.stCutVal.textContent = scanned ? `${j.cut_done} / ${j.cut_total}` : "–";
  els.stScanTime.textContent = t.scan ? fmtElapsed(t.scan) : "";
  els.stVerifyTime.textContent = t.verify ? fmtElapsed(t.verify) : "";
  els.stCutTime.textContent = t.cut ? fmtElapsed(t.cut) : "";

  const total = 2 * Math.max(j.events_total, 1);
  els.detectProgressWrap.classList.remove("hidden");
  els.detectProgressBar.style.width = Math.round(100 * Math.min((j.verified_done + j.cut_done) / total, 1)) + "%";
  els.detectProgressText.textContent =
    (nVid > 1 ? `video ${Math.min(j.current + 1, nVid)} of ${nVid} · ` : "") +
    (j.stage === "scanning" ? "listening…" : `checked ${j.verified_done}/${j.events_total} · cut ${j.cut_done}/${j.cut_total}`);

  mergeClips(j.clips || []);
  renderTimeline(videos, j);

  if (j.state === "done" || j.state === "error") {
    clearInterval(pollTimer); pollTimer = null;
    state.running = false;
    state.done = j.state === "done";
    state.session = j.session;
    if (state.clips) updateSelectedCount();
    if (j.state === "error" && (!j.clips || !j.clips.length)) {
      els.runStatus.textContent = "Error: " + j.error;
    } else {
      els.runStatus.textContent = `Done — ${plural(j.cut_done, "clip")} ready` + (nVid > 1 ? ` from ${nVid} videos` : "")
        + (t.total ? ` in ${fmtElapsed(t.total)}` : "");
      renderBreakdown(j);
    }
    refreshTabState();
  } else {
    els.runStatus.textContent = (j.stage === "scanning" ? "Listening…" : "Checking and cutting…")
      + (t.total ? ` ${fmtElapsed(t.total)}` : "");
  }
}

function renderBreakdown(j) {
  const merged = Math.max(0, j.candidates - j.rejected_audio - j.events_total);   // lost to the minimum gap
  const parts = [
    `<b>${j.candidates}</b> sharp sounds found`,
    `<b>${j.rejected_audio}</b> too quiet / not sharp enough`,
    `<b>${merged}</b> within the minimum gap of a louder one`,
  ];
  const p = state.runParams || currentParams();
  if (p.use_visual) parts.push(`<b>${j.rejected_visual}</b> rejected — nobody swung`);
  if (p.check_ball) parts.push(`<b>${j.rejected_ball || 0}</b> rejected — no ball seen`);
  parts.push(`<b>${j.cut_done}</b> clips cut`);
  let html = parts.join(" &nbsp;·&nbsp; ");
  if (j.rejected_unverified) {
    html += `<br><span class="warn">${plural(j.rejected_unverified, "delivery", "deliveries")} left out because the player could not be checked — tick "Include deliveries that could not be visually checked" above to keep them.</span>`;
  }
  if (j.unverified) html += `<br><span class="warn">${j.unverified} kept without a visual check (player not clearly visible).</span>`;
  if (j.error) html += `<br><span class="warn">${escapeHtml(j.error)}</span>`;
  els.detectBreakdown.innerHTML = html;
  els.detectBreakdown.classList.remove("hidden");
}

/** One row per video: name, clip count / status, and a strip with a tick
 * per delivery between 0:00 and the video's end. Runs on every poll, so
 * only the status text is touched unless the tick count changed. */
function renderTimeline(videos, j) {
  if (!videos.length) return;
  els.timeline.classList.remove("hidden");
  videos.forEach((v, i) => {
    let r = state.timelineRows.get(v.video);
    if (!r) {
      const row = document.createElement("div");
      row.className = "tl-row";
      row.innerHTML = `
        <div class="tl-head"><b></b><span class="tl-status"></span></div>
        <div class="tl-strip"><span class="tl-empty"></span></div>
        <div class="tl-times"><span>0:00</span><span class="tl-end"></span></div>`;
      const name = row.querySelector("b");
      name.textContent = v.video; name.title = v.video;
      r = { row, strip: row.querySelector(".tl-strip"), ticks: -1 };
      state.timelineRows.set(v.video, r);
      els.timeline.appendChild(row);
    }
    const [cls, txt] = videoLine(v, i, j);
    r.row.className = "tl-row " + cls;
    r.row.querySelector(".tl-status").textContent = txt;
    r.row.querySelector(".tl-end").textContent = v.video_duration ? fmtDuration(v.video_duration) : "";
    const events = v.events || [];
    if (events.length !== r.ticks && v.video_duration) {
      r.ticks = events.length;
      r.strip.innerHTML = "";
      for (const ev of events) {
        const tick = document.createElement("div");
        tick.className = "tick";
        tick.style.left = `${(ev.time / v.video_duration) * 100}%`;
        tick.title = `${fmtDuration(ev.time)} (${ev.time.toFixed(2)}s)`;
        r.strip.appendChild(tick);
      }
    }
    const empty = r.strip.querySelector(".tl-empty") || r.strip.appendChild(Object.assign(document.createElement("span"), { className: "tl-empty" }));
    empty.textContent = events.length ? ""
      : v.state === "done" ? (v.events_total === 0 ? "no deliveries heard" : "none kept")
      : v.stage === "scanning" && cls === "running" ? "listening…" : "";
  });
}

// ---------------------------------------------------------------- review

function clipOrder(a, b) {
  const order = new Map(state.videos.map((v, i) => [v.name, i]));
  return (order.get(a.video) ?? 0) - (order.get(b.video) ?? 0) || a.event_time - b.event_time;
}

/** Add clips that arrived since the last poll. Cards are inserted in batch
 * order without rebuilding the grid: on a long video the job is polled
 * every 0.8s for minutes, and rebuilding would restart every <video>. */
function mergeClips(incoming) {
  if (!incoming.length) return;
  if (!state.clips) state.clips = [];
  const known = new Set(state.clips.map((c) => c.filename));
  let added = false;
  for (const c of incoming) {
    if (known.has(c.filename)) continue;
    const clip = { ...c, selected: true, card: null };
    clip.card = buildClipCard(clip);
    const next = state.clips.find((k) => clipOrder(clip, k) < 0);
    if (next) { state.clips.splice(state.clips.indexOf(next), 0, clip); els.clipGrid.insertBefore(clip.card, next.card); }
    else { state.clips.push(clip); els.clipGrid.appendChild(clip.card); }
    added = true;
  }
  if (added) {
    els.clipControls.classList.remove("hidden");
    els.reviewEmpty.classList.add("hidden");
    updateSelectedCount();
    refreshTabState();
  }
}

function buildClipCard(clip) {
  const card = document.createElement("div");
  card.className = "clip-card" + (clip.selected ? "" : " excluded");
  const scores = [];
  if (clip.audio_snr != null) scores.push(`<span title="how far the sound stands above this video's noise floor">sound ${clip.audio_snr}</span>`);
  if (clip.hand_speed != null && clip.hand_speed > 0) scores.push(`<span title="peak hand speed, torso-lengths per second">hands ${clip.hand_speed.toFixed(1)}</span>`);
  if (clip.verified === false) scores.push(`<span class="unverified">not visually checked</span>`);
  if (state.runParams?.check_ball) {
    if (clip.ball === true) scores.push(`<span class="ball-yes" title="frames the ball was tracked for on its way to the batsman">ball ✓ ${clip.ball_track}</span>`);
    else if (clip.ball === false) scores.push(`<span class="unverified">ball ✗</span>`);
    else scores.push(`<span class="unverified">ball ?</span>`);
  }
  const multi = state.videos.length > 1;
  card.innerHTML = `
    <video controls preload="metadata"></video>
    <div class="clip-label">Delivery at ${clip.event_time}s</div>
    ${multi ? `<div class="clip-video" title="${escapeHtml(clip.video)}">${escapeHtml(clip.video)}</div>` : ""}
    <div class="clip-scores">${scores.join(" · ")}</div>
    <label class="clip-check"><input type="checkbox" ${clip.selected ? "checked" : ""} autocomplete="off" /> Keep this clip</label>
  `;
  const video = card.querySelector("video");
  video.src = api(clip.url);
  video.addEventListener("play", () => syncSourceTo(clip, card));
  video.addEventListener("seeked", () => { if (!video.paused) syncSourceTo(clip, card); });
  card.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") syncSourceTo(clip, card); });
  const checkbox = card.querySelector('input[type="checkbox"]');
  checkbox.addEventListener("change", () => setClipSelected(clip, checkbox.checked));
  return card;
}

function setClipSelected(clip, selected) {
  clip.selected = selected;
  clip.card.classList.toggle("excluded", !selected);
  const box = clip.card.querySelector('input[type="checkbox"]');
  if (box.checked !== selected) box.checked = selected;
}

function updateSelectedCount() {
  const n = state.clips.filter((c) => c.selected).length;
  els.selectedCount.textContent = `${n} / ${state.clips.length} selected`;
  clearExport();
}

function selectAllClips(selected) {
  if (!state.clips) return;
  for (const c of state.clips) setClipSelected(c, selected);
  updateSelectedCount();
}
els.selectAllBtn.addEventListener("click", () => selectAllClips(true));
els.selectNoneBtn.addEventListener("click", () => selectAllClips(false));
els.clipGrid.addEventListener("change", (e) => { if (e.target.type === "checkbox") updateSelectedCount(); });

// ---------------------------------------------------------------- export

els.exportBtn.addEventListener("click", async () => {
  const mode = els.exportMode.value;
  const filenames = state.clips.filter((c) => c.selected).map((c) => c.filename);   // batch order
  if (!filenames.length || !state.session) return;
  els.exportStatus.textContent = mode === "concat" ? "Combining…" : "Zipping…";
  els.exportBtn.disabled = true;
  els.exportResult.innerHTML = "";
  try {
    const res = await fetch(api("/api/export"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: state.session, filenames, mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Export failed");
    els.exportStatus.textContent = `Ready (${plural(filenames.length, "clip")})`;
    let html = "";
    // links go through /api/download, which sets Content-Disposition so the
    // browser saves the file instead of opening it (the UI is on another origin)
    if (data.zip_url) html += `<a href="${api(data.zip_url)}">Download clips (.zip)</a>`;
    if (data.concat_url) html += `<a href="${api(data.concat_url)}">Download combined video</a>`;
    els.exportResult.innerHTML = html;
  } catch (err) {
    els.exportStatus.textContent = "Error: " + err.message;
  } finally {
    els.exportBtn.disabled = !state.clips || !state.clips.some((c) => c.selected);
  }
});
els.exportMode.addEventListener("change", () => { if (state.clips) clearExport(); });

// ---------------------------------------------------------------- boot

// The batch always starts empty: files already in videos/ are never
// auto-loaded, so a reload shows exactly what the user has uploaded.
setTab("params");
refreshTabState();
