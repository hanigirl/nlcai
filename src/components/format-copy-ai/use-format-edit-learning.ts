"use client"

import { useCallback } from "react"
import { logLearningEdit } from "@/lib/learning-capture"
import type { CopyFormat } from "@/lib/format-copy-refine"
import type { CopyAiMessage } from "./use-format-copy-ai"

/**
 * Format copy edits feed the writing-style memory ONLY when she taps
 * "לשמור לפעמים הבאות" on an AI edit (Hani, 2026-10-29: "ואם זה היה רק
 * תיקון נקודתי הוא לא יקליק על הצ׳יפ הזה"). Nothing is learned on its own:
 * not keep / undo, and not her own typing over the text.
 *
 * Same path the core post uses — logLearningEdit → /api/learning-log →
 * learning_logs — and the same content type, "core_post". That is the memory
 * every generator reads (the core post AND each format route call
 * fetchLearningInsights(…, "core_post")), so a lesson learned on a carousel
 * shapes the next core post too. It is also the only type the table's check
 * constraint accepts besides "hook" (migration 008), so no migration.
 */
export function useFormatEditLearning() {
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

  return { logVerdict }
}
