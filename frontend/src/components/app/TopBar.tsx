import { Moon, Sun, Upload } from "lucide-react"
import { useTheme } from "next-themes"
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { plural } from "@/lib/format"

interface Props {
  videoCount: number
  uploading: { count: number; percent: number } | null
  disabled: boolean
  onFiles: (files: FileList | File[]) => void
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== "light"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
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

export function TopBar({ videoCount, uploading, disabled, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card/60 px-3 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-brand-foreground" aria-hidden>
          <svg viewBox="0 0 32 32" className="size-4">
            <path d="M9 23 L23 9" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          </svg>
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight">Cricket Highlight Cutter</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline" aria-live="polite">
          {uploading ? `Uploading ${plural(uploading.count, "file")}…` : videoCount ? plural(videoCount, "video") : ""}
        </span>
        <ThemeToggle />
        <input
          ref={input}
          type="file"
          accept="video/*,.mp4,.mov,.m4v,.mkv,.avi"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files)
            e.target.value = ""
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={disabled || !!uploading}>
          <Upload className="size-4" />
          <span className="hidden sm:inline">Upload videos</span>
          <span className="sm:hidden">Upload</span>
        </Button>
      </div>
      {uploading && (
        <Progress value={uploading.percent} className="absolute inset-x-0 -bottom-px h-0.5 rounded-none" />
      )}
    </header>
  )
}
