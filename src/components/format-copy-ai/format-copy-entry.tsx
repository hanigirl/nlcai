"use client"

import type { ReactNode } from "react"
import { AiRefineButton } from "@/components/ai-refine-button"
import { COPY_NOUN, isCopyFormat } from "@/lib/format-copy-refine"
import type { FormatCopyAiController } from "./use-format-copy-ai"
import { CopyMediaNote } from "./copy-ai-parts"

/**
 * The action row under a format card's text: ✨ "עריכה עם AI" beside the
 * card's other button ("הוספת מדיה"), side by side (Hani, 2026-10-29: "שני
 * הכפתורים אחד ליד השני ולא מתחת"). The AI button opens FormatCopyChat.
 *
 * `children` is the card's existing button, passed through untouched — and
 * rendered alone when there is no controller or the id isn't a copy format.
 */
export function FormatCopyActionRow({
  ctrl,
  fid,
  hasMedia,
  children,
}: {
  ctrl?: FormatCopyAiController
  fid: string
  /** Media already made won't follow a copy change — say so while editing. */
  hasMedia: boolean
  children: ReactNode
}) {
  if (!ctrl || !isCopyFormat(fid)) return <>{children}</>
  const isOpen = ctrl.activeFid === fid
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 [&>*]:flex-1 [&>*]:min-w-0">
        <span
          data-demo="copy-ai-button"
          className="inline-flex"
          // The canvas pans on mousedown; keep a click on the button a click.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <AiRefineButton
            busy={ctrl.session(fid).loading}
            onClick={() => (isOpen ? ctrl.close() : ctrl.open(fid))}
            label="עריכה עם AI"
            className="w-full rounded-[10px] border-border-neutral-default text-small"
          />
        </span>
        {children}
      </div>
      {isOpen && hasMedia && <CopyMediaNote />}
      <span className="sr-only" aria-live="polite">
        {isOpen ? `עריכת ${COPY_NOUN[fid]} עם AI פתוחה` : ""}
      </span>
    </div>
  )
}
