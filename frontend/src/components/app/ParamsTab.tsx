import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import type { Params } from "@/lib/types"

interface Props {
  params: Params
  disabled: boolean
  onChange: (patch: Partial<Params>) => void
}

interface SliderRowProps {
  id: string
  label: React.ReactNode
  value: number
  display: string
  min: number
  max: number
  step: number
  hint?: string
  disabled: boolean
  onChange: (v: number) => void
}

function SliderRow({ id, label, value, display, min, max, step, hint, disabled, onChange }: SliderRowProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <Label htmlFor={id} className="text-sm leading-snug"><span>{label}</span></Label>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-foreground/90">{display}</span>
      </div>
      {/* the label is always rendered from `value`, so it can never disagree with the thumb */}
      <Slider id={id} min={min} max={max} step={step} value={[value]} disabled={disabled}
        onValueChange={([v]) => onChange(v)} aria-label={typeof label === "string" ? label : id} />
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ParamsTab({ params, disabled, onChange }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <section className="space-y-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Clip length</h2>
        <SliderRow id="preRoll" label={<>Seconds to keep <b>before</b> each delivery</>} value={params.preRoll}
          display={`${params.preRoll.toFixed(1)}s`} min={0.5} max={10} step={0.5} disabled={disabled}
          onChange={(v) => onChange({ preRoll: v })} />
        <SliderRow id="postRoll" label={<>Seconds to keep <b>after</b> each delivery</>} value={params.postRoll}
          display={`${params.postRoll.toFixed(1)}s`} min={0.5} max={10} step={0.5} disabled={disabled}
          onChange={(v) => onChange({ postRoll: v })} />
      </section>

      <section className="space-y-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Detection</h2>
        <SliderRow id="sensitivity" label="Detection sensitivity" value={params.sensitivity}
          display={String(params.sensitivity)} min={0} max={100} step={1} disabled={disabled}
          hint="Higher catches more, including fainter touches."
          onChange={(v) => onChange({ sensitivity: v })} />
        <SliderRow id="strictness" label="Strictness — how sure it must be before keeping a clip" value={params.strictness}
          display={String(params.strictness)} min={0} max={100} step={5} disabled={disabled}
          hint="Raise this if you still get bat taps or ball throw-backs; lower it if soft or defensive shots are being missed. 0 keeps everything the sound stage found."
          onChange={(v) => onChange({ strictness: v })} />
        <SliderRow id="minGap" label="Minimum gap between two deliveries" value={params.minGap}
          display={`${params.minGap.toFixed(1)}s`} min={1.5} max={8} step={0.5} disabled={disabled}
          hint="Also removes bat taps and throw-backs landing within this many seconds of a real hit. Lower it only if genuinely quick deliveries are being merged."
          onChange={(v) => onChange({ minGap: v })} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Output</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="resolution" className="text-sm">Output resolution</Label>
          <Select value={params.resolution} disabled={disabled}
            onValueChange={(v) => onChange({ resolution: v as Params["resolution"] })}>
            <SelectTrigger id="resolution" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1080">1080p (recommended)</SelectItem>
              <SelectItem value="720">720p (smaller / faster)</SelectItem>
              <SelectItem value="original">Original (slowest, largest)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  )
}
