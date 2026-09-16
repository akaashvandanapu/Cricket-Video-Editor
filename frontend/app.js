// The UI is a static site (cve-fe); the API is the backend on port 8500.
// Set window.CVE_API_BASE before this script if the backend runs elsewhere.
const API_BASE = window.CVE_API_BASE ?? `${location.protocol}//${location.hostname}:8500`;
const api = (path) => API_BASE + path;

const $ = (id) => document.getElementById(id);

const els = {
  uploadBtn: $("uploadBtn"), uploadInput: $("uploadInput"), uploadStatus: $("uploadStatus"),
  uploadProgressWrap: $("uploadProgressWrap"), uploadProgressBar: $("uploadProgressBar"),
  dropOverlay: $("dropOverlay"),

  sourceEmpty: $("sourceEmpty"), sourceWrap: $("sourceWrap"), sourceVideo: $("sourceVideo"),
  sourceMeta: $("sourceMeta"), sourceSync: $("sourceSync"), proxyNote: $("proxyNote"),

  tabs: $("tabs"),
  preRoll: $("preRoll"), preRollVal: $("preRollVal"),
  postRoll: $("postRoll"), postRollVal: $("postRollVal"),
  sensitivity: $("sensitivity"), sensitivityVal: $("sensitivityVal"),
  strictness: $("strictness"), strictnessVal: $("strictnessVal"),
  useVisual: $("useVisual"),
  minGap: $("minGap"), minGapVal: $("minGapVal"),
  resolution: $("resolution"),
  toDetectBtn: $("toDetectBtn"),

  runBtn: $("runBtn"), runStatus: $("runStatus"), toReviewBtn: $("toReviewBtn"),
  detectStatus: $("detectStatus"),
  stageBoard: $("stageBoard"),
  stScan: $("stScan"), stScanVal: $("stScanVal"),
  stVerify: $("stVerify"), stVerifyVal: $("stVerifyVal"),
  stCut: $("stCut"), stCutVal: $("stCutVal"),
  detectProgressWrap: $("detectProgressWrap"), detectProgressBar: $("detectProgressBar"),
  detectProgressText: $("detectProgressText"),
  detectBreakdown: $("detectBreakdown"), timeline: $("timeline"),

  reviewEmpty: $("reviewEmpty"), clipControls: $("clipControls"),
  selectAllBtn: $("selectAllBtn"), selectNoneBtn: $("selectNoneBtn"),
  sortByConfidence: $("sortByConfidence"), selectedCount: $("selectedCount"),
  clipGrid: $("clipGrid"),

  exportMode: $("exportMode"), exportBtn: $("exportBtn"),
  exportStatus: $("exportStatus"), exportResult: $("exportResult"),
};

const state = {
  video: null,
  meta: null,
  job: null,          // id of the running/finished pipeline job
  running: false,
  done: false,
  session: null,
  clips: null,        // [{...clip, selected}]
};

let activeTab = "params";
let pollTimer = null;

// ---------------------------------------------------------------- helpers

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function currentParams() {
  return {
    video: state.video,
    sensitivity: parseFloat(els.sensitivity.value),
    strictness: parseFloat(els.strictness.value),
    use_visual: els.useVisual.checked,
    min_gap: parseFloat(els.minGap.value),
    pre_roll: parseFloat(els.preRoll.value),
    post_roll: parseFloat(els.postRoll.value),
    resolution: els.resolution.value,
  };
}

// ---------------------------------------------------------------- tabs

function tabDisabled(name) {
  if (name === "params") return false;
  if (name === "detect") return !state.video;
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
  if (tabDisabled(activeTab)) setTab("params");
}

els.tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn && !btn.disabled) setTab(btn.dataset.tab);
});
els.toDetectBtn.addEventListener("click", () => setTab("detect"));
els.toReviewBtn.addEventListener("click", () => setTab("review"));

// ------------------------------------------------- stage invalidation
// Changing the source or any parameter invalidates the run and everything
// derived from it (clips, export).
function clearRun() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state.job = null; state.running = false; state.done = false;
  state.session = null; state.clips = null;

  els.detectStatus.textContent = "";
  els.runStatus.textContent = "";
  els.runBtn.disabled = !state.video;
  els.stageBoard.classList.add("hidden");
  for (const s of [els.stScan, els.stVerify, els.stCut]) s.classList.remove("active", "done");
  els.stScanVal.textContent = els.stVerifyVal.textContent = els.stCutVal.textContent = "–";
  els.detectProgressWrap.classList.add("hidden");
  els.detectProgressBar.style.width = "0%";
  els.detectBreakdown.classList.add("hidden");
  els.detectBreakdown.innerHTML = "";
  els.timeline.classList.add("hidden");
  els.timeline.innerHTML = "";

  els.clipGrid.innerHTML = "";
  els.clipControls.classList.add("hidden");
  els.reviewEmpty.classList.remove("hidden");
  clearExport();
  refreshTabState();
}

function clearExport() {
  els.exportStatus.textContent = "";
  els.exportResult.innerHTML = "";
  els.exportBtn.disabled = !state.clips || !state.clips.some((c) => c.selected);
}

// ---------------------------------------------------------------- source

async function setSourceVideo(name) {
  state.video = name;
  els.uploadStatus.textContent = name;
  els.sourceEmpty.classList.add("hidden");
  els.sourceWrap.classList.remove("hidden");
  clearRun();

  let info;
  try {
    info = await (await fetch(api(`/api/preview-source?video=${encodeURIComponent(name)}`))).json();
  } catch { return; }
  state.meta = info.meta;
  els.sourceVideo.src = api(info.url);
  els.sourceMeta.textContent =
    `${info.meta.width}x${info.meta.height} · ${(info.meta.fps || 0).toFixed(0)}fps · ${fmtDuration(info.meta.duration)}`;
  els.proxyNote.textContent = (info.needs_proxy && !info.proxy_ready)
    ? "Building a light preview copy for smooth scrubbing…" : "";
  if (info.needs_proxy && !info.proxy_ready) buildProxy(name);
  refreshTabState();
}

async function buildProxy(name) {
  try {
    const res = await (await fetch(api(`/api/proxy?video=${encodeURIComponent(name)}`), { method: "POST" })).json();
    if (res.url) { swapToProxy(res.url); return; }
    if (!res.job_id) return;
    const poll = setInterval(async () => {
      const job = await (await fetch(api(`/api/jobs/${res.job_id}`))).json();
      if (job.state === "done") { clearInterval(poll); if (state.video === name) swapToProxy(job.result.url); }
      else if (job.state === "error") { clearInterval(poll); els.proxyNote.textContent = "Preview copy failed — playing the original instead."; }
    }, 1500);
  } catch { /* optimisation only */ }
}

function swapToProxy(url) {
  const at = els.sourceVideo.currentTime;
  els.sourceVideo.src = api(url);
  els.sourceVideo.addEventListener("loadeddata", function once() {
    els.sourceVideo.removeEventListener("loadeddata", once);
    try { els.sourceVideo.currentTime = at; } catch { /* ignore */ }
  });
  els.proxyNote.textContent = "";
}

els.sourceVideo.addEventListener("error", () => {
  if (!state.video) return;
  els.proxyNote.textContent = "This browser can't play the original directly — building a preview copy, it will appear when ready.";
  buildProxy(state.video);
});

/** Move the left-hand player to where this clip starts in the source. */
function syncSourceTo(clip, card) {
  const v = els.sourceVideo;
  if (!v.src) return;
  const seek = () => { try { v.currentTime = Math.max(0, clip.start); } catch { /* not seekable yet */ } };
  if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
  els.sourceSync.textContent = `Source at ${clip.start.toFixed(2)}s (clip ${clip.start.toFixed(2)}–${clip.end.toFixed(2)}s)`;
  for (const c of els.clipGrid.querySelectorAll(".clip-card")) c.classList.remove("playing");
  if (card) card.classList.add("playing");
}

// ---------------------------------------------------------------- upload

function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", api("/api/upload"));
  els.uploadProgressWrap.classList.remove("hidden");
  els.uploadStatus.textContent = `Uploading ${file.name}…`;
  els.uploadBtn.disabled = true;
  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) els.uploadProgressBar.style.width = Math.round((e.loaded / e.total) * 100) + "%";
  });
  xhr.onload = () => {
    els.uploadProgressWrap.classList.add("hidden");
    els.uploadProgressBar.style.width = "0%";
    els.uploadBtn.disabled = false;
    if (xhr.status === 200) { setSourceVideo(JSON.parse(xhr.responseText).name); setTab("params"); }
    else { els.uploadStatus.textContent = "Upload failed"; alert("Upload failed: " + xhr.responseText); }
  };
  xhr.onerror = () => {
    els.uploadProgressWrap.classList.add("hidden");
    els.uploadBtn.disabled = false;
    els.uploadStatus.textContent = "Upload failed";
  };
  xhr.send(form);
}

els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
els.uploadInput.addEventListener("change", () => {
  if (els.uploadInput.files[0]) uploadFile(els.uploadInput.files[0]);
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
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});

// ---------------------------------------------------------------- params

function bindSlider(input, label, digits = 1) {
  input.addEventListener("input", () => { label.textContent = parseFloat(input.value).toFixed(digits); });
  input.addEventListener("change", clearRun);
}
bindSlider(els.preRoll, els.preRollVal);
bindSlider(els.postRoll, els.postRollVal);
bindSlider(els.sensitivity, els.sensitivityVal, 0);
bindSlider(els.strictness, els.strictnessVal, 0);
bindSlider(els.minGap, els.minGapVal);
els.resolution.addEventListener("change", clearRun);
els.useVisual.addEventListener("change", clearRun);

// ---------------------------------------------------------------- run

els.runBtn.addEventListener("click", async () => {
  if (!state.video || state.running) return;
  clearRun();
  state.running = true;
  els.runBtn.disabled = true;
  els.runStatus.textContent = "Starting…";
  els.stageBoard.classList.remove("hidden");
  els.stScan.classList.add("active");
  try {
    const res = await fetch(api("/api/process"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentParams()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not start");
    state.job = data.job_id;
    pollTimer = setInterval(pollJob, 800);
  } catch (err) {
    state.running = false;
    els.runBtn.disabled = false;
    els.runStatus.textContent = "Error: " + err.message;
  }
});

async function pollJob() {
  if (!state.job) return;
  let j;
  try { j = await (await fetch(api(`/api/jobs/${state.job}`))).json(); } catch { return; }

  // stage board
  const scanned = j.stage !== "scanning";
  els.stScan.classList.toggle("done", scanned);
  els.stScanVal.textContent = scanned ? `${j.events_total} deliveries` : "listening…";
  els.stVerify.classList.toggle("active", j.stage === "verifying");
  els.stVerify.classList.toggle("done", scanned && j.verified_done >= j.events_total && j.events_total > 0);
  els.stVerifyVal.textContent = scanned ? `${j.verified_done} / ${j.events_total}` + (j.rejected_visual ? ` · ${j.rejected_visual} no swing` : "") : "–";
  els.stCut.classList.toggle("active", j.stage === "verifying" || j.stage === "cutting");
  els.stCut.classList.toggle("done", j.state === "done");
  els.stCutVal.textContent = scanned ? `${j.cut_done} / ${j.cut_total}` : "–";

  // overall progress = verify + cut work units
  const total = 2 * Math.max(j.events_total, 1);
  const doneUnits = j.verified_done + j.cut_done;
  els.detectProgressWrap.classList.remove("hidden");
  els.detectProgressBar.style.width = Math.round(100 * Math.min(doneUnits / total, 1)) + "%";
  els.detectProgressText.textContent = j.stage === "scanning" ? "listening to the whole video…"
    : `checked ${j.verified_done}/${j.events_total} · cut ${j.cut_done}/${j.cut_total}`;

  // clips stream in as they finish
  mergeClips(j.clips || []);
  if (j.events && j.events.length) renderTimeline(j.events, j.video_duration);

  if (j.state === "done" || j.state === "error") {
    clearInterval(pollTimer); pollTimer = null;
    state.running = false;
    state.done = j.state === "done";
    state.session = j.session;
    els.runBtn.disabled = false;
    if (state.clips) updateSelectedCount();   // export only unlocks once the run is complete
    if (j.state === "error" && (!j.clips || !j.clips.length)) {
      els.runStatus.textContent = "Error: " + j.error;
    } else {
      els.runStatus.textContent = `Done — ${j.cut_done} clips ready`;
      renderBreakdown(j);
      if (j.error) els.detectBreakdown.innerHTML += `<br><span class="warn">${j.error}</span>`;
    }
    refreshTabState();
  } else {
    els.runStatus.textContent = j.stage === "scanning" ? "Listening…" : "Checking and cutting…";
  }
}

function renderBreakdown(j) {
  const parts = [
    `<b>${j.candidates}</b> sharp sounds found`,
    `<b>${j.rejected_audio}</b> too quiet / not sharp enough`,
  ];
  if (j.rejected_visual || els.useVisual.checked) parts.push(`<b>${j.rejected_visual}</b> rejected — nobody swung`);
  parts.push(`<b>${j.cut_done}</b> clips cut`);
  let html = parts.join(" &nbsp;·&nbsp; ");
  if (j.unverified) html += `<br><span class="warn">${j.unverified} kept without a visual check (player not clearly visible).</span>`;
  els.detectBreakdown.innerHTML = html;
  els.detectBreakdown.classList.remove("hidden");
}

function renderTimeline(events, duration) {
  els.timeline.innerHTML = "";
  els.timeline.classList.remove("hidden");
  if (!duration) return;
  for (const ev of events) {
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = `${(ev.time / duration) * 100}%`;
    tick.title = `${ev.time.toFixed(2)}s`;
    els.timeline.appendChild(tick);
  }
}

// ---------------------------------------------------------------- review

/** Add any clips not yet shown; existing cards (and their tick state) stay. */
function mergeClips(incoming) {
  if (!incoming.length) return;
  if (!state.clips) state.clips = [];
  const known = new Set(state.clips.map((c) => c.filename));
  let added = false;
  for (const c of incoming) {
    if (!known.has(c.filename)) { state.clips.push({ ...c, selected: true }); added = true; }
  }
  if (added) {
    state.clips.sort((a, b) => a.event_time - b.event_time);
    renderClipGrid();
    refreshTabState();
  }
}

function renderClipGrid() {
  els.clipGrid.innerHTML = "";
  els.clipControls.classList.remove("hidden");
  els.reviewEmpty.classList.add("hidden");

  const ordered = state.clips.slice();
  if (els.sortByConfidence.checked) {
    ordered.sort((a, b) => (a.hand_speed ?? 0) - (b.hand_speed ?? 0) || (a.audio_snr ?? 0) - (b.audio_snr ?? 0));
  }

  for (const clip of ordered) {
    const card = document.createElement("div");
    card.className = "clip-card" + (clip.selected ? "" : " excluded");
    const scores = [];
    if (clip.audio_snr != null) scores.push(`sound ${clip.audio_snr}`);
    if (clip.hand_speed != null && clip.hand_speed > 0) scores.push(`hands ${clip.hand_speed.toFixed(1)}`);
    if (clip.verified === false) scores.push(`<span class="unverified">not visually checked</span>`);
    card.innerHTML = `
      <video controls preload="metadata" src="${api(clip.url)}"></video>
      <div class="clip-label">Delivery at ${clip.event_time}s</div>
      <div class="clip-scores">${scores.join(" · ")}</div>
      <label class="clip-check"><input type="checkbox" ${clip.selected ? "checked" : ""} /> Keep this clip</label>
    `;
    const video = card.querySelector("video");
    video.addEventListener("play", () => syncSourceTo(clip, card));
    video.addEventListener("seeked", () => { if (!video.paused) syncSourceTo(clip, card); });
    card.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") syncSourceTo(clip, card); });
    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", () => {
      clip.selected = checkbox.checked;
      card.classList.toggle("excluded", !clip.selected);
      updateSelectedCount();
      clearExport();
    });
    els.clipGrid.appendChild(card);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  const n = state.clips.filter((c) => c.selected).length;
  els.selectedCount.textContent = `${n} / ${state.clips.length} selected`;
  els.exportBtn.disabled = n === 0 || !state.done;
}

els.sortByConfidence.addEventListener("change", () => { if (state.clips) renderClipGrid(); });
els.selectAllBtn.addEventListener("click", () => { if (!state.clips) return; state.clips.forEach((c) => (c.selected = true)); renderClipGrid(); clearExport(); });
els.selectNoneBtn.addEventListener("click", () => { if (!state.clips) return; state.clips.forEach((c) => (c.selected = false)); renderClipGrid(); clearExport(); });

// ---------------------------------------------------------------- export

els.exportBtn.addEventListener("click", async () => {
  const mode = els.exportMode.value;
  const filenames = state.clips.filter((c) => c.selected).map((c) => c.filename);
  els.exportStatus.textContent = "Exporting…";
  els.exportBtn.disabled = true;
  els.exportResult.innerHTML = "";
  try {
    const res = await fetch(api("/api/export"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: state.session, filenames, mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Export failed");
    els.exportStatus.textContent = `Done (${filenames.length} clips)`;
    let html = "";
    if (data.zip_url) html += `<a href="${api(data.zip_url)}" download>Download clips (.zip)</a>`;
    if (data.concat_url) html += `<a href="${api(data.concat_url)}" download>Download combined video</a>`;
    els.exportResult.innerHTML = html;
  } catch (err) {
    els.exportStatus.textContent = "Error: " + err.message;
  } finally {
    els.exportBtn.disabled = false;
  }
});

// ---------------------------------------------------------------- boot

async function boot() {
  setTab("params");
  try {
    const lib = await (await fetch(api("/api/library"))).json();   // newest first
    if (lib.videos.length) await setSourceVideo(lib.videos[0].name);
  } catch { /* backend not up yet */ }
  refreshTabState();
}

boot();
