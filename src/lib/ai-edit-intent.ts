"use client"

import { useEffect, useRef } from "react"
import type { AiEditFormat } from "@/components/media-ai-chat"

/**
 * "לא אהבתי" → the AI-edit panel (Hani, 2026-10-29).
 *
 * The 👎 row lives inside each result card; the AI-edit panel is mounted once,
 * by the project page. This is the wire between them: the card asks for the
 * panel to open on the "what didn't you like?" question, the page opens it.
 * A window event keeps it free of prop threading through four card components.
 */
export interface AiEditOpening {
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
