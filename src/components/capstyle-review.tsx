"use client"

import { useState } from "react"
import { MediaAiChat, type ChatMessage } from "@/components/media-ai-chat"
import {
  CHIP_STATES,
  SaveToVisualLanguageChip,
  type CapstyleVariant,
  type ChipState,
} from "@/components/save-to-visual-language-chip"

/**
 * REVIEW HARNESS ONLY — /project?capstyle=a|b[&state=…].
 *
 * Opens the b-roll "עריכה עם AI" panel straight on a seeded conversation where
 * an edit to the captions has just landed, so the chip above the input is
 * visible in one click. Nothing here calls a route: the panel answers locally
 * (preview mode), "saving" is a timer, no credits are spent, nothing is
 * written. Delete this file when a variant is picked.
 */

const INSTRUCTION = "הכתוביות יותר גדולות, בצהוב של המותג, ושכל מילה תקפוץ פנימה בנפרד"
const SUMMARY = "כתוביות גדולות בצהוב של המותג, כל מילה נכנסת בקפיצה בנפרד"

const INTRO: ChatMessage = {
  role: "assistant",
  content:
    "מה לשנות בבי-רול? למשל גודל הכותרת, צבעים, איך המילים נכנסות או התזמון. אעדכן את האנימציה והסרטון יתחלף בכרטיס.",
}

const EDITED: ChatMessage[] = [
  INTRO,
  { role: "user", content: INSTRUCTION },
  { role: "assistant", content: "עדכנתי את הבי-רול. הסרטון החדש מופיע בכרטיס.", done: true },
]

export function CapstyleReview({ variant: initialVariant, state: initialState }: { variant: CapstyleVariant; state: string | null }) {
  const [variant, setVariant] = useState<CapstyleVariant>(initialVariant)
  const valid = CHIP_STATES[variant].some((s) => s.id === initialState)
  const [state, setState] = useState<ChipState>(valid ? (initialState as ChipState) : "ready")
  // Remount the panel when the seeded conversation should change.
  const seedKey = `${variant}:${state === "idle" ? "idle" : "edited"}`

  const go = (v: CapstyleVariant, s: ChipState) => {
    setVariant(v)
    setState(s)
    const url = new URL(window.location.href)
    url.searchParams.set("capstyle", v)
    url.searchParams.set("state", s)
    window.history.replaceState(null, "", url)
  }

  return (
    <>
      {/* Review-only state toggle */}
      <div
        dir="rtl"
        className="fixed top-3 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-xl border border-border-neutral-default bg-white px-2 py-1.5 shadow-md dark:bg-gray-10"
      >
        <span className="px-1 text-xs-body text-text-neutral-default">תצוגת סקירה</span>
        {(["a", "b"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => go(v, "ready")}
            aria-pressed={variant === v}
            className={`rounded-md px-2 py-1 text-xs-body ${
              variant === v ? "bg-button-primary-default text-white dark:text-gray-10" : "text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            אופציה {v.toUpperCase()}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border-neutral-default" aria-hidden />
        {CHIP_STATES[variant].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(variant, s.id)}
            aria-pressed={state === s.id}
            className={`rounded-md px-2 py-1 text-xs-body ${
              state === s.id ? "bg-bg-surface-primary-default text-text-primary-default" : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <MediaAiChat
        key={seedKey}
        postId="capstyle-preview"
        format="b_roll"
        open
        onOpenChange={() => undefined}
        preview={{ messages: state === "idle" ? [INTRO] : EDITED }}
        aboveInput={(last) => (
          <SaveToVisualLanguageChip
            variant={variant}
            lastEdit={last ? { instruction: last.instruction, summary: SUMMARY, formatNoun: "בי-רולים" } : null}
            state={state === "idle" ? "ready" : state}
            onStateChange={setState}
            onSave={() => new Promise((r) => setTimeout(() => r(true), 1200))}
            onUndo={() => setState("ready")}
          />
        )}
      />
    </>
  )
}
