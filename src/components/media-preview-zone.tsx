"use client"

import type { ReactNode } from "react"
import { ImageIcon, Trash2, type LucideIcon } from "lucide-react"
import { TooltipLabel } from "@/components/ui/tooltip"
import { AI_HOVER_ZONE, AiHoverEditButton } from "@/components/ai-hover-edit"
import { cn } from "@/lib/utils"

/**
 * A format's media preview on its result card (carousel, story, b-roll, image,
 * talking head). Clicking the media opens that format's media panel to change
 * it — there is no separate "עריכת קרוסלה" / "עריכת סטורי" button any more
 * (Hani, 2026-10-29). Hovering it reveals the AI sparkle ("עריכת מדיה עם AI")
 * when the format can be edited with AI.
 *
 * Controls inside the media keep their own click: anything that is a button,
 * link, form field, native-controls video or iframe, or is marked
 * `data-media-control`, never opens the panel.
 */

/** Height of the browser's native video control bar, from the bottom edge. */
const VIDEO_CONTROL_BAR_PX = 56

const CONTROL_SELECTOR =
  "button, a, input, select, textarea, label, video[controls], iframe, [data-media-control]"

export function MediaPreviewZone({
  onOpen,
  openLabel,
  onAiEdit,
  aiBusy = false,
  aiClassName,
  onDelete,
  deleteLabel = "מחיקת המדיה",
  onSwapPhoto,
  className,
  children,
}: {
  /**
   * Opens the media panel for this format. Absent = the media isn't a click
   * target at all (the canvas panel, Hani 2026-11-09: tapping her picture
   * reopened the "no media yet" flows and brought back the version before
   * her last edit). Only the hover actions act on it then.
   */
  onOpen?: () => void
  /** Accessible name for the click-to-change action, e.g. "החלפת הקרוסלה". */
  openLabel?: string
  /** Present = the AI sparkle is offered on this media. */
  onAiEdit?: () => void
  aiBusy?: boolean
  /** Unused: the sparkle is always shown now. */
  aiVisible?: boolean
  /** Moves the sparkle — e.g. above a native video control bar. */
  aiClassName?: string
  /** Present = a hover delete button at the bottom-left corner (Hani, 2026-11-07). */
  onDelete?: () => void
  deleteLabel?: string
  /** Present = "החלפת תמונה" at the top corner (b-roll, Hani 2026-11-10). */
  onSwapPhoto?: () => void
  /** Size / shape of the zone — matches the preview it wraps. */
  className?: string
  children: ReactNode
}) {
  const actions = (
    <>
      {onAiEdit && (
        <AiHoverEditButton
          target="media"
          onClick={onAiEdit}
          busy={aiBusy}
          // Always shown on media (Hani, 2026-11-09: "people will not find it" on hover).
          visible
          className={aiClassName}
        />
      )}
      {onSwapPhoto && (
        <HoverMediaIconButton label="החלפת תמונה" icon={ImageIcon} onClick={onSwapPhoto} visible className="top-2 end-2" />
      )}
      {onDelete && (
        <HoverMediaIconButton
          label={deleteLabel}
          icon={Trash2}
          destructive
          onClick={onDelete}
          visible
          className={cn("bottom-2 end-2", aiClassName)}
        />
      )}
    </>
  )
  if (!onOpen) {
    return (
      <div className={cn(AI_HOVER_ZONE, "rounded-xl", className)} onMouseDown={(e) => e.stopPropagation()}>
        {children}
        {actions}
      </div>
    )
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={openLabel}
      className={cn(
        AI_HOVER_ZONE,
        "cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
        className,
      )}
      // The canvas pans on mousedown; keep a click on the media a click.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        const control = (e.target as HTMLElement).closest(CONTROL_SELECTOR)
        if (control && e.currentTarget.contains(control)) {
          // A clip with native controls fills the whole preview, so treating
          // the entire <video> as a control meant a click on a b-roll / story
          // clip never opened the panel (Hani, 2026-11-06). Only its control
          // bar (the bottom strip) plays it; a click on the picture opens the
          // panel — and doesn't also start playback.
          if (!(control instanceof HTMLVideoElement)) return
          const rect = control.getBoundingClientRect()
          if (e.clientY >= rect.bottom - VIDEO_CONTROL_BAR_PX) return
          e.preventDefault()
        }
        e.stopPropagation()
        onOpen()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {children}
      {actions}
    </div>
  )
}

/**
 * One floating action on a media preview — the same white 36px square as the
 * ✨ and the delete (shadow, gray hover, shown on hover / focus / touch).
 * Put it inside an AI_HOVER_ZONE wrapper; `className` sets its corner.
 */
export function HoverMediaIconButton({
  label,
  icon: Icon,
  onClick,
  destructive = false,
  disabled = false,
  visible = false,
  className,
}: {
  /** Shown without hover. */
  visible?: boolean
  /** Tooltip and accessible name (an action noun: "הורדת הקאבר"). */
  label: string
  icon: LucideIcon
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  /** Position: e.g. "bottom-2 end-2". */
  className?: string
}) {
  return (
    <TooltipLabel label={label}>
      <button
        type="button"
        aria-label={label}
        data-media-control=""
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className={cn(
          "absolute z-20 flex size-9 items-center justify-center rounded-[10px] bg-white shadow-md transition-[opacity,background-color] hover:bg-gray-95 dark:bg-gray-10 dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 cursor-pointer disabled:cursor-not-allowed",
          visible
            ? "opacity-100"
            : "opacity-0 group-hover/ai:opacity-100 group-focus-within/ai:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
          className,
        )}
      >
        <Icon className={cn("size-4", destructive ? "text-button-destructive-default" : "text-text-primary-default")} aria-hidden />
      </button>
    </TooltipLabel>
  )
}
