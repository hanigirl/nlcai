/**
 * Client-side fire-and-forget wrapper around POST /api/learning-log.
 *
 * Learning capture must never block or break the flow the user is actually in,
 * so every failure here is swallowed. Callers get a boolean back only so they
 * can avoid double-logging the same pair.
 */

import { isTrivialEdit } from "@/lib/learning-diff"

export type LearningContentType = "hook" | "core_post"
export type LearningSource = "manual_edit" | "chat_instruction"
export type LearningOutcome = "accepted" | "rejected"

interface LogEditInput {
  originalText: string
  editedText: string
  contentType: LearningContentType
  source?: LearningSource
  outcome?: LearningOutcome
  instruction?: string
}

/** Returns false when the pair was too trivial to be worth sending. */
export function logLearningEdit({
  originalText,
  editedText,
  contentType,
  source,
  outcome,
  instruction,
}: LogEditInput): boolean {
  const before = originalText?.trim() ?? ""
  const after = editedText?.trim() ?? ""
  if (!before || !after || before === after) return false
  // Punctuation, whitespace or case only — nothing about voice or structure
  // to learn, and it used to become a binding "preference" in every prompt.
  // A chat accept/reject still carries the user's instruction, so only manual
  // edits are filtered here.
  if (source !== "chat_instruction" && isTrivialEdit(before, after)) return false

  void fetch("/api/learning-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalText,
      editedText,
      contentType,
      source,
      outcome,
      instruction,
    }),
  }).catch(() => {})

  return true
}
