"use client"

import { useCallback, useEffect, useRef } from "react"
import { logLearningEdit } from "@/lib/learning-capture"
import type { CopyFormat } from "@/lib/format-copy-refine"
import type { CopyAiMessage } from "./use-format-copy-ai"

/**
 * Format copy edits feed the writing-style memory (Hani, 2026-10-29:
 * "עריכה של פורמט תתווסף לזיכרון של סגנון הכתיבה").
 *
 * Same path the core post uses — logLearningEdit → /api/learning-log →
 * learning_logs — and the same content type, "core_post". That is the memory
 * every generator reads (the core post AND each format route call
 * fetchLearningInsights(…, "core_post")), so a lesson learned on a carousel
 * shapes the next core post too. It is also the only type the table's check
 * constraint accepts besides "hook" (migration 008), so no migration.
 *
 * Two signals, as on the core post:
 *   - manual edits: the text she typed over the AI's version, captured once
 *     she stops typing (one insight per AI version);
 *   - AI-chat verdicts: keep / undo on a revision, with her instruction.
 */

const IDLE_MS = 4000

export function useFormatEditLearning(formatPosts: Record<string, string>, generatingPlaceholder: string) {
  // The last AI-authored (or loaded) text per format — what a manual edit is
  // measured against. Reset while the format is regenerating, so the fresh
  // AI text becomes the new baseline instead of reading as her edit.
  const baselineRef = useRef<Record<string, string>>({})
  // Baseline already logged per format, so one AI version yields one insight.
  const loggedRef = useRef<Record<string, string>>({})
  const postsRef = useRef(formatPosts)
  useEffect(() => {
    postsRef.current = formatPosts
  })

  const flushManual = useCallback((fid: string) => {
    const baseline = baselineRef.current[fid]
    const current = postsRef.current[fid]
    if (!baseline || !current || current === generatingPlaceholder) return
    if (current.trim() === baseline.trim() || loggedRef.current[fid] === baseline) return
    const logged = logLearningEdit({
      originalText: baseline,
      editedText: current,
      contentType: "core_post",
      source: "manual_edit",
    })
    if (logged) loggedRef.current[fid] = baseline
  }, [generatingPlaceholder])

  useEffect(() => {
    for (const [fid, text] of Object.entries(formatPosts)) {
      if (text === generatingPlaceholder) {
        delete baselineRef.current[fid]
      } else if (!baselineRef.current[fid] && text.trim()) {
        baselineRef.current[fid] = text
      }
    }
    const timer = window.setTimeout(() => {
      Object.keys(postsRef.current).forEach(flushManual)
    }, IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [formatPosts, generatingPlaceholder, flushManual])

  /**
   * The AI is about to write `text` into the card (a revision, or the undo
   * restoring the previous one). Log any manual edit still pending first,
   * then treat the AI text as the new baseline — it isn't hers.
   */
  const markAiText = useCallback(
    (fid: CopyFormat, text: string) => {
      flushManual(fid)
      baselineRef.current[fid] = text
    },
    [flushManual],
  )

  const logVerdict = useCallback(
    (_fid: CopyFormat, msg: CopyAiMessage, instruction: string, outcome: "accepted" | "rejected") => {
      if (!msg.revised || msg.revertTo === undefined) return
      logLearningEdit({
        originalText: msg.revertTo,
        editedText: msg.revised,
        contentType: "core_post",
        source: "chat_instruction",
        outcome,
        instruction: instruction || undefined,
      })
    },
    [],
  )

  return { markAiText, logVerdict }
}
