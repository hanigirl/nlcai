"use client"

import { useEffect, useRef } from "react"
import type { AiEditFormat } from "@/components/media-ai-chat"
import type { MediaGenResult } from "@/lib/media-brief"

/**
 * "Think first, then generate" (Hani, 2026-11-05): the media panel's generate
 * button no longer fires straight away — it opens the AI-edit panel, which
 * asks whether to generate from her visual language or from a direction she
 * writes for this piece, then runs the generation and stays open for edits.
 *
 * The AI-edit panel is mounted once, by the project page. This is the wire
 * between the media panel and it: a window event keeps it free of prop
 * threading through the card components.
 */
export type AiEditOpening = AiEditGenerateOpening

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
