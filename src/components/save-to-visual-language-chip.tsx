"use client"

import { useState } from "react"
import { Check, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"

/**
 * "לשמור לשפה הוויזואלית שלי" — the chip above the AI-edit input (Notion:
 * [P2] כתוביות: לשמור את הסגנון למותג מתוך העריכה; Hani picked direction A,
 * 2026-10-29).
 *
 * Every AI-edit instruction is already read by lib/style-memory, which decides
 * on its own whether it's a lasting preference. This makes it intentional and
 * visible: after an edit she likes, one tap keeps it for every format, and she
 * sees what was kept with an undo. When style memory already kept it on its
 * own, the same "saved" line shows instead of the chip.
 *
 * Looks: the shared Chip (components/ui/chip) and a green success line.
 * No yellow (Hani: "די עם הצהוב הזה").
 */

export type ChipState = "ready" | "saving" | "saved" | "auto" | "error"


/** Presentational — every state, for the panel and for /test/save-to-visual-language. */
export function SaveToVisualLanguageChipView({
  state,
  summary,
  errorMessage,
  onSave,
  onUndo,
}: {
  state: ChipState
  /** What was kept (Hebrew), for the saved / auto line. */
  summary?: string | null
  errorMessage?: string | null
  onSave: () => void
  onUndo: () => void
}) {
  if (state === "saved" || state === "auto") {
    return (
      <div
        role="status"
        className="mb-2 flex items-start gap-2 rounded-xl border border-green-success-50 bg-green-success-97 px-3 py-2 dark:bg-green-success-50/15"
      >
        <Check className="mt-0.5 size-4 shrink-0 text-green-success-50 dark:text-green-80" aria-hidden />
        <p className="flex-1 text-xs-body leading-relaxed text-green-success-50 dark:text-green-80">
          <span className="font-semibold">
            {state === "auto" ? "שמרתי את זה לשפה הוויזואלית שלכם." : "נשמר לשפה הוויזואלית שלכם."}
          </span>{" "}
          מעכשיו זה יחול בכל הפורמטים{summary ? `: ${summary}` : "."}
        </p>
        <button
          type="button"
          onClick={onUndo}
          aria-label="ביטול השמירה"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs-body text-text-neutral-default hover:bg-gray-95 hover:text-text-primary-default dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70"
        >
          <RotateCcw className="size-3" aria-hidden />
          ביטול
        </button>
      </div>
    )
  }

  if (state === "error") {
    return (
      <div role="alert" className="mb-2 flex items-center gap-2 rounded-xl border border-border-neutral-default px-3 py-2">
        <span className="flex-1 text-xs-body text-button-destructive-default">
          {errorMessage || "לא הצלחנו לשמור לשפה הוויזואלית. העריכה עצמה נשמרה."}
        </span>
        <Button size="xs" variant="outline" onClick={onSave}>
          לנסות שוב
        </Button>
      </div>
    )
  }

  const busy = state === "saving"
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      <Chip disabled={busy} aria-busy={busy} onClick={onSave}>
        {busy && <Loader2 className="size-3.5 animate-spin text-text-neutral-default" aria-hidden />}
        {busy ? "שומרים לשפה הוויזואלית..." : "לשמור לשפה הוויזואלית שלי"}
      </Chip>
    </div>
  )
}

/**
 * The live chip for one landed edit. Mount with a `key` per edit so each new
 * edit starts fresh. `remembered` = what style memory already kept on its own.
 */
export function SaveToVisualLanguageChip({
  instruction,
  format,
  remembered,
}: {
  instruction: string
  format: string
  remembered: string | null
}) {
  const [state, setState] = useState<ChipState>(remembered ? "auto" : "ready")
  const [summary, setSummary] = useState<string | null>(remembered)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const save = async () => {
    setState("saving")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/visual-language/style-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, format }),
      })
      const data = (await res.json().catch(() => ({}))) as { summary?: string; message?: string }
      if (!res.ok || !data.summary) {
        setErrorMessage(data.message ?? null)
        setState("error")
        return
      }
      setSummary(data.summary)
      setState("saved")
    } catch {
      setState("error")
    }
  }

  const undo = async () => {
    const kept = summary
    setState("ready")
    setSummary(null)
    if (!kept) return
    await fetch("/api/visual-language/style-memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: kept }),
    }).catch(() => undefined)
  }

  return (
    <SaveToVisualLanguageChipView
      state={state}
      summary={summary}
      errorMessage={errorMessage}
      onSave={() => void save()}
      onUndo={() => void undo()}
    />
  )
}
