"use client"

import { MessageCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The entry point that opens the core-post AI-refine chat (CorePostChat).
 *
 * `design` selects the visual treatment:
 *   - "legacy" — the shipped white outline MessageCircle icon button. Rendered
 *     when no ?variant param is present, so /project stays byte-identical to
 *     production.
 *   - "a" — labeled AI pill: white surface + neutral border, a gradient-filled
 *     sparkle glyph, and the visible words "עריכה עם AI". The action is
 *     legible without hover (Rachel's D2 / the Canva "Magic Write", Instagram
 *     "Write with Meta AI" pattern).
 *   - "b" — compact icon button: the same 44×44 footprint as today, white
 *     surface, gradient-filled sparkle glyph, no label — for the tight RTL
 *     action row.
 *
 * Per Hani (2026-08-04): the gradient paints the GLYPH, not the button — the
 * surface stays white. The gradient and the "frozen/disabled" treatment live
 * here once and are shared by both variants — they must never diverge per
 * call site.
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
 * Shared gradient that paints the sparkle glyph. Built from the project's
 * yellow token scale (globals.css `@theme`) — no raw hex. NOTE: the token
 * system has no dedicated "orange" primitive, so the deep end is the darkest
 * warm yellow (yellow-30). See the handoff note about adding an orange
 * primitive if a hotter gradient is wanted.
 */
const AI_GRADIENT_STOPS = [
  { offset: "0%", color: "var(--color-yellow-50)" },
  { offset: "55%", color: "var(--color-yellow-40)" },
  { offset: "100%", color: "var(--color-yellow-30)" },
] as const

/**
 * The gradient fills the GLYPH, not the button, so it can't be a CSS
 * background — an SVG <linearGradient> is the only way to paint a path with
 * it. Rendered zero-size next to the button; the glyph references it by id.
 * Token values come through `style` because `var()` doesn't resolve inside a
 * plain SVG attribute.
 */
const AI_GRADIENT_ID = "ai-refine-gradient"

/**
 * One four-point sparkle: a diamond whose edges bow inward, so the points read
 * sharp. `bulge` is how far the curve's control points sit from the centre as
 * a fraction of the radius — lower is pointier (0.42 matches Hani's reference).
 */
function starPath(cx: number, cy: number, r: number, bulge = 0.42): string {
  const c = +(r * bulge).toFixed(2)
  const [x, y, R] = [cx, cy, r]
  return (
    `M${x},${y - R} ` +
    `C${x},${y - c} ${x + c},${y} ${x + R},${y} ` +
    `C${x + c},${y} ${x},${y + c} ${x},${y + R} ` +
    `C${x},${y + c} ${x - c},${y} ${x - R},${y} ` +
    `C${x - c},${y} ${x},${y - c} ${x},${y - R} Z`
  )
}

/**
 * The AI sparkle cluster — one dominant star with two smaller ones trailing
 * off its top-right and bottom-right, per Hani's reference (2026-08-04).
 * Solid fill, no stroke: the gradient paints the glyph body itself.
 *
 * `fill` is set on the <svg> and inherited by the paths, so a single style or
 * `fill-current` class drives all three stars.
 */
function AiSparkIcon({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      <path d={starPath(9, 13.5, 8.5)} />
      <path d={starPath(18.2, 5.6, 4)} />
      <path d={starPath(18.6, 17.4, 3)} />
    </svg>
  )
}

function AiGradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <defs>
        <linearGradient id={AI_GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
          {AI_GRADIENT_STOPS.map((s) => (
            <stop key={s.offset} offset={s.offset} style={{ stopColor: s.color }} />
          ))}
        </linearGradient>
      </defs>
    </svg>
  )
}

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

  // Gradient-filled glyph on a white button (per Hani). Frozen state drops the
  // gradient for the flat disabled token — dignified "locked", not a glitch.
  const glyphStyle = disabled ? undefined : { fill: `url(#${AI_GRADIENT_ID})` }

  const sparkle = (
    <AiSparkIcon
      style={glyphStyle}
      className={cn(
        "size-4 shrink-0",
        disabled && "fill-current text-text-primary-disabled",
        busy && !disabled && "ai-sparkle-pulse",
      )}
    />
  )

  // The surface is the project's secondary button — `variant="outline"` on the
  // shared Button (white + border-border-neutral-default + gray-95 hover), the
  // same control the legacy icon button used and the same one used across the
  // app's 60-odd secondary actions. NOT `variant="secondary"`, which is still
  // on raw shadcn theme colours. Only the glyph is bespoke.
  if (design === "a") {
    return (
      <>
        <AiGradientDefs />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
          className="gap-1.5"
        >
          {sparkle}
          <span>{label}</span>
        </Button>
      </>
    )
  }

  // design === "b" — icon-only gradient sparkle, same 44×44 footprint as today.
  return (
    <>
      <AiGradientDefs />
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        className="size-[44px] rounded-[12px]"
      >
        <AiSparkIcon
          style={glyphStyle}
          className={cn(
            "size-5 shrink-0",
            disabled && "fill-current text-text-primary-disabled",
            busy && !disabled && "ai-sparkle-pulse",
          )}
        />
      </Button>
    </>
  )
}
