"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { COPY_FORMATS } from "@/lib/format-copy-refine"
import { FormatCopyChat } from "./format-copy-chat"
import { useApplyCopyAiReviewState, useFormatCopyAi, type FormatCopyAiController } from "./use-format-copy-ai"
import {
  CopyEditStateToggle,
  REVIEW_CORE_POST,
  REVIEW_FOCUS_FORMAT,
  REVIEW_FORMAT_POSTS,
  REVIEW_HOOK,
  REVIEW_INSTRUCTION,
  useCopyEditReview,
  useReviewResponder,
  type CopyEditReview,
} from "./review"

/**
 * Everything project/page.tsx needs for the copy AI edit, behind one call so
 * the page edit stays a few lines. With no ?copyedit param this returns
 * nothing and the page is unchanged.
 */
export function useFormatCopyAiOnPage({
  formatPosts,
  setFormatPosts,
  setCorePost,
  setDuplicatedFormats,
  focusOn,
}: {
  formatPosts: Record<string, string>
  setFormatPosts: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  setCorePost: (text: string) => void
  setDuplicatedFormats: (ids: string[]) => void
  focusOn: (el: HTMLElement) => void
}): { review: CopyEditReview | null; copyAi: FormatCopyAiController | undefined; overlay: ReactNode } {
  const review = useCopyEditReview()
  const responder = useReviewResponder(review?.state ?? null)
  const postsRef = useRef(formatPosts)
  postsRef.current = formatPosts

  const ctrl = useFormatCopyAi({
    variant: review?.variant ?? "a",
    getText: (fid) => postsRef.current[fid] ?? "",
    setText: (fid, text) => setFormatPosts((prev) => ({ ...prev, [fid]: text })),
    hook: REVIEW_HOOK,
    // Review harness: always the local responder — never the paid route.
    responder,
  })

  // Seed the sample post once: core post + all five formats with copy.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (!review || seeded) return
    setCorePost(REVIEW_CORE_POST)
    setDuplicatedFormats([...COPY_FORMATS])
    setFormatPosts(() => ({ ...REVIEW_FORMAT_POSTS }))
    setSeeded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review])

  useApplyCopyAiReviewState(ctrl, review?.state ?? null, REVIEW_FOCUS_FORMAT, REVIEW_INSTRUCTION, seeded)

  // Glide the canvas to the carousel card so the link lands on it.
  const focusedRef = useRef(false)
  useEffect(() => {
    if (!seeded || focusedRef.current) return
    const t = window.setTimeout(() => {
      focusedRef.current = true
      // Center the whole card (header to buttons), not just the button.
      const entry = document.querySelector<HTMLElement>(`[data-copy-entry="${REVIEW_FOCUS_FORMAT}"]`)
      const card = entry?.closest<HTMLElement>("[data-copy-card]") ?? entry
      if (card) focusOn(card)
    }, 400)
    return () => window.clearTimeout(t)
  }, [seeded, focusOn])

  if (!review) return { review: null, copyAi: undefined, overlay: null }
  return {
    review,
    copyAi: ctrl,
    overlay: (
      <>
        {/* Keyed by format: switching cards starts a clean composer. */}
        <FormatCopyChat key={ctrl.activeFid ?? "closed"} ctrl={ctrl} />
        <CopyEditStateToggle review={review} />
      </>
    ),
  }
}
