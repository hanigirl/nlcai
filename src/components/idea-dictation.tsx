"use client"

/**
 * IdeaDictation — the home page's "התחלה מרעיון" card, with the mic actually wired.
 * Notion bug 38a4d905 ("לא מצליחה להקליט כאן בעמוד מה ניצור היום").
 *
 * The mic on this card has never had an onClick — the placeholder promised
 * recording and nothing ran. Wiring it means designing the recording experience,
 * so this file ships TWO conceptually different answers, chosen by `variant`:
 *
 *   - "a" — פס הכתבה בשורת הכלים. The mic swaps into a compact recording pill in
 *           the toolbar row it already lives in. The card never changes shape and
 *           the textarea stays editable, so she can talk and fix a typo in the
 *           same breath. Lowest footprint; the recording is an accessory.
 *
 *   - "b" — מצב הקלטה על הכרטיס. The whole card enters a recording mode: a status
 *           strip appears, the textarea becomes a live read-only transcript, and
 *           the submit button becomes the stop button. Impossible to miss that
 *           you're being heard, or how to get out. The recording is the subject.
 *
 * The dimension of variation is WHERE THE RECORDING LIVES: a toolbar affordance
 * that leaves the card alone (A) vs a card-wide mode change that takes it over (B).
 * Both compose transcript by APPENDING to whatever she already typed, and both
 * land in the same `idea` state feeding "תייצר לי הוקים".
 *
 * Everything non-presentational is in `useDictation` — see that file for why this
 * is Web Speech (no server, no cost) rather than record-then-transcribe.
 */

import { AlertCircle, ArrowUp, Info, Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  formatElapsed,
  useDictation,
  type DictationState,
} from "@/lib/use-dictation"

export type IdeaDictationVariant = "a" | "b"

type IdeaDictationProps = {
  variant: IdeaDictationVariant
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /**
   * Review-only: pins the surface to a state so the whole state machine can be
   * inspected without a working mic. Never set in production.
   */
  forcedState?: DictationState | null
}

/** Appends dictated words to typed text without eating either. */
function appendTranscript(existing: string, addition: string): string {
  if (!addition) return existing
  if (!existing.trim()) return addition
  return `${existing.trimEnd()} ${addition}`
}

/**
 * The inline failure surfaces. These replace `workflow-card`'s `alert()` — an
 * alert is not this product's design language, and it can't tell her what to do
 * next. Shared by both variants: a failure shouldn't look like two products.
 */
function DictationNotice({
  state,
  onDismiss,
}: {
  state: Extract<DictationState, "denied" | "unsupported" | "error">
  onDismiss: () => void
}) {
  const copy: Record<typeof state, { icon: typeof AlertCircle; text: string }> = {
    denied: {
      icon: AlertCircle,
      text: "אין לנו הרשאה למיקרופון. אשרו גישה בהגדרות הדפדפן ונסו שוב.",
    },
    unsupported: {
      icon: Info,
      text: "הדפדפן הזה לא תומך בהכתבה קולית. נסו בכרום, או פשוט כתבו את הרעיון.",
    },
    error: {
      icon: AlertCircle,
      text: "ההקלטה נקטעה. בדקו את החיבור ונסו שוב.",
    },
  }
  const { icon: Icon, text } = copy[state]

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-border-neutral-default bg-bg-surface px-3 py-2"
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          state === "unsupported"
            ? "text-text-neutral-default"
            : "text-button-danger-default"
        )}
      />
      <span className="text-xs-body flex-1 text-text-primary-default">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="סגירת ההודעה"
        className="text-xs-body text-text-neutral-default transition-colors hover:text-text-primary-default"
      >
        סגירה
      </button>
    </div>
  )
}

/** The pulsing "we're listening" dot. Shared so both variants read identically. */
function RecordingDot() {
  return (
    <span aria-hidden className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-button-danger-default opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-button-danger-default" />
    </span>
  )
}

/**
 * Review-only state toggle. Visible only under ?mic=a|b. Lets the reviewer jump
 * to any state — including permission-denied and unsupported-browser, which are
 * otherwise almost impossible to stage on demand — without a real mic failure.
 * Not part of the shipped design; deleted when a variant is chosen.
 */
export function MicStateToggle({
  value,
  onChange,
}: {
  value: DictationState | null
  onChange: (state: DictationState | null) => void
}) {
  const options: Array<{ state: DictationState | null; label: string }> = [
    { state: null, label: "חי (מיקרופון אמיתי)" },
    { state: "recording", label: "מקליטים" },
    { state: "denied", label: "אין הרשאה" },
    { state: "unsupported", label: "דפדפן לא נתמך" },
    { state: "error", label: "תקלה" },
  ]

  return (
    <div
      dir="rtl"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-3 py-2"
    >
      <span className="text-xs-body text-text-neutral-default">תצוגת מצב:</span>
      {options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onChange(opt.state)}
          aria-pressed={value === opt.state}
          className={cn(
            "text-xs-body rounded-lg px-2 py-1 transition-colors",
            value === opt.state
              ? "bg-bg-surface-primary-default-80 text-text-primary-default"
              : "text-text-neutral-default hover:bg-bg-surface-hover"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function IdeaDictation({
  variant,
  value,
  onChange,
  onSubmit,
  forcedState = null,
}: IdeaDictationProps) {
  const dictation = useDictation((finalText) =>
    onChange(appendTranscript(value, finalText))
  )

  const state = forcedState ?? dictation.state
  const isRecording = state === "recording"
  const notice =
    state === "denied" || state === "unsupported" || state === "error"
      ? state
      : null
  // Under a forced state there's no live engine, so show sample words rather
  // than an empty transcript that would read as "it isn't hearing me".
  const interim =
    forcedState === "recording" ? "אז מה שרציתי להגיד זה ש" : dictation.interim
  const elapsed = forcedState === "recording" ? 8 : dictation.elapsed

  const micButton = (
    <button
      type="button"
      onClick={dictation.start}
      aria-label="הקלטת רעיון"
      className="p-2 text-text-neutral-default transition-colors hover:text-text-primary-default"
    >
      <Mic className="size-4" />
    </button>
  )

  /* ── Variant A — פס הכתבה בשורת הכלים ─────────────────────────────────────
     The card keeps its exact production shape. Only the mic's own slot changes,
     and she can keep typing while she talks. */
  if (variant === "a") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-border-neutral-default bg-white p-4 dark:bg-gray-10">
        <div className="flex flex-col gap-1">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="כאן כותבים או מקליטים אותו"
            className="min-h-[56px] resize-none border-none bg-transparent px-0 py-0 text-p text-text-primary-default shadow-none placeholder:text-text-neutral-default focus-visible:ring-0"
          />
          {isRecording && (
            /* Live words, muted, right under the text they'll join. This is the
               "it's hearing me" feedback the current card has none of. */
            <p
              aria-live="polite"
              className="text-xs-body min-h-[18px] text-text-neutral-default"
            >
              {interim || "מקשיבים…"}
            </p>
          )}
        </div>

        {notice && <DictationNotice state={notice} onDismiss={dictation.dismiss} />}

        <div className="flex items-center justify-between gap-2">
          {isRecording ? (
            <button
              type="button"
              onClick={dictation.stop}
              aria-label="עצירת ההקלטה"
              className="flex items-center gap-2 rounded-lg border border-border-neutral-default px-3 py-2 transition-colors hover:bg-bg-surface"
            >
              <RecordingDot />
              <span className="text-xs-body tabular-nums text-text-primary-default">
                {formatElapsed(elapsed)}
              </span>
              <span className="text-xs-body text-text-neutral-default">עצרו</span>
            </button>
          ) : (
            micButton
          )}
          <Button onClick={onSubmit} disabled={!value.trim()} className="gap-2">
            תייצר לי הוקים
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

  /* ── Variant B — מצב הקלטה על הכרטיס ──────────────────────────────────────
     The card becomes a recorder: status strip, live read-only transcript, and a
     stop button in the primary slot. You cannot type mid-recording — the trade
     is that you cannot possibly misread what's happening either. */
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10">
      {isRecording && (
        <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-2">
          <RecordingDot />
          <span className="text-xs-body text-text-primary-default">מקליטים…</span>
          <span className="text-xs-body tabular-nums text-text-neutral-default">
            {formatElapsed(elapsed)}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        {isRecording ? (
          /* Committed words in full colour, live words muted behind them — the
             transcript builds in front of her instead of appearing at the end. */
          <p
            aria-live="polite"
            className="text-p min-h-[56px] text-text-primary-default"
          >
            {value}
            {value && interim ? " " : ""}
            <span className="text-text-neutral-default">{interim}</span>
            {!value && !interim && (
              <span className="text-text-neutral-default">
                מדברים — מה שתגידו יופיע כאן.
              </span>
            )}
          </p>
        ) : (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="כאן כותבים או מקליטים אותו"
            className="min-h-[56px] resize-none border-none bg-transparent px-0 py-0 text-p text-text-primary-default shadow-none placeholder:text-text-neutral-default focus-visible:ring-0"
          />
        )}

        {notice && <DictationNotice state={notice} onDismiss={dictation.dismiss} />}

        <div className="flex items-center justify-between gap-2">
          {isRecording ? (
            <>
              <span className="text-xs-body text-text-neutral-default">
                אפשר לערוך אחרי שעוצרים
              </span>
              <Button
                onClick={dictation.stop}
                aria-label="עצירת ההקלטה"
                className="gap-2"
              >
                <Square className="size-3 fill-current" />
                סיימתי להקליט
              </Button>
            </>
          ) : (
            <>
              {micButton}
              <Button onClick={onSubmit} disabled={!value.trim()} className="gap-2">
                תייצר לי הוקים
                <ArrowUp className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
