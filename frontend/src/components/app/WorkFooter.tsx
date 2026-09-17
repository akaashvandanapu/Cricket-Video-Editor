import { ArrowLeft, ArrowRight, Download, Loader2, Play } from "lucide-react"

import type { Tab } from "@/components/app/Stepper"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import type { ExportMode, ExportResult } from "@/lib/types"
import { cn } from "@/lib/utils"

export type { Tab }

export interface ExportState {
  mode: ExportMode
  busy: boolean
  status: string
  error: string | null
  result: ExportResult | null
}

interface Props {
  tab: Tab
  canDetect: boolean
  canReview: boolean
  running: boolean
  runStatus: string
  runError: string | null
  canExport: boolean
  exportState: ExportState
  onTab: (tab: Tab) => void
  onRun: () => void
  onExportMode: (mode: ExportMode) => void
  onExport: () => void
}

function Status({ error, text }: { error: string | null; text: string }) {
  return (
    <span className={cn("min-w-0 truncate text-[13px]", error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
      {error ? `Error: ${error}` : text}
    </span>
  )
}

export function WorkFooter(p: Props) {
  return (
    <footer className="sticky bottom-0 z-10 flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 border-t bg-background/85 px-3 py-2 backdrop-blur-md sm:px-6 lg:static">
      {p.tab === "params" && (
        <>
          <Status error={null} text={p.canDetect ? "" : "Add at least one video to continue."} />
          <Button className="ml-auto" disabled={!p.canDetect} onClick={() => p.onTab("detect")}>
            Detect deliveries <ArrowRight className="size-4" />
          </Button>
        </>
      )}

      {p.tab === "detect" && (
        <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
          <Button variant="outline" className="justify-self-start" disabled={p.running} onClick={() => p.onTab("params")}>
            <ArrowLeft className="size-4" /> Parameters
          </Button>
          <div className="flex min-w-0 items-center justify-center gap-3">
            <Button disabled={p.running || !p.canDetect} onClick={p.onRun}>
              {p.running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {p.running ? "Running" : "Detect & cut"}
            </Button>
            <Status error={p.runError} text={p.runStatus} />
          </div>
          <Button className="justify-self-end" variant={p.canReview ? "default" : "outline"} disabled={!p.canReview} onClick={() => p.onTab("review")}>
            Review clips <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      {p.tab === "review" && (
        <>
          <Button variant="outline" onClick={() => p.onTab("detect")}>
            <ArrowLeft className="size-4" /> Detect
          </Button>
          <Status error={p.exportState.error} text={p.exportState.status} />
          {p.exportState.result && (
            <div className="flex flex-wrap gap-2">
              {/* /api/download sets Content-Disposition, so the browser saves rather than plays (different origin) */}
              {p.exportState.result.zip_url && (
                <Button asChild variant="outline"><a href={api(p.exportState.result.zip_url)}><Download className="size-4" /> Download clips (.zip)</a></Button>
              )}
              {p.exportState.result.concat_url && (
                <Button asChild variant="outline"><a href={api(p.exportState.result.concat_url)}><Download className="size-4" /> Download combined video</a></Button>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Select value={p.exportState.mode} onValueChange={(v) => p.onExportMode(v as ExportMode)}>
              <SelectTrigger className="w-52" aria-label="Export mode"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="separate">Separate clips (.zip)</SelectItem>
                <SelectItem value="concat">One combined video</SelectItem>
              </SelectContent>
            </Select>
            <Button disabled={!p.canExport || p.exportState.busy} onClick={p.onExport}>
              {p.exportState.busy && <Loader2 className="size-4 animate-spin" />}
              {p.exportState.busy ? "Exporting" : "Export"}
            </Button>
          </div>
        </>
      )}
    </footer>
  )
}
