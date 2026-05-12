"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

// forwardRef so call sites that need to focus the checkbox programmatically
// (e.g. ScheduleFormatPicker focusing the first ready row on mount) can
// attach a ref. radix CheckboxPrimitive.Root already exposes a ref to the
// underlying button — we just pass it through. Existing call sites that
// don't pass `ref` are unaffected.
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentProps<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-border-neutral-default bg-white dark:bg-gray-10 transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-yellow-20 dark:data-[state=checked]:bg-yellow-50 data-[state=checked]:border-transparent data-[state=checked]:text-white dark:data-[state=checked]:text-gray-10",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
