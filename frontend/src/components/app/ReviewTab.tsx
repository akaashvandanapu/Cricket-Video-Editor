import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { api } from "@/lib/api"
import type { Clip } from "@/lib/types"
import { cn } from "@/lib/utils"

interface CardProps {
  clip: Clip
  selected: boolean
  playing: boolean
  showVideo: boolean
  showBall: boolean
  onSelect: (filename: string, selected: boolean) => void
  onPlay: (clip: Clip) => void
}

/** Memoised so the poll-driven re-renders of the grid never touch a card
 * whose props did not change (its <video> keeps its buffer and position). */
const ClipCard = memo(function ClipCard({ clip, selected, playing, showVideo, showBall, onSelect, onPlay }: CardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-2 transition-[border-color,opacity] hover:border-foreground/20",
        !selected && "opacity-45",
        playing && "border-brand shadow-[0_0_0_1px_var(--brand)]",
      )}
      onClick={(e) => { if ((e.target as HTMLElement).closest("button,input,[role=checkbox]")) return; onPlay(clip) }}
    >
      <video controls preload="metadata" src={api(clip.url)} className="w-full rounded-md"
        onPlay={() => onPlay(clip)} onSeeked={(e) => { if (!e.currentTarget.paused) onPlay(clip) }} />
      <div className="min-w-0 px-0.5">
        <div className="text-[13px] font-medium">Delivery at {clip.event_time}s</div>
        {showVideo && <div className="truncate text-[11px] text-muted-foreground" title={clip.video}>{clip.video}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge variant="outline" className="font-normal tabular-nums" title="how far the sound stands above this video's noise floor">sound {clip.audio_snr}</Badge>
          {clip.hand_speed > 0 && <Badge variant="outline" className="font-normal tabular-nums" title="peak hand speed, torso-lengths per second">hands {clip.hand_speed.toFixed(1)}</Badge>}
          {clip.verified === false && <Badge variant="outline" className="border-warn/60 font-normal text-warn">not visually checked</Badge>}
          {showBall && (clip.ball === true
            ? <Badge variant="outline" className="border-brand/60 font-normal text-brand tabular-nums" title="frames the ball was tracked for on its way to the batsman">ball ✓ {clip.ball_track}</Badge>
            : clip.ball === false
              ? <Badge variant="outline" className="border-warn/60 font-normal text-warn">ball ✗</Badge>
              : <Badge variant="outline" className="border-warn/60 font-normal text-warn">ball ?</Badge>)}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 px-0.5 pb-0.5 text-xs">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(clip.filename, v === true)} aria-label="Keep this clip" />
        Keep this clip
      </label>
    </div>
  )
})

interface Props {
  clips: Clip[]
  selected: Set<string>
  playing: string | null
  multiVideo: boolean
  showBall: boolean
  onSelect: (filename: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onPlay: (clip: Clip) => void
}

export function ReviewTab({ clips, selected, playing, multiVideo, showBall, onSelect, onSelectAll, onPlay }: Props) {
  if (!clips.length) {
    return <p className="text-sm text-muted-foreground">Run detection first — clips will appear here as they are cut.</p>
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onSelectAll(true)}>Select all</Button>
        <Button variant="outline" size="sm" onClick={() => onSelectAll(false)}>Select none</Button>
        <span className="ml-1 text-sm text-muted-foreground tabular-nums" aria-live="polite">{selected.size} / {clips.length} selected</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
        {clips.map((c) => (
          <ClipCard key={c.filename} clip={c} selected={selected.has(c.filename)} playing={playing === c.filename}
            showVideo={multiVideo} showBall={showBall} onSelect={onSelect} onPlay={onPlay} />
        ))}
      </div>
    </div>
  )
}
