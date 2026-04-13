import * as React from "react"

import { cn } from "@/lib/utils"

const inputVariants = {
  default: "bg-bg-surface",
  homepage: "bg-white dark:bg-gray-10",
} as const

const inputSizes = {
  large: "h-11 rounded-xl",
  small: "h-[34px] rounded-[10px]",
} as const

type InputVariant = keyof typeof inputVariants
type InputSize = keyof typeof inputSizes

function Input({
  className,
  type,
  variant = "default",
  inputSize = "large",
  ...props
}: React.ComponentProps<"input"> & { variant?: InputVariant; inputSize?: InputSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 border border-border-neutral-default px-3 py-2 text-base shadow-none transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-neutral-default disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        inputVariants[variant],
        inputSizes[inputSize],
        className
      )}
      {...props}
    />
  )
}

export { Input }
