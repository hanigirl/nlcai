"use client"

import { AiGradientDefs, AiSparkIcon, AI_GRADIENT_ID } from "@/components/ai-refine-button"
import { TooltipLabel } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * The ONE way into AI editing on the post page (Hani, 2026-10-29): a small
 * white sparkle button with a shadow, pinned to the bottom corner of the text
 * box or media it edits, shown on hover. Replaces every "עריכה עם AI" pill —
 * core post, each format's copy, each format's media.
 *
 * It sits inside an `AI_HOVER_ZONE` (the text box / media wrapper), which is
 * what reveals it: hover over the zone, keyboard focus inside it, or a device
 * with no hover at all (touch), where it simply stays visible.
 *
 * Corner: bottom, on the inline START side — bottom-right in the RTL page,
 * where Hani's design draws it.
 */

/** Put on the wrapper the button is pinned to. */
export const AI_HOVER_ZONE = "group/ai relative"

export type AiHoverTarget = "text" | "media"

const LABEL: Record<AiHoverTarget, string> = {
  text: "עריכת טקסט עם AI",
  media: "עריכת מדיה עם AI",
}

export function AiHoverEditButton({
  target,
  onClick,
  disabled = false,
  disabledLabel,
  busy = false,
  visible = false,
  className,
  "data-demo": dataDemo,
}: {
  /** What it edits — sets the tooltip / accessible name. */
  target: AiHoverTarget
  onClick: () => void
  /** Can't edit right now (frozen core post). Stays focusable so the tooltip explains why. */
  disabled?: boolean
  /** Tooltip while disabled. */
  disabledLabel?: string
  /** The AI is working on this — pulse the sparkle and keep the button shown. */
  busy?: boolean
  /** Keep it shown without hover (its panel is open, or a design preview). */
  visible?: boolean
  /** Position only. */
  className?: string
  "data-demo"?: string
}) {
  const label = LABEL[target]
  const shown = visible || busy
  return (
    <>
      <AiGradientDefs />
      <TooltipLabel label={disabled && disabledLabel ? disabledLabel : label}>
        <button
          type="button"
          aria-label={label}
          aria-disabled={disabled || undefined}
          data-demo={dataDemo}
          // Marks it as a control inside a clickable media preview, so a click
          // here never also opens the media panel (MediaPreviewZone).
          data-media-control=""
          // The canvas pans on mousedown, and the story player pauses on a
          // press — this click belongs to the button alone.
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            if (!disabled) onClick()
          }}
          className={cn(
            "absolute bottom-2 start-2 z-20 flex size-9 items-center justify-center rounded-[10px] bg-white shadow-md transition-[opacity,background-color] hover:bg-gray-95 dark:bg-gray-10 dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
            shown
              ? "opacity-100"
              : "opacity-0 group-hover/ai:opacity-100 group-focus-within/ai:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
            className,
          )}
        >
          <AiSparkIcon
            style={disabled ? undefined : { fill: `url(#${AI_GRADIENT_ID})` }}
            className={cn(
              "size-[18.4px] shrink-0",
              disabled && "fill-current text-text-primary-disabled",
              busy && !disabled && "ai-sparkle-pulse",
            )}
          />
        </button>
      </TooltipLabel>
    </>
  )
}
