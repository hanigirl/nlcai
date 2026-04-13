import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

function FormField({
  label,
  helperText,
  error,
  children,
  className,
}: {
  label?: string
  helperText?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1 items-end w-full", className)}>
      {label && (
        <div className="flex items-center justify-center pe-2">
          <Label className="text-small text-text-primary-default">
            {label}
          </Label>
        </div>
      )}
      {children}
      {(error || helperText) && (
        <div className="flex items-center justify-center pe-1">
          <p
            className={cn(
              "text-xs-body",
              error
                ? "text-button-destructive-default"
                : "text-text-neutral-default"
            )}
          >
            {error || helperText}
          </p>
        </div>
      )}
    </div>
  )
}

export { FormField }
