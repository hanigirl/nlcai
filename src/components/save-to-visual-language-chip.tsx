"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { triageMessage, type MemoryOutcome } from "@/lib/visual-memory"
import type { VisualFormat } from "@/lib/visual-language/types"

/**
 * "לשמור לשפה הוויזואלית שלי" — the chip above the AI-edit input (Notion:
 * [P2] כתוביות: לשמור את הסגנון למותג מתוך העריכה; Hani picked direction A,
 * 2026-10-29).
 *
 * Every message is already checked by the chat's visual memory (lib/visual-
 * memory); this is for an edit she liked that wasn't kept on its own. The tap
 * goes through the same check with `explicit`, so the same rules hold: a
 * colour / font / brand element goes to the settings, a contradiction asks
 * first. The answer shows as a note under the edit (VisualMemoryNote).
 *
 * Looks: the shared Chip (components/ui/chip). No yellow (Hani: "די עם הצהוב הזה").
 */

export type ChipState = "ready" | "saving" | "error"

/** Presentational — every state, for the panel and for /test/save-to-visual-language. */
export function SaveToVisualLanguageChipView({
  state,
  errorMessage,
  onSave,
}: {
  state: ChipState
  errorMessage?: string | null
  onSave: () => void
}) {
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
        {busy ? "בודקים ושומרים..." : "לשמור לשפה הוויזואלית שלי"}
      </Chip>
    </div>
  )
}

/**
 * The live chip for one landed edit. Mount with a `key` per edit so each new
 * edit starts fresh; `onOutcome` hands the answer to the panel, which shows
 * it under the edit and drops the chip.
 */
export function SaveToVisualLanguageChip({
  instruction,
  format,
  onOutcome,
}: {
  instruction: string
  format: VisualFormat
  onOutcome: (memory: MemoryOutcome) => void
}) {
  const [state, setState] = useState<ChipState>("ready")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const save = async () => {
    setState("saving")
    setErrorMessage(null)
    try {
      const result = await triageMessage({ instruction, format, explicit: true })
      onOutcome(result.memory)
    } catch (err) {
      console.error("[save-to-visual-language] save failed", err)
      setErrorMessage(err instanceof Error ? err.message : null)
      setState("error")
    }
  }

  return <SaveToVisualLanguageChipView state={state} errorMessage={errorMessage} onSave={() => void save()} />
}
