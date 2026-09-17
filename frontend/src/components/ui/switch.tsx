import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input/70 p-0.5 transition-colors outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        "data-checked:bg-primary dark:bg-input/50 dark:data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-transform data-checked:translate-x-4 dark:data-checked:bg-background"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
