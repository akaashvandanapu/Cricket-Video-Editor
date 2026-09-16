import { ChevronDown, ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import type { RunState } from "@/hooks/useRun"
import { fmtDuration, fmtElapsed, plural } from "@/lib/format"
import type { JobSnapshot, JobVideo, Params } from "@/lib/types"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------ visual checks

interface CheckRowProps {
  id: string
  checked: boolean
  disabled?: boolean
  label: React.ReactNode
  hint: string
  onChange: (v: boolean) => void
}

function CheckRow({ id, checked, disabled, label, hint, onChange }: CheckRowProps) {
  return (
    <div className={cn("flex gap-3", disabled && "opacity-50")}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm leading-snug"><span>{label}</span></Label>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

export function visualSummary(p: Params): string[] {
  const out: string[] = []
  if (p.useVisual) out.push("Swing check")
  if (p.checkBall) out.push("Ball check")
  if ((p.useVisual || p.checkBall) && p.includeUnverified) out.push("Keep unchecked")
  return out.length ? out : ["Sound only"]
}

export function visualStageName(p: Params): string {
  if (p.useVisual && p.checkBall) return "Swing + ball"
  if (p.checkBall) return "Check ball"
  if (p.useVisual) return "Check swing"
  return "Check video"
}

interface ChecksProps {
  params: Params
  open: boolean
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<Params>) => void
}

/** Header/body card: closed it shows the chosen checks in the header. */
export function VisualChecksCard({ params, open, disabled, onOpenChange, onChange }: ChecksProps) {
  const anyVisual = params.useVisual || params.checkBall
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="gap-0 py-0">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-3 rounded-t-xl px-4 py-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            <CardTitle className="text-sm">Visual checks</CardTitle>
            <div className="ml-auto flex flex-wrap justify-end gap-1.5">
              {visualSummary(params).map((s) => (
                <Badge key={s} variant={s === "Sound only" ? "outline" : "secondary"} className="font-normal">{s}</Badge>
              ))}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 border-t px-4 pt-4 pb-5">
            <CheckRow id="useVisual" checked={params.useVisual} disabled={disabled}
              label="Check the batsman swung"
              hint="Measures hand speed from the player's body pose around each sound. Removes loud moments where nobody played a shot — bat taps, throw-backs, the door."
              onChange={(v) => onChange({ useVisual: v })} />
            <CheckRow id="checkBall" checked={params.checkBall} disabled={disabled}
              label={<>Check a ball was bowled to the batsman <Badge variant="outline" className="ml-1 border-warn/60 text-[10px] uppercase tracking-wide text-warn">experimental</Badge></>}
              hint="Tracks a small object travelling to the batsman just before the sound, any colour. Very few false alarms, but on busy footage it sees the ball only about two times in three — so it can drop real deliveries. Adds a few seconds per delivery."
              onChange={(v) => onChange({ checkBall: v })} />
            <CheckRow id="includeUnverified" checked={params.includeUnverified} disabled={disabled || !anyVisual}
              label="Include deliveries that could not be visually checked"
              hint="When the player can't be found around a sound (too small, off-frame, occluded) the checks above have no verdict. By default those moments are left out; tick this to keep them, flagged, so you can judge them yourself."
              onChange={(v) => onChange({ includeUnverified: v })} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

// ------------------------------------------------------------ stage board

interface StageProps {
  name: string
  value: string
  time: string
  state: "idle" | "active" | "done"
}

function Stage({ name, value, time, state }: StageProps) {
  return (
    <div className={cn(
      "flex min-w-0 flex-1 flex-col gap-1 rounded-lg border bg-card px-3.5 py-3 transition-colors",
      state === "active" && "border-brand/50 bg-brand/5",
      state === "done" && "border-brand/70",
    )}>
      <span className={cn("text-[11px] font-medium uppercase tracking-wider text-muted-foreground", state === "active" && "text-brand")}>{name}</span>
      <span className={cn("truncate text-[15px] font-semibold tabular-nums", state === "done" && "text-brand")}>{value}</span>
      <span className="min-h-4 text-[11px] tabular-nums text-muted-foreground">{time}</span>
    </div>
  )
}

function stageStates(j: JobSnapshot) {
  const nVid = j.videos.length || 1
  const scanned = j.stage !== "scanning" || j.events_total > 0
  const finished = j.state !== "running"
  return {
    scanned,
    scan: (scanned && j.current >= nVid - 1 && j.stage !== "scanning") || finished ? "done" : "active",
    verify: finished && j.events_total > 0 ? "done" : j.stage === "verifying" ? "active" : "idle",
    cut: j.state === "done" ? "done" : j.stage === "verifying" || j.stage === "cutting" ? "active" : "idle",
  } as const
}

// ------------------------------------------------------------ timelines

function videoLine(v: JobVideo, i: number, j: JobSnapshot): [string, string] {
  if (v.state === "error") return ["error", "failed — " + (v.error || "unknown error")]
  const took = v.timing?.total ? ` · ${fmtElapsed(v.timing.total)}` : ""
  if (v.state === "done") return ["done", plural(v.cut_done, "clip") + (v.events_total === 0 ? " (no deliveries heard)" : "") + took]
  const started = i < j.current || (i === j.current && v.stage !== "scanning")
  if (started) return ["running", `${v.verified_done}/${v.events_total} checked · ${v.cut_done}/${v.cut_total} cut${took}`]
  return [i === j.current && j.state === "running" ? "running" : "", i === j.current ? "listening…" : "waiting"]
}

function TimelineRow({ v, i, j }: { v: JobVideo; i: number; j: JobSnapshot }) {
  const [cls, txt] = videoLine(v, i, j)
  const events = v.events || []
  const empty = events.length ? "" : v.state === "done" ? (v.events_total === 0 ? "no deliveries heard" : "none kept")
    : v.stage === "scanning" && cls === "running" ? "listening…" : ""
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-3 text-[13px]">
        <span className={cn("min-w-0 truncate font-medium", cls === "running" && "text-brand")} title={v.video}>{v.video}</span>
        <span className={cn("ml-auto shrink-0 text-muted-foreground tabular-nums", cls === "done" && "text-brand", cls === "error" && "text-warn")}>{txt}</span>
      </div>
      <div className="relative h-8 overflow-hidden rounded-md border bg-background">
        {events.map((ev, k) => (
          <div key={k} className="absolute inset-y-1 w-0.5 rounded-full bg-brand"
            style={{ left: `${(ev.time / v.video_duration) * 100}%` }}
            title={`${fmtDuration(ev.time)} (${ev.time.toFixed(2)}s)`} />
        ))}
        {empty && <span className="absolute top-1.5 left-2.5 text-xs text-muted-foreground">{empty}</span>}
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>0:00</span><span>{v.video_duration ? fmtDuration(v.video_duration) : ""}</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ tab

interface Props {
  params: Params
  run: RunState
  checksOpen: boolean
  onChecksOpenChange: (open: boolean) => void
  onChange: (patch: Partial<Params>) => void
}

export function DetectTab({ params, run, checksOpen, onChecksOpenChange, onChange }: Props) {
  const j = run.snapshot
  const p = run.runParams ?? params
  const busy = run.running || run.done
  const st = j ? stageStates(j) : null
  const dropped = j ? (j.rejected_visual || 0) + (j.rejected_ball || 0) + (j.rejected_unverified || 0) : 0
  const nVid = j?.videos.length || 1
  const progress = !j ? 0 : j.state !== "running" ? 100
    : Math.min(100, Math.round((100 * (j.verified_done + j.cut_done)) / (2 * Math.max(j.events_total, 1))))
  const merged = j ? Math.max(0, j.candidates - j.rejected_audio - j.events_total) : 0

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">
        One pass over every video on the left: listens for each bat-on-ball sound, checks the video around it, and cuts each delivery to a clip — all running in parallel. Clips appear in the next tab as they finish.
      </p>

      <VisualChecksCard params={params} open={checksOpen} disabled={run.running}
        onOpenChange={onChecksOpenChange} onChange={onChange} />

      {(busy || run.error) && (
        <div className="space-y-4">
          <div className="flex gap-2.5">
            <Stage name="Listen" state={st?.scan ?? "active"} time={j?.timing?.scan ? fmtElapsed(j.timing.scan) : ""}
              value={st?.scanned ? plural(j!.events_total, "delivery", "deliveries") : "listening…"} />
            <Stage name={visualStageName(p)} state={st?.verify ?? "idle"} time={j?.timing?.verify ? fmtElapsed(j.timing.verify) : ""}
              value={st?.scanned ? `${j!.verified_done} / ${j!.events_total}` + (dropped ? ` · ${dropped} dropped` : "") : "–"} />
            <Stage name="Cut clips" state={st?.cut ?? "idle"} time={j?.timing?.cut ? fmtElapsed(j.timing.cut) : ""}
              value={st?.scanned ? `${j!.cut_done} / ${j!.cut_total}` : "–"} />
          </div>

          {j && (
            <div className="space-y-1.5">
              <Progress value={progress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>
                  {nVid > 1 ? `video ${Math.min(j.current + 1, nVid)} of ${nVid} · ` : ""}
                  {j.stage === "scanning" ? "listening…" : `checked ${j.verified_done}/${j.events_total} · cut ${j.cut_done}/${j.cut_total}`}
                </span>
                <span>{progress}%</span>
              </div>
            </div>
          )}

          {j && j.state !== "running" && (j.state === "done" || j.clips.length > 0) && (
            <Card className="gap-2 py-4 text-[13px] leading-relaxed text-muted-foreground">
              <CardHeader className="px-4"><CardTitle className="text-xs font-medium uppercase tracking-wider">Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-1 px-4">
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  <span><b className="text-foreground">{j.candidates}</b> sharp sounds found</span>
                  <span><b className="text-foreground">{j.rejected_audio}</b> too quiet / not sharp enough</span>
                  <span><b className="text-foreground">{merged}</b> within the minimum gap of a louder one</span>
                  {p.useVisual && <span><b className="text-foreground">{j.rejected_visual}</b> rejected — nobody swung</span>}
                  {p.checkBall && <span><b className="text-foreground">{j.rejected_ball || 0}</b> rejected — no ball seen</span>}
                  <span><b className="text-foreground">{j.cut_done}</b> clips cut</span>
                </p>
                {j.rejected_unverified > 0 && (
                  <p className="text-warn">{plural(j.rejected_unverified, "delivery", "deliveries")} left out because the player could not be checked — tick "Include deliveries that could not be visually checked" above to keep them.</p>
                )}
                {j.unverified > 0 && <p className="text-warn">{j.unverified} kept without a visual check (player not clearly visible).</p>}
                {j.error && <p className="text-warn">{j.error}</p>}
              </CardContent>
            </Card>
          )}

          {j && j.videos.length > 0 && (
            <div className="space-y-4">
              {j.videos.map((v, i) => <TimelineRow key={v.video} v={v} i={i} j={j} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
