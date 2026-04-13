import * as React from "react"

import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

const selectVariants = {
  default: "bg-bg-surface",
  homepage: "bg-white dark:bg-gray-10",
} as const

const selectSizes = {
  large: "h-11 rounded-xl",
  small: "h-[34px] rounded-[10px]",
} as const

type SelectVariant = keyof typeof selectVariants
type SelectSize = keyof typeof selectSizes

function Select({
  className,
  variant = "default",
  selectSize = "large",
  children,
  ...props
}: React.ComponentProps<"select"> & {
  variant?: SelectVariant
  selectSize?: SelectSize
}) {
  return (
    <div className="relative w-full">
      <select
        data-slot="select"
        className={cn(
          "w-full min-w-0 appearance-none border border-border-neutral-default pe-9 ps-3 py-2 text-base shadow-none transition-[color,box-shadow] outline-none placeholder:text-text-neutral-default disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          selectVariants[variant],
          selectSizes[selectSize],
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
    </div>
  )
}

export { Select }
