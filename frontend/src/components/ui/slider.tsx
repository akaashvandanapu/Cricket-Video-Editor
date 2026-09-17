"use client"

import * as React from "react"
import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "group/slider relative flex w-full touch-none items-center py-2 select-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-input/60 dark:bg-input/40"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary select-none" />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="relative block size-4 shrink-0 rounded-full border-[1.5px] border-primary bg-card shadow-[0_1px_3px_rgba(0,0,0,.18)] transition-[box-shadow,transform] select-none after:absolute after:-inset-3 hover:ring-4 hover:ring-primary/12 focus-visible:ring-4 focus-visible:ring-primary/18 focus-visible:outline-hidden active:scale-95 active:ring-4 active:ring-primary/18 disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
