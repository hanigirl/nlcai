"use client"

import { Check } from "lucide-react"
import { Chip } from "@/components/ui/chip"
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
          <Chip key={r} selected={on} onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}>
            {on && <Check aria-hidden />}
            {DISLIKE_REASONS[r]}
          </Chip>
        )
      })}
    </div>
  )
}
