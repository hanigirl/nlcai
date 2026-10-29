"use client"

import { useEffect, useState } from "react"
import { Check, Loader2, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * "לשמור לשפה הוויזואלית שלי" — the chip row above the AI-edit input
 * (Notion: [P2] כתוביות: לשמור את הסגנון למותג מתוך העריכה).
 *
 * Today every AI-edit instruction is already read by lib/style-memory, which
 * silently decides whether it's a lasting preference. She never chooses, and
 * only sometimes sees a line about it. This chip makes it intentional: after
 * an edit she likes, one tap makes it how every future video looks.
 *
 * Two review directions, behind ?capstyle=a|b:
 *  A — one tap commits, with undo. The AI distils the rule; she sees it after.
 *  B — tap opens the rule for review: she reads/edits it and picks the scope,
 *      then saves. Nothing binds until she confirms.
 */

export type CapstyleVariant = "a" | "b"

export type ChipState =
  /** No finished edit yet — no chip. */
  | "idle"
  /** An edit landed — the chip is offered. */
  | "ready"
  /** A only: style memory already kept it on its own — shown, with undo. */
  | "auto"
  /** B only: the rule is open for her to read and shape. */
  | "review"
  | "saving"
  | "saved"
  | "error"

export const CHIP_STATES: Record<CapstyleVariant, { id: ChipState; label: string }[]> = {
  a: [
    { id: "idle", label: "לפני עריכה" },
    { id: "ready", label: "צ׳יפ מוכן" },
    { id: "saving", label: "בשמירה" },
    { id: "saved", label: "נשמר" },
    { id: "auto", label: "נשמר אוטומטית" },
    { id: "error", label: "שגיאה" },
  ],
  b: [
    { id: "idle", label: "לפני עריכה" },
    { id: "ready", label: "צ׳יפ מוכן" },
    { id: "review", label: "בדיקת הכלל" },
    { id: "saving", label: "בשמירה" },
    { id: "saved", label: "נשמר" },
    { id: "error", label: "שגיאה" },
  ],
}

export interface LastEdit {
  /** Her instruction, as she typed it. */
  instruction: string
  /** What style memory would keep (Hebrew), when known. */
  summary: string
  /** Format noun for the scope option, e.g. "בי-רול". */
  formatNoun: string
}

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"

export function SaveToVisualLanguageChip({
  variant,
  lastEdit,
  state,
  onStateChange,
  onSave,
  onUndo,
}: {
  variant: CapstyleVariant
  lastEdit: LastEdit | null
  state: ChipState
  onStateChange: (s: ChipState) => void
  /** Persist the rule. Resolves true on success. */
  onSave: (rule: { summary: string; scope: "all" | "format" }) => Promise<boolean>
  onUndo: () => void
}) {
  const [draft, setDraft] = useState(lastEdit?.summary ?? "")
  const [scope, setScope] = useState<"all" | "format">("all")
  useEffect(() => setDraft(lastEdit?.summary ?? ""), [lastEdit?.summary])

  if (state === "idle" || !lastEdit) return null

  const save = async (summary: string) => {
    onStateChange("saving")
    const ok = await onSave({ summary, scope })
    onStateChange(ok ? "saved" : "error")
  }

  const savedLine = (
    <div role="status" className="flex items-start gap-2 rounded-xl bg-bg-surface-primary-default px-3 py-2">
      <Check className="mt-0.5 size-4 shrink-0 text-yellow-30" aria-hidden />
      <div className="flex-1 text-xs-body leading-relaxed text-text-primary-default">
        <span className="font-semibold">
          {state === "auto" ? "שמרתי את זה לשפה הוויזואלית שלכם." : "נשמר לשפה הוויזואלית שלכם."}
        </span>{" "}
        {variant === "b" && scope === "format"
          ? `מעכשיו כל ה${lastEdit.formatNoun} ייצאו ככה: `
          : "מעכשיו כל הסרטונים והפורמטים ייצאו ככה: "}
        <span className="text-text-neutral-default">{variant === "b" ? draft : lastEdit.summary}</span>
      </div>
      <button
        type="button"
        onClick={onUndo}
        aria-label="ביטול השמירה"
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs-body text-text-neutral-default hover:bg-gray-95 hover:text-text-primary-default dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
      >
        <RotateCcw className="size-3" aria-hidden />
        ביטול
      </button>
    </div>
  )

  if (state === "saved" || state === "auto") return <div className="pb-2">{savedLine}</div>

  if (state === "error") {
    return (
      <div className="pb-2">
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-border-neutral-default px-3 py-2">
          <span className="flex-1 text-xs-body text-button-destructive-default">
            לא הצלחנו לשמור לשפה הוויזואלית. העריכה עצמה נשמרה.
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => (variant === "b" ? onStateChange("review") : void save(lastEdit.summary))}
          >
            לנסות שוב
          </Button>
        </div>
      </div>
    )
  }

  // B — the rule, open for review, before anything binds.
  if (variant === "b" && (state === "review" || (state === "saving" && draft))) {
    const busy = state === "saving"
    return (
      <div className="pb-2">
        <div className="space-y-2.5 rounded-xl border border-border-neutral-default bg-bg-surface p-3">
          <div className="flex items-center gap-1.5 text-xs-body font-semibold text-text-primary-default">
            <Sparkles className="size-3.5 text-yellow-50" aria-hidden />
            זה מה שיישמר בשפה הוויזואלית שלכם
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            disabled={busy}
            aria-label="הסגנון שיישמר"
            className="min-h-[56px] resize-none bg-white text-small dark:bg-gray-10"
          />
          <div role="radiogroup" aria-label="על מה זה יחול" className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "כל הפורמטים"],
                ["format", `רק ${lastEdit.formatNoun}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={scope === id}
                disabled={busy}
                onClick={() => setScope(id)}
                className={`${CHIP} ${
                  scope === id
                    ? "border-yellow-50 bg-bg-surface-primary-default text-text-primary-default"
                    : "border-border-neutral-default bg-white text-text-neutral-default hover:bg-gray-95 dark:bg-transparent dark:hover:bg-gray-20"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void save(draft.trim())}>
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {busy ? "שומרים..." : "שמירה"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onStateChange("ready")}>
              ביטול
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // The chip itself — A commits on tap, B opens the review.
  const busy = state === "saving"
  return (
    <div className="flex flex-wrap gap-1.5 pb-2">
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => (variant === "b" ? onStateChange("review") : void save(lastEdit.summary))}
        className={`${CHIP} border-yellow-50 bg-bg-surface-primary-default text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 disabled:opacity-70`}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-yellow-50" aria-hidden />
        ) : (
          <Sparkles className="size-3.5 text-yellow-50" aria-hidden />
        )}
        {busy ? "שומרים לשפה הוויזואלית..." : "לשמור לשפה הוויזואלית שלי"}
      </button>
    </div>
  )
}
