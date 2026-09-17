import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { api } from "@/lib/api"
import { fmtDuration, plural } from "@/lib/format"
import type { Clip } from "@/lib/types"
import { cn } from "@/lib/utils"
import { fitCardWidth, fitVideoMaxHeight, VIDEO_CONTROLS } from "@/lib/video"

/** What a ClipCard must leave room for inside the visible height, in rem: the
 * page's toolbar row above the cards plus the card's own title row, chips and
 * padding; one more line when the source name shows. */
const CLIP_CARD_CHROME_REM = 8.25
const CLIP_CARD_SOURCE_LINE_REM = 1.2

interface CardProps {
  clip: Clip
  n: number
  ratio: number | null
  selected: boolean
  playing: boolean
  showVideo: boolean
  showBall: boolean
  onSelect: (filename: string, selected: boolean) => void
  onPlay: (clip: Clip) => void
}

/** Memoised so the poll-driven re-renders of the grid never touch a card
 * whose props did not change (its <video> keeps its buffer and position). */
const ClipCard = memo(function ClipCard({ clip, n, ratio, selected, playing, showVideo, showBall, onSelect, onPlay }: CardProps) {
  const chrome = CLIP_CARD_CHROME_REM + (showVideo ? CLIP_CARD_SOURCE_LINE_REM : 0)
  return (
    <div
      style={{ width: fitCardWidth(ratio, chrome) }}
      className={cn(
        "group/clip relative flex flex-col overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border transition-[box-shadow,opacity,transform]",
        "hover:ring-foreground/25",
        !selected && "opacity-50 hover:opacity-80",
        playing && "ring-2 ring-brand hover:ring-brand",
      )}
      onClick={(e) => { if ((e.target as HTMLElement).closest("button,input,[role=checkbox],label")) return; onPlay(clip) }}
    >
      <div className="relative">
        {/* the card is sized from the source's aspect ratio so the whole clip fits the
            visible height (see fitCardWidth); the max-height only bites for extreme ratios */}
        <video {...VIDEO_CONTROLS} preload="metadata" src={api(clip.url)}
          style={{ aspectRatio: ratio ?? undefined, maxHeight: fitVideoMaxHeight(chrome) }}
          className="block h-auto w-full object-contain"
          onPlay={() => onPlay(clip)} onSeeked={(e) => { if (!e.currentTarget.paused) onPlay(clip) }} />
        <label
          className="absolute top-2 left-2 flex cursor-pointer items-center gap-2 rounded-lg bg-background/90 py-1 pr-2.5 pl-2 text-[11.5px] font-medium shadow-[0_1px_3px_rgba(0,0,0,.2)] ring-1 ring-border backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox checked={selected} onCheckedChange={(v) => onSelect(clip.filename, v === true)} aria-label="Keep this clip" className="size-3.5" />
          {selected ? "Keep" : "Skipped"}
        </label>
        <span className="absolute top-2 right-2 rounded-md bg-background/90 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-muted-foreground shadow-[0_1px_3px_rgba(0,0,0,.2)] ring-1 ring-border backdrop-blur tabular-nums">
          #{n}
        </span>
      </div>
      <div className="min-w-0 space-y-2 px-3 pt-2.5 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold tracking-[-0.005em]">Delivery at {fmtDuration(clip.event_time)}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{(clip.end - clip.start).toFixed(1)}s</span>
        </div>
        {showVideo && <div className="truncate text-[11.5px] text-muted-foreground" title={clip.video}>{clip.video}</div>}
        <div className="flex flex-wrap gap-1">
          <Badge className="font-mono font-normal tabular-nums" title="how far the sound stands above this video's noise floor">sound {clip.audio_snr}</Badge>
          {clip.hand_speed > 0 && <Badge className="font-mono font-normal tabular-nums" title="peak hand speed, torso-lengths per second">hands {clip.hand_speed.toFixed(1)}</Badge>}
          {clip.verified === false && <Badge variant="warn">not visually checked</Badge>}
          {showBall && (clip.ball === true
            ? <Badge variant="success" className="font-mono font-normal tabular-nums" title="frames the ball was tracked for on its way to the batsman">ball ✓ {clip.ball_track}</Badge>
            : clip.ball === false
              ? <Badge variant="warn">ball ✗</Badge>
              : <Badge variant="warn">ball ?</Badge>)}
        </div>
      </div>
    </div>
  )
})

interface Props {
  clips: Clip[]
  ratios: Record<string, number | null>
  selected: Set<string>
  playing: string | null
  multiVideo: boolean
  showBall: boolean
  onSelect: (filename: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onPlay: (clip: Clip) => void
}

export function ReviewTab({ clips, ratios, selected, playing, multiVideo, showBall, onSelect, onSelectAll, onPlay }: Props) {
  if (!clips.length) {
    return (
      <p className="text-sm text-muted-foreground">Run detection first — clips will appear here as they are cut.</p>
    )
  }
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{selected.size}</span> of {plural(clips.length, "clip")} kept · playing a clip jumps its source on the left
        </p>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          <Button variant="ghost" size="sm" className="h-7 px-3 hover:bg-card hover:shadow-[0_1px_2px_rgba(0,0,0,.06)]" onClick={() => onSelectAll(true)}>Keep all</Button>
          <Button variant="ghost" size="sm" className="h-7 px-3 hover:bg-card hover:shadow-[0_1px_2px_rgba(0,0,0,.06)]" onClick={() => onSelectAll(false)}>Skip all</Button>
        </div>
      </header>
      {/* cards size themselves per clip (portrait narrower, landscape wider), so wrap rather than grid */}
      <div className="flex flex-wrap items-start gap-4">
        {clips.map((c, i) => (
          <ClipCard key={c.filename} clip={c} n={i + 1} ratio={ratios[c.video] ?? null} selected={selected.has(c.filename)} playing={playing === c.filename}
            showVideo={multiVideo} showBall={showBall} onSelect={onSelect} onPlay={onPlay} />
        ))}
      </div>
    </div>
  )
}
