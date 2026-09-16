import { ArrowRight, Download, Loader2, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import type { ExportMode, ExportResult } from "@/lib/types"

export type Tab = "params" | "detect" | "review"

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

export function WorkFooter(p: Props) {
  return (
    <footer className="sticky bottom-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center gap-2.5 border-t bg-card/80 px-3 py-2.5 backdrop-blur sm:px-5 lg:static lg:bg-card/60">
      {p.tab === "params" && (
        <Button className="ml-auto" disabled={!p.canDetect} onClick={() => p.onTab("detect")}>
          Next <ArrowRight className="size-4" />
        </Button>
      )}

      {p.tab === "detect" && (
        <>
          <Button disabled={p.running || !p.canDetect} onClick={p.onRun}>
            {p.running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Detect &amp; cut
          </Button>
          <span className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
            {p.runError ? <span className="text-destructive">Error: {p.runError}</span> : p.runStatus}
          </span>
          <Button className="ml-auto" disabled={!p.canReview} onClick={() => p.onTab("review")}>
            Next <ArrowRight className="size-4" />
          </Button>
        </>
      )}

      {p.tab === "review" && (
        <>
          <Select value={p.exportState.mode} onValueChange={(v) => p.onExportMode(v as ExportMode)}>
            <SelectTrigger className="w-52" aria-label="Export mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="separate">Separate clips (zip)</SelectItem>
              <SelectItem value="concat">One combined video</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={!p.canExport || p.exportState.busy} onClick={p.onExport}>
            {p.exportState.busy && <Loader2 className="size-4 animate-spin" />}
            Export
          </Button>
          <span className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
            {p.exportState.error ? <span className="text-destructive">Error: {p.exportState.error}</span> : p.exportState.status}
          </span>
          {p.exportState.result && (
            <div className="ml-auto flex flex-wrap gap-2">
              {/* /api/download sets Content-Disposition, so the browser saves rather than plays (different origin) */}
              {p.exportState.result.zip_url && (
                <Button asChild variant="secondary"><a href={api(p.exportState.result.zip_url)}><Download className="size-4" /> Clips (.zip)</a></Button>
              )}
              {p.exportState.result.concat_url && (
                <Button asChild variant="secondary"><a href={api(p.exportState.result.concat_url)}><Download className="size-4" /> Combined video</a></Button>
              )}
            </div>
          )}
        </>
      )}
    </footer>
  )
}
