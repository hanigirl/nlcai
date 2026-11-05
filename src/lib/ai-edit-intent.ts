"use client"

import { useEffect, useRef } from "react"
import type { AiEditFormat } from "@/components/media-ai-chat"
import type { MediaGenResult } from "@/lib/media-brief"

/**
 * "לא אהבתי" → the AI-edit panel (Hani, 2026-10-29).
 *
 * The 👎 row lives inside each result card; the AI-edit panel is mounted once,
 * by the project page. This is the wire between them: the card asks for the
 * panel to open on the "what didn't you like?" question, the page opens it.
 * A window event keeps it free of prop threading through four card components.
 */
export type AiEditOpening = AiEditDislikeOpening | AiEditGenerateOpening

/**
 * "Think first, then generate" (Hani, 2026-11-05): the media panel's generate
 * button no longer fires straight away — it opens this panel, which asks
 * whether to generate from her visual language or from a direction she
 * writes for this piece, then runs the generation and stays open for edits.
 */
export interface AiEditGenerateOpening {
  id: string
  kind: "generate"
  /** The style picked in the media panel, as she'd say it ("השפה הוויזואלית שלכם", "כהה"). */
  styleName: string
  /** The picked style is her own visual language (not a niche tone / template). */
  isVisualLanguage: boolean
  /** Starts the generation with her brief (undefined = from the style alone). */
  run: (brief?: string) => Promise<MediaGenResult>
}

export interface AiEditDislikeOpening {
  id: string
  kind: "dislike"
  /**
   * Her first answer in the panel — teaches the style through
   * /api/visual-language/style-feedback (the one path that learns from it;
   * the edit itself is sent with learn: false).
   */
  onFeedback: (reasons: string[], note: string) => void
}

export interface AiEditRequest {
  postId: string
  format: AiEditFormat
  opening: AiEditOpening
}

const EVENT = "nlc:ai-edit-request"

export function requestAiEdit(req: AiEditRequest) {
  window.dispatchEvent(new CustomEvent<AiEditRequest>(EVENT, { detail: req }))
}

export function useAiEditRequests(handler: (req: AiEditRequest) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<AiEditRequest>).detail)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
}

export const openingId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

/** Her chips + free text as one instruction for the AI edit. */
export function dislikeInstruction(reasonLabels: string[], note: string): string {
  const parts: string[] = []
  if (reasonLabels.length) parts.push(`לא אהבתי: ${reasonLabels.join(", ")}.`)
  if (note.trim()) parts.push(note.trim())
  return parts.join(" ")
}
