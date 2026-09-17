import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { DEFAULT_PARAMS, type Params } from "@/lib/types"

interface Props {
  params: Params
  disabled: boolean
  onChange: (patch: Partial<Params>) => void
}

/** Settings-page row: heading and description on the left, controls in a
 * card on the right. Stacks on narrow screens. */
export function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,13rem)_1fr] md:gap-10">
      <div className="md:pt-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 divide-y rounded-xl bg-card shadow-card ring-1 ring-border">{children}</div>
    </section>
  )
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
    <div className="space-y-1.5 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id} className="text-[13.5px] leading-snug font-medium"><span>{label}</span></Label>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-[12px] font-medium tabular-nums text-foreground/85">{display}</span>
      </div>
      {/* the label is always rendered from `value`, so it can never disagree with the thumb */}
      <Slider id={id} min={min} max={max} step={step} value={[value]} disabled={disabled}
        onValueChange={([v]) => onChange(v)} aria-label={typeof label === "string" ? label : id} />
      {hint && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ParamsTab({ params, disabled, onChange }: Props) {
  const dirty = (Object.keys(DEFAULT_PARAMS) as (keyof Params)[]).some((k) => params[k] !== DEFAULT_PARAMS[k])
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {dirty && (
        <div className="-mb-6 flex justify-end">
          <button type="button" disabled={disabled} onClick={() => onChange(DEFAULT_PARAMS)}
            className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50">
            Reset to defaults
          </button>
        </div>
      )}

      <SettingsSection title="Clip length" description="Seconds of footage kept either side of the moment of contact.">
        <SliderRow id="preRoll" label={<>Before each delivery</>} value={params.preRoll}
          display={`${params.preRoll.toFixed(1)} s`} min={0.5} max={10} step={0.5} disabled={disabled}
          onChange={(v) => onChange({ preRoll: v })} />
        <SliderRow id="postRoll" label={<>After each delivery</>} value={params.postRoll}
          display={`${params.postRoll.toFixed(1)} s`} min={0.5} max={10} step={0.5} disabled={disabled}
          onChange={(v) => onChange({ postRoll: v })} />
      </SettingsSection>

      <SettingsSection title="Detection" description="Tune how many candidate sounds are heard and how sure the checks must be before a clip is kept.">
        <SliderRow id="sensitivity" label="Sensitivity" value={params.sensitivity}
          display={String(params.sensitivity)} min={0} max={100} step={1} disabled={disabled}
          hint="Higher catches more, including fainter touches."
          onChange={(v) => onChange({ sensitivity: v })} />
        <SliderRow id="strictness" label="Strictness" value={params.strictness}
          display={String(params.strictness)} min={0} max={100} step={5} disabled={disabled}
          hint="How sure it must be before keeping a clip. Raise it if bat taps or throw-backs get through; lower it if soft or defensive shots are missed. 0 keeps everything the sound stage found."
          onChange={(v) => onChange({ strictness: v })} />
        <SliderRow id="minGap" label="Minimum gap between deliveries" value={params.minGap}
          display={`${params.minGap.toFixed(1)} s`} min={1.5} max={8} step={0.5} disabled={disabled}
          hint="Also removes taps and throw-backs landing within this many seconds of a real hit. Lower it only if genuinely quick deliveries are being merged."
          onChange={(v) => onChange({ minGap: v })} />
      </SettingsSection>

      <SettingsSection title="Output" description="Resolution of the exported clips. Source footage is never modified.">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <Label htmlFor="resolution" className="text-[13.5px] font-medium">Resolution</Label>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">1080p is the sweet spot for sharing.</p>
          </div>
          <Select value={params.resolution} disabled={disabled}
            onValueChange={(v) => onChange({ resolution: v as Params["resolution"] })}>
            <SelectTrigger id="resolution" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="1080">1080p · recommended</SelectItem>
              <SelectItem value="720">720p · smaller, faster</SelectItem>
              <SelectItem value="original">Original · slowest, largest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsSection>
    </div>
  )
}
