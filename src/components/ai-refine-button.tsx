"use client"

import { MessageCircle, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The entry point that opens the core-post AI-refine chat (CorePostChat).
 *
 * `design` selects the visual treatment:
 *   - "legacy" — the shipped white outline MessageCircle icon button. Rendered
 *     when no ?variant param is present, so /project stays byte-identical to
 *     production.
 *   - "a" — labeled gradient AI pill: yellow→orange gradient fill + Sparkles
 *     glyph + the visible words "עריכה עם AI". The action is legible without
 *     hover (Rachel's D2 / the Canva "Magic Write", Instagram "Write with Meta
 *     AI" pattern).
 *   - "b" — compact gradient sparkle icon: the same 44×44 icon-button footprint
 *     as today, but filled with the gradient and carrying the Sparkles glyph
 *     (Rachel's D1 / the Fresha gradient-badge shape). Pure iconography, no
 *     label — for the tight RTL action row.
 *
 * The gradient fill and the "frozen/disabled" treatment live here once and are
 * shared by both variants — they must never diverge per call site.
 */

export type AiRefineDesign = "legacy" | "a" | "b"

interface AiRefineButtonProps {
  design: AiRefineDesign
  /** Frozen after "שיכפול לפורמטים" — the core post can no longer be edited. */
  disabled?: boolean
  /** The AI is currently generating a revision — pulse the sparkle. */
  busy?: boolean
  onClick?: () => void
  /** Accessible name / visible label. Defaults to the AI-forward wording. */
  label?: string
}

/**
 * Shared yellow→orange gradient fill. Built from the project's yellow token
 * scale (globals.css `@theme`). NOTE: the token system has no dedicated
 * "orange" primitive — the deep end is the warmest yellow available
 * (yellow-40). See the handoff note about adding an orange primitive if a
 * hotter gradient is wanted.
 */
const AI_GRADIENT =
  "linear-gradient(135deg, var(--color-yellow-60) 0%, var(--color-yellow-50) 55%, var(--color-yellow-40) 100%)"

export function AiRefineButton({
  design,
  disabled = false,
  busy = false,
  onClick,
  label = "עריכה עם AI",
}: AiRefineButtonProps) {
  // Byte-identical to the shipped control — used when no ?variant is set.
  if (design === "legacy") {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        aria-label="עריכת פוסט ליבה"
        onClick={onClick}
        className="size-[44px] rounded-[12px]"
      >
        <MessageCircle className="size-4" />
      </Button>
    )
  }

  const sparkle = (
    <Sparkles
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        // The gradient is a light warm yellow — dark glyph keeps AA contrast
        // and reads distinct from the dark primary CTA beside it.
        disabled ? "text-text-primary-disabled" : "text-text-primary-default",
        busy && !disabled && "ai-sparkle-pulse",
      )}
    />
  )

  // Frozen state: drop the gradient, sit quietly as a neutral disabled control
  // (dignified "locked", not a glitch) — Rachel's F5.
  const gradientStyle = disabled ? undefined : { backgroundImage: AI_GRADIENT }

  const base =
    "inline-flex items-center justify-center transition-all outline-none " +
    "focus-visible:ring-[3px] focus-visible:ring-yellow-50/50 disabled:pointer-events-none " +
    "disabled:bg-button-primary-disabled disabled:text-text-primary-disabled"

  if (design === "a") {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        style={gradientStyle}
        className={cn(
          base,
          "h-[44px] gap-1.5 rounded-[12px] px-4 text-[16px] leading-[1.3] font-medium",
          "text-text-primary-default shadow-sm hover:brightness-105 active:brightness-95",
        )}
      >
        {sparkle}
        <span>{label}</span>
      </button>
    )
  }

  // design === "b" — icon-only gradient sparkle, same 44×44 footprint as today.
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      style={gradientStyle}
      className={cn(
        base,
        "size-[44px] rounded-[12px]",
        "text-text-primary-default shadow-sm hover:brightness-105 active:brightness-95",
      )}
    >
      <Sparkles
        aria-hidden="true"
        className={cn(
          "size-5 shrink-0",
          disabled ? "text-text-primary-disabled" : "text-text-primary-default",
          busy && !disabled && "ai-sparkle-pulse",
        )}
      />
    </button>
  )
}
