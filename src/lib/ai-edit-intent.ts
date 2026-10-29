"use client"

import { useEffect, useRef } from "react"
import type { AiEditFormat } from "@/components/media-ai-chat"

/**
 * "לא אהבתי" → the AI-edit panel, without typing twice (Hani, 2026-10-29).
 *
 * The 👎 row lives inside each result card; the AI-edit panel is mounted once,
 * by the project page. This is the wire between them: the card asks for the
 * panel to open in a given way, the page opens it. A window event keeps it
 * free of prop threading through four card components.
 */
export type AiEditOpening =
  /** Option A: she already wrote what's wrong on the card — run it now. */
  | { id: string; kind: "autorun"; text: string; source: "dislike" | "review-b" }
  /** Option B: 👎 lands her in the panel, which asks what to change. */
  | { id: string; kind: "dislike"; onFeedback: (reasons: string[], note: string) => void }

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
