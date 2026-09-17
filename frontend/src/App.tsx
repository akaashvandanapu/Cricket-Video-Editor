import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { toast } from "sonner"

import { DetectTab } from "@/components/app/DetectTab"
import { ParamsTab } from "@/components/app/ParamsTab"
import { ReviewTab } from "@/components/app/ReviewTab"
import { SourcePane, type SeekRequest } from "@/components/app/SourcePane"
import { TopBar } from "@/components/app/TopBar"
import { Stepper, type Step, type Tab } from "@/components/app/Stepper"
import { WorkFooter, type ExportState } from "@/components/app/WorkFooter"
import { useRun } from "@/hooks/useRun"
import { api, postJson } from "@/lib/api"
import { fmtElapsed, plural, VIDEO_FILE_RE } from "@/lib/format"
import { useFitHeight } from "@/hooks/useFitHeight"
import { DEFAULT_PARAMS, type Clip, type ExportResult, type Params, type VideoMeta } from "@/lib/types"
import { aspectRatio } from "@/lib/video"
import { cn } from "@/lib/utils"

const IDLE_EXPORT: ExportState = { mode: "separate", busy: false, status: "", error: null, result: null }

export default function App() {
  const [videos, setVideos] = useState<string[]>([])
  const [metas, setMetas] = useState<Record<string, VideoMeta>>({})
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [tab, setTab] = useState<Tab>("params")
  const [checksOpen, setChecksOpen] = useState(true)
  const [uploading, setUploading] = useState<{ count: number; percent: number } | null>(null)
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [seek, setSeek] = useState<SeekRequest | null>(null)
  const [playing, setPlaying] = useState<Clip | null>(null)
  const [exportState, setExportState] = useState<ExportState>(IDLE_EXPORT)
  const { run, start, clear } = useRun()
  const picker = useRef<HTMLInputElement>(null)
  const workArea = useFitHeight<HTMLDivElement>()
  const onMeta = useCallback((name: string, meta: VideoMeta) => setMetas((m) => ({ ...m, [name]: meta })), [])
  const pickFiles = () => picker.current?.click()

  // ---- derived
  const clips = useMemo<Clip[]>(() => {
    const order = new Map(videos.map((v, i) => [v, i]))
    return [...(run.snapshot?.clips ?? [])].sort(
      (a, b) => (order.get(a.video) ?? 0) - (order.get(b.video) ?? 0) || a.event_time - b.event_time)
  }, [run.snapshot?.clips, videos])
  const ratios = useMemo(() => Object.fromEntries(videos.map((v) => [v, aspectRatio(metas[v])])), [videos, metas])
  const selected = useMemo(() => new Set(clips.filter((c) => !deselected.has(c.filename)).map((c) => c.filename)), [clips, deselected])
  const canDetect = videos.length > 0
  const canReview = run.done && clips.length > 0
  const canExport = run.done && selected.size > 0 && !!run.snapshot?.session

  // ---- invalidation: any change to the batch or a parameter discards the run
  const firstRender = useRef(true)
  const invalidate = useCallback(() => {
    clear()
    setDeselected(new Set())
    setSeek(null)
    setPlaying(null)
    setExportState((e) => ({ ...IDLE_EXPORT, mode: e.mode }))
    setChecksOpen(true)
  }, [clear])
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    invalidate()
  }, [params, videos, invalidate])

  // dev-only: lets a test add files already in videos/ without an upload
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __cveAddVideos?: (names: string[]) => void }).__cveAddVideos =
      (names) => setVideos((v) => [...v, ...names.filter((n) => !v.includes(n))])
  }, [])

  // a tab whose prerequisites vanished falls back, derived rather than stored
  const shownTab: Tab = tab === "review" && clips.length === 0 ? (canDetect ? "detect" : "params")
    : tab === "detect" && !canDetect ? "params" : tab

  // ---- upload
  const uploadFiles = useCallback((files: FileList | File[]) => {
    if (run.running) return
    const list = [...files].filter((f) => f.type.startsWith("video/") || VIDEO_FILE_RE.test(f.name))
    if (!list.length) { toast.error("No video files in that selection"); return }
    const form = new FormData()
    for (const f of list) form.append("files", f)
    const xhr = new XMLHttpRequest()
    xhr.open("POST", api("/api/upload"))
    setUploading({ count: list.length, percent: 0 })
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) setUploading({ count: list.length, percent: Math.round((e.loaded / e.total) * 100) })
    })
    xhr.onload = () => {
      setUploading(null)
      if (xhr.status === 200) {
        const names = (JSON.parse(xhr.responseText) as { names: string[] }).names
        setVideos((v) => [...v, ...names.filter((n) => !v.includes(n))])
        setTab("params")
        toast.success(plural(names.length, "video") + " added to the batch")
      } else {
        let detail = xhr.responseText
        try { detail = JSON.parse(xhr.responseText).detail || detail } catch { /* plain text */ }
        toast.error("Upload failed", { description: detail })
      }
    }
    xhr.onerror = () => {
      setUploading(null)
      toast.error("Upload failed", { description: `Is the backend running on ${api("")}?` })
    }
    xhr.send(form)
  }, [run.running])

  // drag & drop anywhere on the page
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => { if (!e.dataTransfer?.types.includes("Files")) return; e.preventDefault(); depth++; setDragging(true) }
    const over = (e: DragEvent) => e.preventDefault()
    const leave = (e: DragEvent) => { e.preventDefault(); if (--depth <= 0) { depth = 0; setDragging(false) } }
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragging(false); if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files) }
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", over)
    window.addEventListener("dragleave", leave); window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", over)
      window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop)
    }
  }, [uploadFiles])

  // ---- run
  const onRun = () => {
    if (!videos.length || run.running) return
    setDeselected(new Set())
    setExportState((e) => ({ ...IDLE_EXPORT, mode: e.mode }))
    setChecksOpen(false)
    void start(params, videos)
  }
  const j = run.snapshot
  const runStatus = (() => {
    if (!run.running && !run.done && !j) return ""
    const t = j?.timing
    if (run.running) return (j ? (j.stage === "scanning" ? "Listening…" : "Checking and cutting…") : "Starting…") + (t?.total ? ` ${fmtElapsed(t.total)}` : "")
    if (j?.state === "error" && !j.clips.length) return "Error: " + j.error
    if (j) return `Done — ${plural(j.cut_done, "clip")} ready` + (j.videos.length > 1 ? ` from ${j.videos.length} videos` : "") + (t?.total ? ` in ${fmtElapsed(t.total)}` : "")
    return ""
  })()

  // ---- review
  const onSelect = useCallback((filename: string, sel: boolean) => {
    setDeselected((d) => { const n = new Set(d); if (sel) n.delete(filename); else n.add(filename); return n })
    setExportState((e) => ({ ...IDLE_EXPORT, mode: e.mode }))
  }, [])
  const onSelectAll = (sel: boolean) => {
    setDeselected(sel ? new Set() : new Set(clips.map((c) => c.filename)))
    setExportState((e) => ({ ...IDLE_EXPORT, mode: e.mode }))
  }
  const onPlay = useCallback((clip: Clip) => {
    setPlaying(clip)
    setSeek({ video: clip.video, time: clip.start, nonce: Date.now() })
  }, [])

  // ---- export
  const onExport = async () => {
    if (!canExport || !j) return
    const filenames = clips.filter((c) => selected.has(c.filename)).map((c) => c.filename) // batch order
    setExportState((e) => ({ ...e, busy: true, error: null, result: null, status: e.mode === "concat" ? "Combining…" : "Zipping…" }))
    try {
      const result = await postJson<ExportResult>("/api/export", { session: j.session, filenames, mode: exportState.mode })
      setExportState((e) => ({ ...e, busy: false, result, status: `Ready (${plural(filenames.length, "clip")})` }))
    } catch (err) {
      setExportState((e) => ({ ...e, busy: false, status: "", error: (err as Error).message }))
    }
  }

  const steps: Step[] = [
    { id: "params", title: "Parameters", hint: "Clip length & sensitivity", enabled: true, done: canDetect },
    { id: "detect", title: "Detect deliveries", hint: "Listen, check, cut", enabled: canDetect, done: canReview },
    { id: "review", title: "Review & export", hint: "Keep the good ones", enabled: clips.length > 0, done: !!exportState.result },
  ]

  const syncNote = playing ? `${playing.video} at ${playing.start.toFixed(2)}s (clip ${playing.start.toFixed(2)}–${playing.end.toFixed(2)}s)` : ""

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <input ref={picker} type="file" accept="video/*,.mp4,.mov,.m4v,.mkv,.avi" multiple className="hidden"
        onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = "" }} />
      <TopBar videoCount={videos.length} uploading={uploading} disabled={run.running} onPick={pickFiles} />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[clamp(320px,30%,560px)_1fr] lg:grid-rows-[100%] lg:overflow-hidden">
        <SourcePane videos={videos} activeVideo={playing?.video ?? null} seek={seek} running={run.running} syncNote={syncNote}
          onRemove={(name) => { if (run.running) return; setVideos((v) => v.filter((n) => n !== name)) }} onMeta={onMeta} onPick={pickFiles} />

        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="shrink-0 border-b bg-background">
            <Stepper steps={steps} current={shownTab} onSelect={setTab} />
          </div>

          <div ref={workArea} className="flex-1 px-3 py-5 sm:px-6 sm:py-6 lg:min-h-0 lg:overflow-x-hidden lg:overflow-y-auto">
            {shownTab === "params" && <ParamsTab params={params} disabled={run.running} onChange={(p) => setParams((c) => ({ ...c, ...p }))} />}
            {shownTab === "detect" && (
              <DetectTab params={params} run={run} checksOpen={checksOpen} onChecksOpenChange={setChecksOpen}
                onChange={(p) => setParams((c) => ({ ...c, ...p }))} />
            )}
            {shownTab === "review" && (
              <ReviewTab clips={clips} ratios={ratios} selected={selected} playing={playing?.filename ?? null} multiVideo={videos.length > 1}
                showBall={!!run.runParams?.checkBall} onSelect={onSelect} onSelectAll={onSelectAll} onPlay={onPlay} />
            )}
          </div>

          <WorkFooter tab={shownTab} canDetect={canDetect} canReview={canReview} running={run.running} runStatus={runStatus}
            runError={run.error} canExport={canExport} exportState={exportState} onTab={setTab} onRun={onRun}
            onExportMode={(mode) => setExportState({ ...IDLE_EXPORT, mode })} onExport={onExport} />
        </section>
      </main>

      <div className={cn(
        "pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-md transition-opacity duration-200",
        dragging ? "opacity-100" : "opacity-0",
      )}>
        <div className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-foreground/40 bg-card/80 px-14 py-12 text-center shadow-pop transition-transform duration-200",
          dragging ? "scale-100" : "scale-95",
        )}>
          <span className="grid size-12 place-items-center rounded-full bg-foreground text-background"><Upload className="size-5" /></span>
          <p className="text-lg font-semibold tracking-[-0.01em]">Drop to add to the batch</p>
          <p className="text-sm text-muted-foreground">MP4, MOV, MKV or AVI — several at once is fine.</p>
        </div>
      </div>
    </div>
  )
}
