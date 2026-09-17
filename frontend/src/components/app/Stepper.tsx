import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export type Tab = "params" | "detect" | "review"

export interface Step {
  id: Tab
  title: string
  hint: string
  enabled: boolean
  done: boolean
}

interface Props {
  steps: Step[]
  current: Tab
  onSelect: (tab: Tab) => void
}

/** Three numbered steps across the top of the workflow pane. A done step
 * shows a check, the current one is filled, a step whose prerequisites are
 * missing is dimmed and not clickable. */
export function Stepper({ steps, current, onSelect }: Props) {
  return (
    <nav aria-label="Workflow" className="flex items-stretch gap-1 overflow-x-auto px-3 sm:px-6">
      {steps.map((s, i) => {
        const active = s.id === current
        return (
          <button
            key={s.id}
            type="button"
            disabled={!s.enabled}
            aria-current={active ? "step" : undefined}
            onClick={() => onSelect(s.id)}
            className={cn(
              "group relative flex min-w-0 shrink-0 items-center gap-3 px-2 py-2.5 text-left transition-colors outline-none sm:pr-6",
              "disabled:cursor-not-allowed disabled:opacity-40",
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity",
              active && "after:opacity-100",
              !active && s.enabled && "hover:after:opacity-20",
              "focus-visible:after:opacity-60",
            )}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors",
                active ? "border-foreground bg-foreground text-background"
                  : s.done ? "border-foreground/70 bg-transparent text-foreground"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              {s.done && !active ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className={cn("truncate text-[13px] font-medium", active ? "text-foreground" : "text-foreground/75 group-hover:text-foreground")}>{s.title}</span>
              <span className="hidden truncate text-[11px] text-muted-foreground md:block">{s.hint}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
