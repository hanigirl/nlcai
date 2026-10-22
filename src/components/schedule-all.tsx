"use client"

/**
 * "תזמון הכל" on /calendar (Hani picked direction A, 2026-10-15): the
 * button lays the ready posts onto the board by the weekly routine as dashed
 * cards; nothing is scheduled until "תזמון כל הפוסטים" in the bar.
 */

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Loader2,
  Settings2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FormatStatusChip } from "@/components/format-status-chip"
import type { PlanInputCard, PlannedSlot } from "@/lib/schedule-all"

// --- helpers ----------------------------------------------------------------

export function shortDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map((n) => parseInt(n, 10))
  return new Date(y, m - 1, d).toLocaleDateString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  })
}

/** Group a plan by core post, preserving the order the posts first appear. */
export function groupByCorePost<T extends { corePostId: string; hook: string }>(
  rows: T[],
): { corePostId: string; hook: string; rows: T[] }[] {
  const groups = new Map<string, { corePostId: string; hook: string; rows: T[] }>()
  for (const r of rows) {
    const g = groups.get(r.corePostId) ?? { corePostId: r.corePostId, hook: r.hook, rows: [] }
    g.rows.push(r)
    groups.set(r.corePostId, g)
  }
  return [...groups.values()]
}

/**
 * Small numbered dot that ties every format card back to its core post —
 * the "one post became a pile" cue on the grid. Neutral tokens only, so it
 * never competes with the yellow "today" / selection language.
 */
export function CorePostMarker({ index }: { index: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-gray-10 text-[10px] font-semibold leading-none text-white dark:bg-gray-90 dark:text-gray-10 tabular-nums"
    >
      {index}
    </span>
  )
}

// --- the button ---------------------------------------------------------------

export function ScheduleAllButton({
  count,
  busy = false,
  onClick,
  size = "sm",
  className,
  hideCount = false,
  label = "תזמנו הכל",
}: {
  count: number
  /** A only places the posts on the board; the real commit is in the bar. */
  label?: string
  busy?: boolean
  /** The rail header already shows the count in a badge. */
  hideCount?: boolean
  onClick: () => void
  size?: "sm" | "default"
  className?: string
}) {
  const disabled = count === 0 || busy
  const button = (
    <Button
      size={size}
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={className}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <CalendarClock className="size-4" />
      )}
      {busy ? "מתזמנים..." : label}
      {!busy && !hideCount && count > 0 && (
        <span className="tabular-nums rounded-full bg-white/20 px-1.5 text-xs leading-5">
          {count}
        </span>
      )}
    </Button>
  )
  if (count > 0) return button
  // Disabled buttons swallow pointer events — wrap so the tooltip still opens.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>אין פוסטים מוכנים לתזמון</TooltipContent>
    </Tooltip>
  )
}

// --- no settings yet ---------------------------------------------------------

/**
 * The button never guesses a schedule. With no days set, it explains why it
 * can't act and hands off to the settings panel (the sibling task) — the
 * user comes back with rules and the same button just works.
 */
export function NoSettingsDialog({
  open,
  onOpenChange,
  onOpenSettings,
  count,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  count: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md text-right">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>קודם קובעים מתי לפרסם</DialogTitle>
          <DialogDescription>
            יש {count} פורמטים מוכנים שמחכים לתזמון. כדי לפזר אותם ביומן צריך
            לבחור באילו ימים מפרסמים, באיזו שעה, ואיזה פורמט עולה בכל יום. זה
            נקבע פעם אחת ונשמר להבא.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button size="sm" onClick={onOpenSettings}>
            <Settings2 className="size-4" />
            להגדרות התזמון
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            אחר כך
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- unmatched warning (both variants) ----------------------------------------

export function UnmatchedNote({ cards }: { cards: PlanInputCard[] }) {
  if (cards.length === 0) return null
  const formats = [...new Set(cards.map((c) => c.format))]
  return (
    <p className="flex items-start gap-1.5 text-xs-body text-text-primary-default">
      <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-yellow-30" aria-hidden />
      <span>
        {cards.length === 1 ? "פורמט אחד נשאר" : `${cards.length} פורמטים נשארו`} ברשימה
        בצד, כי אין בהגדרות התזמון יום ל{formats.length === 1 ? "פורמט" : "פורמטים"}:{" "}
        <span className="inline-flex gap-1 align-middle">
          {formats.map((f) => (
            <FormatStatusChip key={f} format={f} state="ready" size="xs" />
          ))}
        </span>
      </span>
    </p>
  )
}

// --- A: preview bar ----------------------------------------------------------

/**
 * Sits between the week navigation and the grid while the ghosts are on the
 * board. The commit decision lives here, next to what it commits — not in a
 * modal that hides the calendar it's describing.
 */
export function PreviewBar({
  unmatched,
  error,
  laterCount,
  onConfirm,
  onCancel,
  onOpenSettings,
}: {
  plan: PlannedSlot[]
  unmatched: PlanInputCard[]
  error: boolean
  /** Ghosts that fall outside the visible week. */
  laterCount: number
  onConfirm: () => void
  onCancel: () => void
  onOpenSettings: () => void
}) {
  const link =
    "text-button-primary-default underline underline-offset-2 hover:text-text-primary-default"

  return (
    <div
      role="region"
      aria-label="תצוגה מקדימה של התזמון"
      className={`mb-3 flex flex-col gap-2 rounded-xl border px-4 py-3 ${
        error
          ? "border-red-80 bg-red-95 dark:bg-gray-10"
          : "border-border-neutral-default bg-bg-surface dark:bg-gray-10"
      }`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px] flex flex-col gap-0.5">
          {error ? (
            <>
              <p className="text-small-bold text-button-destructive-default">
                התזמון לא נשמר
              </p>
              <p className="text-xs-body text-text-primary-default">
                שום פוסט לא תוזמן, והפריסה עדיין כאן. אפשר לנסות שוב.
              </p>
            </>
          ) : (
            <>
              <p className="text-small-bold text-text-primary-default">
                סידרנו את הפוסטים שלך על גבי היומן
              </p>
              <p className="text-xs-body text-text-neutral-default">
                הפוסטים סודרו לפי{" "}
                <button type="button" onClick={onOpenSettings} className={link}>
                  הגדרות התזמון
                </button>{" "}
                השבוע
                {laterCount > 0 && ` ועוד ${laterCount} בשבועות הבאים`}
                {". "}
                אפשר לגרור את הפוסטים למקום אחר.
              </p>
            </>
          )}
        </div>

        <Button size="sm" onClick={onConfirm}>
          {error ? "ניסיון חוזר" : "תזמון כל הפוסטים"}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          ביטול
        </Button>
      </div>
      {unmatched.length > 0 && <UnmatchedNote cards={unmatched} />}
    </div>
  )
}

// --- B: what just got scheduled -----------------------------------------------

/**
 * The "one post became a pile" moment, made literal: each core post is drawn
 * as a small stack, and the stack fans out into the dated formats it became.
 */
export function ScheduledSummary({
  placed,
  unmatched,
  onUndo,
  onDismiss,
}: {
  placed: PlannedSlot[]
  unmatched: PlanInputCard[]
  onUndo: () => void
  onDismiss: () => void
}) {
  const groups = groupByCorePost(placed)
  return (
    <div
      role="status"
      className="mb-3 flex flex-col gap-3 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 text-small-bold text-text-primary-default">
          תוזמנו {placed.length} פורמטים מ-{groups.length} פוסטי ליבה
        </p>
        <Button variant="outline" size="sm" onClick={onUndo}>
          ביטול התזמון
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label="סגירת הסיכום"
        >
          <X className="size-4" />
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {groups.map((g, i) => (
          <li key={g.corePostId} className="flex items-center gap-3 min-w-0">
            {/* The pile */}
            <div className="relative h-9 w-8 shrink-0" aria-hidden>
              <span className="absolute inset-0 translate-x-1 -translate-y-1 rounded-md border border-border-neutral-default bg-gray-95" />
              <span className="absolute inset-0 translate-x-0.5 -translate-y-0.5 rounded-md border border-border-neutral-default bg-gray-98" />
              <span className="absolute inset-0 flex items-center justify-center rounded-md border border-border-neutral-default bg-white dark:bg-gray-10">
                <CorePostMarker index={i + 1} />
              </span>
            </div>
            <p className="w-56 shrink-0 truncate text-xs-body text-text-primary-default" title={g.hook}>
              {g.hook}
            </p>
            <ArrowLeft className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
            {/* The spread */}
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {g.rows.map((r) => (
                <span
                  key={`${r.corePostId}:${r.format}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border-neutral-default bg-bg-surface ps-1 pe-2 py-0.5"
                >
                  <FormatStatusChip format={r.format} state="ready" size="xs" type="icon" />
                  <span className="text-xs-body text-text-primary-default tabular-nums">
                    {shortDayLabel(r.scheduledDate)} · {r.scheduledTime}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <UnmatchedNote cards={unmatched} />
    </div>
  )
}

// --- B: failure ------------------------------------------------------------------

export function ScheduleErrorStrip({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center gap-3 rounded-xl border border-red-80 bg-red-95 dark:bg-gray-10 px-4 py-3"
    >
      <AlertTriangle className="size-4 shrink-0 text-button-destructive-default" aria-hidden />
      <div className="flex-1">
        <p className="text-small-bold text-button-destructive-default">התזמון לא הושלם</p>
        <p className="text-xs-body text-text-primary-default">
          שום פוסט לא תוזמן, הכל נשאר ברשימה בצד. זה בדרך כלל עובר בניסיון נוסף.
        </p>
      </div>
      <Button size="sm" onClick={onRetry}>
        ניסיון חוזר
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="סגירת ההודעה">
        <X className="size-4" />
      </Button>
    </div>
  )
}
