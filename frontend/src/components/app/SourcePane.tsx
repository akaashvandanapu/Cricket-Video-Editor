import { Film, Upload, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, getJson } from "@/lib/api"
import { useFitHeight } from "@/hooks/useFitHeight"
import { fmtDuration, plural } from "@/lib/format"
import type { PreviewSource, ProxyJob, VideoMeta } from "@/lib/types"
import { fitVideoMaxHeight, VIDEO_CONTROLS } from "@/lib/video"
import { cn } from "@/lib/utils"

export interface SeekRequest {
  video: string
  time: number
  nonce: number // a new object per request, so the same time can be re-sought
}

interface CardProps {
  name: string
  index: number
  active: boolean
  removable: boolean
  seek: SeekRequest | null
  onRemove: () => void
  onMeta: (name: string, meta: VideoMeta) => void
}

/** Title row + meta row of a SourceCard, in rem — what the video must leave room for. */
const SOURCE_CARD_CHROME_REM = 4.75

/** One source video: loads the browser-friendly url, swaps in the 480p
 * preview copy when it is ready, and follows seek requests from clips.
 * All of it lives here so unmounting (removing the video from the batch)
 * cancels any polling or swap still in flight. */
function SourceCard({ name, index, active, removable, seek, onRemove, onMeta }: CardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [meta, setMeta] = useState<PreviewSource["meta"] | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [note, setNote] = useState("")

  useEffect(() => {
    let alive = true
    let poll: ReturnType<typeof setInterval> | null = null
    const swapTo = (url: string) => {
      if (!alive) return
      const v = videoRef.current
      const at = v?.currentTime ?? 0
      setSrc(api(url))
      setNote("")
      v?.addEventListener("loadeddata", () => { try { if (v) v.currentTime = at } catch { /* ignore */ } }, { once: true })
    }
    let proxyRequested = false
    const buildProxy = async () => {
      if (proxyRequested) return
      proxyRequested = true
      try {
        const res = await getJson<{ job_id: string | null; url: string | null }>(
          `/api/proxy?video=${encodeURIComponent(name)}`, { method: "POST" })
        if (!alive) return
        if (res.url) { swapTo(res.url); return }
        if (!res.job_id) return
        poll = setInterval(async () => {
          let job: ProxyJob
          try { job = await getJson<ProxyJob>(`/api/jobs/${res.job_id}`) } catch { return }
          if (!alive) return
          if (job.state === "done" && job.result) { if (poll) clearInterval(poll); swapTo(job.result.url) }
          else if (job.state === "error") { if (poll) clearInterval(poll); setNote("Preview copy failed — playing the original.") }
        }, 1500)
      } catch { /* the preview copy is an optimisation only */ }
    }
    ;(async () => {
      try {
        const info = await getJson<PreviewSource>(`/api/preview-source?video=${encodeURIComponent(name)}`)
        if (!alive) return
        setMeta(info.meta)
        onMeta(name, info.meta)
        setSrc(api(info.url))
        if (info.needs_proxy && !info.proxy_ready) {
          setNote("Building a light preview copy…")
          void buildProxy()
        }
        videoRef.current?.addEventListener("error", () => {
          if (!alive) return
          setNote("This browser can't play the original — a preview copy is being built.")
          void buildProxy()
        })
      } catch (err) {
        if (alive) setNote("Could not read this video: " + (err as Error).message)
      }
    })()
    return () => {
      alive = false
      if (poll) clearInterval(poll)
    }
  }, [name])

  useEffect(() => {
    if (!seek || seek.video !== name) return
    const v = videoRef.current
    if (!v || !src) return
    const go = () => { try { v.currentTime = Math.max(0, seek.time) } catch { /* not seekable yet */ } }
    if (v.readyState >= 1) go()
    else v.addEventListener("loadedmetadata", go, { once: true })
  }, [seek, name, src])

  return (
    <div
      className={cn(
        "group/source flex shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border transition-[box-shadow,ring-color] lg:w-full",
        "w-[min(72vw,300px)] lg:w-auto",
        active && "ring-2 ring-brand",
      )}
    >
      <div className="flex items-center gap-2 py-2 pr-1.5 pl-3">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted font-mono text-[10.5px] font-medium text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={name}>{name}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label="Remove from batch" disabled={!removable} onClick={onRemove}>
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from this batch (the file stays on disk)</TooltipContent>
        </Tooltip>
      </div>
      {/* capped so the whole card fits the pane's visible height; a portrait
          video letterboxes onto the dark surface instead of forcing a scroll */}
      <video ref={videoRef} {...VIDEO_CONTROLS} preload="auto" src={src ?? undefined}
        style={{ "--fit-max": fitVideoMaxHeight(SOURCE_CARD_CHROME_REM) } as React.CSSProperties}
        className="block h-auto w-full object-contain max-lg:max-h-[34vh] lg:max-h-(--fit-max)" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-[11.5px] text-muted-foreground">
        {meta && (
          <span className="font-mono tabular-nums">
            {meta.width}×{meta.height} <span className="mx-1 opacity-40">·</span> {(meta.fps || 0).toFixed(0)} fps <span className="mx-1 opacity-40">·</span> {fmtDuration(meta.duration)}
          </span>
        )}
        {note && <span className="text-warn">{note}</span>}
      </div>
    </div>
  )
}

interface PaneProps {
  videos: string[]
  activeVideo: string | null
  seek: SeekRequest | null
  running: boolean
  syncNote: string
  onRemove: (name: string) => void
  onMeta: (name: string, meta: VideoMeta) => void
  onPick: () => void
}

export function SourcePane({ videos, activeVideo, seek, running, syncNote, onRemove, onMeta, onPick }: PaneProps) {
  const fit = useFitHeight<HTMLDivElement>()
  return (
    <aside className="flex min-h-0 flex-col border-b bg-surface lg:border-r lg:border-b-0">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 px-4 lg:px-5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Sources</span>
        {videos.length > 0 && <Badge variant="secondary" className="tabular-nums">{plural(videos.length, "video")}</Badge>}
      </div>

      {videos.length === 0 ? (
        <button
          type="button"
          onClick={onPick}
          disabled={running}
          className="group m-4 mt-0 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-input p-8 text-center transition-colors hover:border-foreground/40 hover:bg-card focus-visible:border-foreground/40 focus-visible:outline-none lg:m-5 lg:mt-0"
        >
          <span className="grid size-11 place-items-center rounded-full bg-card text-muted-foreground shadow-card ring-1 ring-border transition-colors group-hover:text-foreground">
            <Upload className="size-4.5" />
          </span>
          <p className="mt-4 text-sm font-medium">Add your videos</p>
          <p className="mt-1.5 max-w-[28ch] text-[12.5px] leading-relaxed text-muted-foreground">
            Click to choose files, or drop them anywhere on the page. Several at once is fine — they run as one batch.
          </p>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <Film className="size-3" /> MP4 · MOV · MKV · AVI
          </p>
        </button>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={fit} className="flex gap-3 overflow-x-auto px-3 pt-2 pb-3 lg:min-h-0 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:px-5 lg:pt-2 lg:pb-5">
            {videos.map((name, i) => (
              <SourceCard key={name} name={name} index={i} active={activeVideo === name} removable={!running}
                seek={seek} onRemove={() => onRemove(name)} onMeta={onMeta} />
            ))}
          </div>
          <div className={cn("flex min-h-8 shrink-0 items-center gap-2 border-t px-4 text-[11.5px] lg:px-5", syncNote ? "text-brand" : "text-muted-foreground")} aria-live="polite">
            {syncNote && <span className="size-1.5 shrink-0 rounded-full bg-brand animate-pulse-dot" />}
            <span className="truncate">{syncNote || "Playing a clip jumps its source here."}</span>
          </div>
        </div>
      )}
    </aside>
  )
}
