"use client"

import type { ReactNode } from "react"
import { Trash2 } from "lucide-react"
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
  aiVisible = false,
  aiClassName,
  onDelete,
  deleteLabel = "מחיקת המדיה",
  className,
  children,
}: {
  /** Opens the media panel for this format. */
  onOpen: () => void
  /** Accessible name for the click-to-change action, e.g. "החלפת הקרוסלה". */
  openLabel: string
  /** Present = the AI sparkle is offered on this media. */
  onAiEdit?: () => void
  aiBusy?: boolean
  /** Keep the sparkle shown without hover (design preview). */
  aiVisible?: boolean
  /** Moves the sparkle — e.g. above a native video control bar. */
  aiClassName?: string
  /** Present = a hover delete button at the bottom-left corner (Hani, 2026-11-07). */
  onDelete?: () => void
  deleteLabel?: string
  /** Size / shape of the zone — matches the preview it wraps. */
  className?: string
  children: ReactNode
}) {
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
      {onAiEdit && (
        <AiHoverEditButton
          target="media"
          onClick={onAiEdit}
          busy={aiBusy}
          visible={aiVisible}
          className={aiClassName}
        />
      )}
      {onDelete && (
        <button
          type="button"
          aria-label={deleteLabel}
          title={deleteLabel}
          data-media-control=""
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className={cn(
            "absolute bottom-2 end-2 z-20 flex size-9 items-center justify-center rounded-[10px] bg-white shadow-md transition-[opacity,background-color] hover:bg-gray-95 dark:bg-gray-10 dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 cursor-pointer",
            "opacity-0 group-hover/ai:opacity-100 group-focus-within/ai:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            aiClassName,
          )}
        >
          <Trash2 className="size-4 text-button-destructive-default" aria-hidden />
        </button>
      )}
    </div>
  )
}
