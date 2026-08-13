"use client"

import { useState } from "react"
import {
  GeminiConnectNoticeCard,
  GeminiNoticeChip,
} from "@/components/gemini-connect-notice"
import { GeminiNoticeReviewToggle } from "@/components/gemini-notice-review-toggle"

/**
 * Dev-only mirror of the /project wiring, so the two dismiss directions can be
 * looked at without an account that is in the pilot cohort and missing a key.
 * Same state machine as the real page — nothing here is a second
 * implementation of the behaviour, only of the page chrome around it.
 */
export function FloatingNoticePreview({
  close,
  state,
}: {
  close?: string
  /** `?state=closed` boots straight into the dismissed state for screenshots. */
  state?: string
}) {
  const variant: "a" | "b" | null = close === "a" || close === "b" ? close : null
  const [dismissed, setDismissed] = useState(state === "closed")

  return (
    <>
      {variant === null ? (
        <GeminiConnectNoticeCard variant="floating" />
      ) : dismissed ? (
        variant === "b" ? (
          <GeminiNoticeChip onExpand={() => setDismissed(false)} />
        ) : null
      ) : (
        <GeminiConnectNoticeCard
          variant="floating"
          onDismiss={() => setDismissed(true)}
        />
      )}

      {variant && (
        <GeminiNoticeReviewToggle
          variant={variant}
          dismissed={dismissed}
          onChange={setDismissed}
        />
      )}
    </>
  )
}
