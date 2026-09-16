// The UI is a static site (cve-fe); the API is the backend on port 8500.
// Set window.CVE_API_BASE before this script if the backend runs elsewhere.
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
  useVisual: $("useVisual"),
  minGap: $("minGap"), minGapVal: $("minGapVal"),
  resolution: $("resolution"),
  toDetectBtn: $("toDetectBtn"),

  runBtn: $("runBtn"), runStatus: $("runStatus"), toReviewBtn: $("toReviewBtn"),
  detectStatus: $("detectStatus"), videoProgress: $("videoProgress"),
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
  videos: [],         // [{ name, meta, el (<video>), item (card) }] - the batch
  job: null,
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
    videos: state.videos.map((v) => v.name),
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
  state.session = null; state.clips = null;

  els.detectStatus.textContent = "";
  els.runStatus.textContent = "";
  els.videoProgress.innerHTML = "";
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
  els.sourceSync.textContent = "";
  for (const v of state.videos) v.item.classList.remove("active");
  clearExport();
  refreshTabState();
}

function clearExport() {
  els.exportStatus.textContent = "";
  els.exportResult.innerHTML = "";
  els.exportBtn.disabled = !state.clips || !state.clips.some((c) => c.selected);
}

// ---------------------------------------------------------------- sources

/** Add a video to the batch (no-op if already there) and show its player. */
async function addSourceVideo(name) {
  if (state.videos.some((v) => v.name === name)) return;

  const item = document.createElement("div");
  item.className = "source-item";
  item.innerHTML = `
    <div class="source-head">
      <span class="source-name" title="${name}">${name}</span>
      <button class="source-remove" title="Remove from this batch (the file stays on disk)">✕</button>
    </div>
    <video controls preload="metadata"></video>
    <div class="meta"></div>
    <div class="hint"></div>
  `;
  const entry = { name, meta: null, el: item.querySelector("video"), item };
  state.videos.push(entry);
  els.sourceList.appendChild(item);
  els.sourceEmpty.classList.add("hidden");
  els.sourceList.classList.remove("hidden");
  els.uploadStatus.textContent = `${state.videos.length} video${state.videos.length > 1 ? "s" : ""}`;
  item.querySelector(".source-remove").addEventListener("click", () => removeSourceVideo(name));
  clearRun();

  let info;
  try {
    info = await (await fetch(api(`/api/preview-source?video=${encodeURIComponent(name)}`))).json();
  } catch { return; }
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
    note.textContent = "This browser can't play the original — a preview copy is being built.";
    buildProxy(entry, note);
  });
}

function removeSourceVideo(name) {
  const i = state.videos.findIndex((v) => v.name === name);
  if (i < 0 || state.running) return;
  state.videos[i].item.remove();
  state.videos.splice(i, 1);
  if (state.videos.length === 0) {
    els.sourceList.classList.add("hidden");
    els.sourceEmpty.classList.remove("hidden");
    els.uploadStatus.textContent = "";
  } else {
    els.uploadStatus.textContent = `${state.videos.length} video${state.videos.length > 1 ? "s" : ""}`;
  }
  clearRun();
}

async function buildProxy(entry, note) {
  try {
    const res = await (await fetch(api(`/api/proxy?video=${encodeURIComponent(entry.name)}`), { method: "POST" })).json();
    const swap = (url) => {
      const at = entry.el.currentTime;
      entry.el.src = api(url);
      entry.el.addEventListener("loadeddata", () => { try { entry.el.currentTime = at; } catch { /* ignore */ } }, { once: true });
      note.textContent = "";
    };
    if (res.url) { swap(res.url); return; }
    if (!res.job_id) return;
    const poll = setInterval(async () => {
      const job = await (await fetch(api(`/api/jobs/${res.job_id}`))).json();
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
  const list = [...files].filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|mkv|avi)$/i.test(f.name));
  if (!list.length) return;
  const form = new FormData();
  for (const f of list) form.append("files", f);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", api("/api/upload"));
  els.uploadProgressWrap.classList.remove("hidden");
  els.uploadStatus.textContent = `Uploading ${list.length} file${list.length > 1 ? "s" : ""}…`;
  els.uploadBtn.disabled = true;
  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) els.uploadProgressBar.style.width = Math.round((e.loaded / e.total) * 100) + "%";
  });
  xhr.onload = async () => {
    els.uploadProgressWrap.classList.add("hidden");
    els.uploadProgressBar.style.width = "0%";
    els.uploadBtn.disabled = false;
    if (xhr.status === 200) {
      for (const name of JSON.parse(xhr.responseText).names) await addSourceVideo(name);
      setTab("params");
    } else {
      els.uploadStatus.textContent = "Upload failed";
      alert("Upload failed: " + xhr.responseText);
    }
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
  if (!state.videos.length || state.running) return;
  clearRun();
  state.running = true;
  refreshTabState();
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
    refreshTabState();
    els.runStatus.textContent = "Error: " + err.message;
  }
});

async function pollJob() {
  if (!state.job) return;
  let j;
  try { j = await (await fetch(api(`/api/jobs/${state.job}`))).json(); } catch { return; }

  // per-video lines
  els.videoProgress.innerHTML = (j.videos || []).map((v, i) => {
    const cls = v.state === "done" ? "done" : (i === j.current && j.state === "running" ? "running" : "");
    const txt = v.state === "done"
      ? `${v.cut_done} clips`
      : (i < j.current || (i === j.current && v.stage !== "scanning"))
        ? `${v.verified_done}/${v.events_total} checked · ${v.cut_done}/${v.cut_total} cut`
        : (i === j.current ? "listening…" : "waiting");
    return `<div class="vp ${cls}"><b>${v.video}</b><span>${txt}</span></div>`;
  }).join("");

  // stage board (aggregate over the batch)
  const scanned = j.stage !== "scanning" || j.events_total > 0;
  els.stScan.classList.toggle("done", scanned && j.current >= (j.videos?.length || 1) - 1 && j.stage !== "scanning");
  els.stScanVal.textContent = scanned ? `${j.events_total} deliveries` : "listening…";
  els.stVerify.classList.toggle("active", j.stage === "verifying");
  els.stVerify.classList.toggle("done", j.state !== "running" && j.events_total > 0);
  els.stVerifyVal.textContent = scanned ? `${j.verified_done} / ${j.events_total}` + (j.rejected_visual ? ` · ${j.rejected_visual} no swing` : "") : "–";
  els.stCut.classList.toggle("active", j.stage === "verifying" || j.stage === "cutting");
  els.stCut.classList.toggle("done", j.state === "done");
  els.stCutVal.textContent = scanned ? `${j.cut_done} / ${j.cut_total}` : "–";

  const total = 2 * Math.max(j.events_total, 1);
  els.detectProgressWrap.classList.remove("hidden");
  els.detectProgressBar.style.width = Math.round(100 * Math.min((j.verified_done + j.cut_done) / total, 1)) + "%";
  const nVid = j.videos?.length || 1;
  els.detectProgressText.textContent =
    (nVid > 1 ? `video ${Math.min(j.current + 1, nVid)} of ${nVid} · ` : "") +
    (j.stage === "scanning" ? "listening…" : `checked ${j.verified_done}/${j.events_total} · cut ${j.cut_done}/${j.cut_total}`);

  mergeClips(j.clips || []);
  renderTimeline(j.videos || []);

  if (j.state === "done" || j.state === "error") {
    clearInterval(pollTimer); pollTimer = null;
    state.running = false;
    state.done = j.state === "done";
    state.session = j.session;
    if (state.clips) updateSelectedCount();
    if (j.state === "error" && (!j.clips || !j.clips.length)) {
      els.runStatus.textContent = "Error: " + j.error;
    } else {
      els.runStatus.textContent = `Done — ${j.cut_done} clips ready` + (nVid > 1 ? ` from ${nVid} videos` : "");
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

/** One timeline strip per video, deliveries as ticks. */
function renderTimeline(videos) {
  const withEvents = videos.filter((v) => v.events && v.events.length && v.video_duration);
  if (!withEvents.length) return;
  els.timeline.classList.remove("hidden");
  els.timeline.innerHTML = "";
  els.timeline.style.height = `${withEvents.length * 34}px`;
  withEvents.forEach((v, row) => {
    for (const ev of v.events) {
      const tick = document.createElement("div");
      tick.className = "tick";
      tick.style.left = `${(ev.time / v.video_duration) * 100}%`;
      tick.style.top = `${row * 34 + 4}px`;
      tick.style.bottom = "auto";
      tick.style.height = "26px";
      tick.title = `${v.video} · ${ev.time.toFixed(2)}s`;
      els.timeline.appendChild(tick);
    }
  });
}

// ---------------------------------------------------------------- review

function mergeClips(incoming) {
  if (!incoming.length) return;
  if (!state.clips) state.clips = [];
  const known = new Set(state.clips.map((c) => c.filename));
  let added = false;
  for (const c of incoming) {
    if (!known.has(c.filename)) { state.clips.push({ ...c, selected: true }); added = true; }
  }
  if (added) {
    const order = new Map(state.videos.map((v, i) => [v.name, i]));
    state.clips.sort((a, b) => (order.get(a.video) ?? 0) - (order.get(b.video) ?? 0) || a.event_time - b.event_time);
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
  const multi = state.videos.length > 1;

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
      ${multi ? `<div class="clip-video" title="${clip.video}">${clip.video}</div>` : ""}
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
  const filenames = state.clips.filter((c) => c.selected).map((c) => c.filename);   // batch order
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
    // start with the most recent video on disk; upload adds more to the batch
    const lib = await (await fetch(api("/api/library"))).json();   // newest first
    if (lib.videos.length) await addSourceVideo(lib.videos[0].name);
  } catch { /* backend not up yet */ }
  refreshTabState();
}

boot();
