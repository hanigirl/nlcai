"use client"

import { useEffect, useRef } from "react"
import type { AiEditFormat } from "@/components/media-ai-chat"
import type { MediaGenResult } from "@/lib/media-brief"

/**
 * "חדש לגמרי" (Hani, 2026-11-05): with that tile picked, the media panel's
 * generate button doesn't fire straight away — it opens the AI-edit panel,
 * which asks how to start, generates from her answer from a blank page (no
 * visual language), and stays open for edits. Every other tile generates
 * immediately, as before.
 *
 * The AI-edit panel is mounted once, by the project page. This is the wire
 * between the media panel and it: a window event keeps it free of prop
 * threading through the card components.
 */
export type AiEditOpening = AiEditGenerateOpening

export interface AiEditGenerateOpening {
  id: string
  kind: "generate"
  /** Starts the from-zero generation with her brief and the references she attached. */
  run: (brief: string, references: string[]) => Promise<MediaGenResult>
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
