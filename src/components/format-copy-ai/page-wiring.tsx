"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { FormatCopyChat } from "./format-copy-chat"
import { useFormatCopyAi, type FormatCopyAiController } from "./use-format-copy-ai"
import { useFormatEditLearning } from "./use-format-edit-learning"

/**
 * Everything project/page.tsx needs for "עריכה עם AI" on the format copy,
 * behind one call so the page edit stays a few lines: the controller the
 * cards use, the docked panel, and the writing-style learning (only from
 * the "לשמור לפעמים הבאות" chip on an AI edit).
 */
export function useFormatCopyAiOnPage({
  formatPosts,
  setFormatPosts,
  hook,
  scope,
}: {
  formatPosts: Record<string, string>
  setFormatPosts: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  hook?: string
  /** The post the conversations belong to — one per post + format. */
  scope: string
}): { copyAi: FormatCopyAiController; overlay: ReactNode } {
  const postsRef = useRef(formatPosts)
  useEffect(() => {
    postsRef.current = formatPosts
  })
  const learning = useFormatEditLearning()

  const copyAi = useFormatCopyAi({
    getText: (fid) => postsRef.current[fid] ?? "",
    setText: (fid, text) => {
      setFormatPosts((prev) => ({ ...prev, [fid]: text }))
    },
    hook,
    onVerdict: learning.logVerdict,
    scope,
  })

  return {
    copyAi,
    // Keyed by format; each format's conversation and half-typed text come back on reopen.
    overlay: <FormatCopyChat key={copyAi.activeFid ?? "closed"} ctrl={copyAi} />,
  }
}
