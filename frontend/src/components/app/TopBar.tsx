import { Moon, Sun, Upload } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import batsman from "@/assets/batsman.png"
import { plural } from "@/lib/format"

interface Props {
  videoCount: number
  uploading: { count: number; percent: number } | null
  disabled: boolean
  onPick: () => void
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  )
}

/** Wordmark: the watercolour batsman illustration, cut out to a transparent
 * PNG (src/assets/batsman.png) so it sits directly on the header in both themes. */
function Mark() {
  return (
    <img src={batsman} alt="" aria-hidden width={36} height={36}
      className="size-9 shrink-0 select-none object-contain" draggable={false} />
  )
}

export function TopBar({ videoCount, uploading, disabled, onPick }: Props) {
  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/80 px-3 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Mark />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">Cricket Highlight Cutter</span>
          <span className="hidden truncate text-[11.5px] text-muted-foreground sm:block">Every delivery, cut to a clip</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden text-[13px] text-muted-foreground tabular-nums sm:inline" aria-live="polite">
          {uploading ? `Uploading ${plural(uploading.count, "file")} · ${uploading.percent}%` : videoCount ? `${plural(videoCount, "video")} in batch` : ""}
        </span>
        <ThemeToggle />
        <Button onClick={onPick} disabled={disabled || !!uploading} className="ml-1">
          <Upload className="size-4" />
          <span className="hidden sm:inline">Upload videos</span>
          <span className="sm:hidden">Upload</span>
        </Button>
      </div>
      {uploading && (
        <Progress value={uploading.percent} className="absolute inset-x-0 -bottom-px h-0.5 rounded-none bg-transparent" />
      )}
    </header>
  )
}
