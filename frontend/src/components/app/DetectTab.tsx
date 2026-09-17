import { Check, ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
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
    <div className={cn("flex items-start justify-between gap-6 px-5 py-4", disabled && "opacity-50")}>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="flex-wrap text-[13.5px] leading-snug font-medium"><span>{label}</span></Label>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
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
      <div className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset">
            <span className="text-[13.5px] font-semibold">Visual checks</span>
            <div className="ml-auto flex flex-wrap justify-end gap-1.5">
              {visualSummary(params).map((s) => (
                <Badge key={s} variant={s === "Sound only" ? "ghost" : "secondary"}>{s}</Badge>
              ))}
            </div>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y border-t">
            <CheckRow id="useVisual" checked={params.useVisual} disabled={disabled}
              label="Check the batsman swung"
              hint="Measures hand speed from the player's body pose around each sound. Removes loud moments where nobody played a shot — bat taps, throw-backs, the door."
              onChange={(v) => onChange({ useVisual: v })} />
            <CheckRow id="checkBall" checked={params.checkBall} disabled={disabled}
              label={<>Check a ball was bowled to the batsman <Badge variant="warn" className="ml-1.5 h-[18px] px-1.5 text-[10px] tracking-wide uppercase">experimental</Badge></>}
              hint="Tracks a small object travelling to the batsman just before the sound, any colour. Very few false alarms, but on busy footage it sees the ball only about two times in three — so it can drop real deliveries. Adds a few seconds per delivery."
              onChange={(v) => onChange({ checkBall: v })} />
            <CheckRow id="includeUnverified" checked={params.includeUnverified} disabled={disabled || !anyVisual}
              label="Include deliveries that could not be visually checked"
              hint="When the player can't be found around a sound (too small, off-frame, occluded) the checks above have no verdict. By default those moments are left out; turn this on to keep them, flagged, so you can judge them yourself."
              onChange={(v) => onChange({ includeUnverified: v })} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// ------------------------------------------------------------ stage board

interface StageProps {
  n: number
  name: string
  value: string
  time: string
  state: "idle" | "active" | "done"
}

function Stage({ n, name, value, time, state }: StageProps) {
  return (
    <div className={cn(
      "relative flex min-w-0 flex-1 flex-col gap-2 rounded-xl bg-card px-4 py-3.5 shadow-card ring-1 ring-border transition-colors",
      state === "active" && "ring-brand/40",
      state === "idle" && "opacity-60",
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          "grid size-5 place-items-center rounded-full text-[10.5px] font-semibold tabular-nums",
          state === "done" ? "bg-foreground text-background" : state === "active" ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
        )}>
          {state === "done" ? <Check className="size-3" strokeWidth={3} /> : n}
        </span>
        <span className="truncate text-[12px] font-medium text-muted-foreground">{name}</span>
        {state === "active" && <span className="ml-auto size-1.5 rounded-full bg-brand animate-pulse-dot" />}
      </div>
      <span className="truncate font-mono text-[17px] font-medium tracking-tight tabular-nums">{value}</span>
      <span className="min-h-4 text-[11.5px] tabular-nums text-muted-foreground">{time}</span>
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

// ------------------------------------------------------------ breakdown

function Stat({ value, label, tone }: { value: number; label: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className={cn("font-mono text-[18px] font-medium tracking-tight tabular-nums", tone === "warn" && "text-warn")}>{value}</span>
      <span className="text-[11.5px] leading-snug text-muted-foreground">{label}</span>
    </div>
  )
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
    <div className="space-y-2 px-5 py-4">
      <div className="flex items-baseline gap-3 text-[13px]">
        <span className="grid size-5 shrink-0 place-items-center self-center rounded-md bg-muted font-mono text-[10.5px] font-medium text-muted-foreground">{i + 1}</span>
        <span className={cn("min-w-0 truncate font-medium", cls === "running" && "text-brand")} title={v.video}>{v.video}</span>
        <span className={cn("ml-auto shrink-0 text-[12px] text-muted-foreground tabular-nums", cls === "error" && "text-warn")}>{txt}</span>
      </div>
      <div className="relative h-9 overflow-hidden rounded-lg bg-muted/70 ring-1 ring-border ring-inset">
        {events.map((ev, k) => (
          <div key={k} className="absolute inset-y-2 w-[3px] -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${(ev.time / v.video_duration) * 100}%` }}
            title={`${fmtDuration(ev.time)} (${ev.time.toFixed(2)}s)`} />
        ))}
        {empty && <span className="absolute top-2 left-3 text-[12px] text-muted-foreground">{empty}</span>}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground tabular-nums">
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
  const showBreakdown = j && j.state !== "running" && (j.state === "done" || j.clips.length > 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        One pass over every source: listen for each bat-on-ball sound, check the video around it, and cut each delivery to its own clip. Videos run in parallel; clips appear in the next step as they finish.
      </p>

      <VisualChecksCard params={params} open={checksOpen} disabled={run.running}
        onOpenChange={onChecksOpenChange} onChange={onChange} />

      {(busy || run.error) && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stage n={1} name="Listen" state={st?.scan ?? "active"} time={j?.timing?.scan ? fmtElapsed(j.timing.scan) : ""}
              value={st?.scanned ? plural(j!.events_total, "delivery", "deliveries") : "listening…"} />
            <Stage n={2} name={visualStageName(p)} state={st?.verify ?? "idle"} time={j?.timing?.verify ? fmtElapsed(j.timing.verify) : ""}
              value={st?.scanned ? `${j!.verified_done} / ${j!.events_total}` + (dropped ? ` · ${dropped} dropped` : "") : "–"} />
            <Stage n={3} name="Cut clips" state={st?.cut ?? "idle"} time={j?.timing?.cut ? fmtElapsed(j.timing.cut) : ""}
              value={st?.scanned ? `${j!.cut_done} / ${j!.cut_total}` : "–"} />
          </div>

          {j && (
            <div className="space-y-2">
              <Progress value={progress} className="h-1.5" />
              <div className="flex justify-between text-[12px] text-muted-foreground tabular-nums">
                <span>
                  {nVid > 1 ? `video ${Math.min(j.current + 1, nVid)} of ${nVid} · ` : ""}
                  {j.stage === "scanning" ? "listening…" : `checked ${j.verified_done}/${j.events_total} · cut ${j.cut_done}/${j.cut_total}`}
                </span>
                <span className="font-mono">{progress}%</span>
              </div>
            </div>
          )}

          {showBreakdown && (
            <section className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border">
              <h2 className="border-b px-5 py-3 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Breakdown</h2>
              <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-border">
                <Stat value={j.candidates} label="sharp sounds found" />
                <Stat value={j.rejected_audio} label="too quiet or not sharp enough" />
                <Stat value={merged} label="inside the minimum gap of a louder one" />
                {p.useVisual && <Stat value={j.rejected_visual} label="rejected — nobody swung" />}
                {p.checkBall && <Stat value={j.rejected_ball || 0} label="rejected — no ball seen" />}
                <Stat value={j.cut_done} label="clips cut" />
              </div>
              {(j.rejected_unverified > 0 || j.unverified > 0 || j.error) && (
                <div className="space-y-1 border-t px-5 py-3 text-[12.5px] leading-relaxed text-warn">
                  {j.rejected_unverified > 0 && (
                    <p>{plural(j.rejected_unverified, "delivery", "deliveries")} left out because the player could not be checked — turn on "Include deliveries that could not be visually checked" above to keep them.</p>
                  )}
                  {j.unverified > 0 && <p>{j.unverified} kept without a visual check (player not clearly visible).</p>}
                  {j.error && <p>{j.error}</p>}
                </div>
              )}
            </section>
          )}

          {j && j.videos.length > 0 && (
            <section className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border">
              <h2 className="border-b px-5 py-3 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Timeline</h2>
              <div className="divide-y">
                {j.videos.map((v, i) => <TimelineRow key={v.video} v={v} i={i} j={j} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
