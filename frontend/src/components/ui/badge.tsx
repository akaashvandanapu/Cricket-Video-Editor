import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-card text-foreground/80",
        brand: "border-brand/25 bg-brand/8 text-brand",
        warn: "border-warn/30 bg-warn/8 text-warn",
        success: "border-success/30 bg-success/8 text-success",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        ghost: "border-transparent text-muted-foreground",
      },
    },
    defaultVariants: { variant: "outline" },
  },
)

function Badge({
  className,
  variant = "outline",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
