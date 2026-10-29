"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { FormatCopyChat } from "./format-copy-chat"
import { useFormatCopyAi, type FormatCopyAiController } from "./use-format-copy-ai"
import { useFormatEditLearning } from "./use-format-edit-learning"

/**
 * Everything project/page.tsx needs for "עריכה עם AI" on the format copy,
 * behind one call so the page edit stays a few lines: the controller the
 * cards use, the docked panel, and the writing-style learning for both
 * manual and AI edits of a format's text.
 */
export function useFormatCopyAiOnPage({
  formatPosts,
  setFormatPosts,
  hook,
  generatingPlaceholder,
}: {
  formatPosts: Record<string, string>
  setFormatPosts: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  hook?: string
  /** The text a format wears while its agent is still writing. */
  generatingPlaceholder: string
}): { copyAi: FormatCopyAiController; overlay: ReactNode } {
  const postsRef = useRef(formatPosts)
  useEffect(() => {
    postsRef.current = formatPosts
  })
  const learning = useFormatEditLearning(formatPosts, generatingPlaceholder)

  const copyAi = useFormatCopyAi({
    getText: (fid) => postsRef.current[fid] ?? "",
    setText: (fid, text) => {
      learning.markAiText(fid, text)
      setFormatPosts((prev) => ({ ...prev, [fid]: text }))
    },
    hook,
    onVerdict: learning.logVerdict,
  })

  return {
    copyAi,
    // Keyed by format: switching cards starts a clean composer.
    overlay: <FormatCopyChat key={copyAi.activeFid ?? "closed"} ctrl={copyAi} />,
  }
}
