import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, getJson } from "@/lib/api"
import { fmtDuration } from "@/lib/format"
import type { PreviewSource, ProxyJob } from "@/lib/types"
import { cn } from "@/lib/utils"

export interface SeekRequest {
  video: string
  time: number
  nonce: number // a new object per request, so the same time can be re-sought
}

interface CardProps {
  name: string
  active: boolean
  removable: boolean
  seek: SeekRequest | null
  onRemove: () => void
}

/** One source video: loads the browser-friendly url, swaps in the 480p
 * preview copy when it is ready, and follows seek requests from clips.
 * All of it lives here so unmounting (removing the video from the batch)
 * cancels any polling or swap still in flight. */
function SourceCard({ name, active, removable, seek, onRemove }: CardProps) {
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
        "flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2.5 transition-colors lg:w-full",
        "w-[min(72vw,280px)] lg:w-auto",
        active && "border-brand shadow-[0_0_0_1px_var(--brand)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium" title={name}>{name}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Remove from batch" disabled={!removable} onClick={onRemove}>
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from this batch (the file stays on disk)</TooltipContent>
        </Tooltip>
      </div>
      <video ref={videoRef} controls preload="auto" src={src ?? undefined}
        className="block h-auto w-full rounded-md max-lg:max-h-[34vh] max-lg:object-contain" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
        {meta && <span>{meta.width}×{meta.height} · {(meta.fps || 0).toFixed(0)} fps · {fmtDuration(meta.duration)}</span>}
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
}

export function SourcePane({ videos, activeVideo, seek, running, syncNote, onRemove }: PaneProps) {
  return (
    <aside className="flex min-h-0 flex-col border-b bg-card/30 lg:border-r lg:border-b-0">
      {videos.length === 0 ? (
        <div className="m-4 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center lg:m-5">
          <p className="text-sm font-medium">No videos yet</p>
          <p className="mt-1.5 max-w-[26ch] text-xs leading-relaxed text-muted-foreground">
            Upload from the top right, or drop files anywhere on this page. Several at once is fine — they are processed together.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:justify-center">
          <div className="flex gap-3 overflow-x-auto p-3 lg:min-h-0 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:p-4">
            {videos.map((name) => (
              <SourceCard key={name} name={name} active={activeVideo === name} removable={!running}
                seek={seek} onRemove={() => onRemove(name)} />
            ))}
          </div>
          <div className="min-h-5 shrink-0 truncate px-4 pb-2 text-xs text-brand" aria-live="polite">{syncNote}</div>
        </div>
      )}
    </aside>
  )
}
