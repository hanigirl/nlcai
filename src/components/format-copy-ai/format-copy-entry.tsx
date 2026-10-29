"use client"

import type { ReactNode } from "react"
import { AiHoverEditButton } from "@/components/ai-hover-edit"
import { COPY_NOUN, isCopyFormat } from "@/lib/format-copy-refine"
import type { FormatCopyAiController } from "./use-format-copy-ai"
import { CopyMediaNote } from "./copy-ai-parts"

/**
 * The way into "עריכה עם AI" on a format's copy: the hover sparkle pinned to
 * the bottom corner of the card's text box (Hani, 2026-10-29 — it replaced the
 * "עריכה עם AI" pill that sat beside "הוספת מדיה"). Opens FormatCopyChat;
 * pressing it again while that format's panel is open closes it.
 *
 * Render inside the text box's `AI_HOVER_ZONE` wrapper. Nothing without a
 * controller, or for an id that isn't a copy format.
 */
export function FormatCopyAiHoverButton({
  ctrl,
  fid,
  visible = false,
}: {
  ctrl?: FormatCopyAiController
  fid: string
  /** Keep it shown without hover (design preview). */
  visible?: boolean
}) {
  if (!ctrl || !isCopyFormat(fid)) return null
  const isOpen = ctrl.activeFid === fid
  return (
    <AiHoverEditButton
      target="text"
      data-demo="copy-ai-button"
      busy={ctrl.session(fid).loading}
      visible={visible || isOpen}
      onClick={() => (isOpen ? ctrl.close() : ctrl.open(fid))}
    />
  )
}

/**
 * Under a format card's text: the card's own button ("הוספת מדיה"), passed
 * through untouched, plus — while that format's copy is open in the AI panel —
 * the note that media already made won't follow the copy change.
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
      {children}
      {isOpen && hasMedia && <CopyMediaNote />}
      <span className="sr-only" aria-live="polite">
        {isOpen ? `עריכת ${COPY_NOUN[fid]} עם AI פתוחה` : ""}
      </span>
    </div>
  )
}
