"use client"

import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DISLIKE_REASONS, type DislikeReason } from "@/lib/visual-language/types"

/**
 * The "מה לא עבד?" reasons after a 👎 — on the card and in the AI-edit panel.
 * The outline button as-is, our grey hover; a selected reason gets the grey
 * fill and a check, never yellow (Hani, 2026-10-29: "די עם הצהוב הזה").
 */
export function DislikeReasonChips({
  value,
  onChange,
  className,
}: {
  value: DislikeReason[]
  onChange: (next: DislikeReason[]) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`} role="group" aria-label="מה לא עבד">
      {(Object.keys(DISLIKE_REASONS) as DislikeReason[]).map((r) => {
        const on = value.includes(r)
        return (
          <Button
            key={r}
            type="button"
            variant="outline"
            size="xs"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={`rounded-full ${on ? "bg-gray-95 dark:bg-gray-20 border-text-primary-default" : ""}`}
          >
            {on && <Check aria-hidden />}
            {DISLIKE_REASONS[r]}
          </Button>
        )
      })}
    </div>
  )
}
