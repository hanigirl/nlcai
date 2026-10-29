"use client"

/**
 * "סידור אוטומטי ← תזמון כל הפוסטים" as ONE control that never leaves the
 * queue panel (task 4084d905, 2026-10-29). Two directions, review-gated by
 * `/calendar?variant=a|b` (see the harness at the bottom of this file):
 *
 *   A — the header button IS the progress. Its label is always the next
 *       real action ("סידור אוטומטי בלוח" → "תזמון 7 פוסטים" → "כל 7
 *       הפוסטים תוזמנו"), with a quiet strip under it: step, what is saved,
 *       and cancel / settings / re-arrange.
 *   B — a tray pinned to the bottom of the panel, like a checkout: a
 *       two-segment stepper, the sentence of what happens next, one wide
 *       primary, and the results (per-day summary, failures) inside it.
 *
 * Both read the same `FlowView` and fire the same `FlowActions`, so the
 * difference between them is placement and hierarchy only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  Check,
  Loader2,
  PanelLeftOpen,
  RotateCcw,
  Settings2,
  Undo2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FormatStatusChip } from "@/components/format-status-chip"
import {
  ScheduleAllButton,
  UnmatchedNote,
  shortDayLabel,
} from "@/components/schedule-all"
import { planScheduleAll, type PlanInputCard, type PlannedSlot } from "@/lib/schedule-all"
import { cloneSchedule, defaultPostingSchedule, type PostingSchedule } from "@/lib/posting-schedule"
import { isSlotTooSoon } from "@/lib/social/slot-time"
import type { FormatId } from "@/lib/timing-storage"
import type { PanelItem } from "@/components/queue-panel"

// --- the model both variants render -----------------------------------------

export type FailedSlot = {
  corePostId: string
  format: FormatId
  hook: string
  /** Why it didn't go in, in words. */
  reason: string
  /** Where the draft was moved to instead ("יום ג׳ 3.11 · 12:00"), or null if nowhere fits. */
  movedTo: string | null
}

export type FlowView = {
  /** Approved formats in the rail that aren't scheduled yet. */
  readyCount: number
  hasRoutine: boolean
  /** Drafts on the board, not yet scheduled. */
  planned: PlannedSlot[]
  unmatched: PlanInputCard[]
  /** Drafts that fall outside the week on screen. */
  laterCount: number
  /** Drafts the user dragged to another day. */
  movedCount: number
  askRearrange: boolean
  /** The routine was saved while drafts sat on the board. */
  routineChanged: boolean
  phase: "plan" | "scheduling" | "partial" | "error" | "done"
  progress: { done: number; total: number }
  /** The batch that just went in (done / partial). */
  lastBatch: PlannedSlot[]
  failed: FailedSlot[]
}

export type FlowActions = {
  arrange: () => void
  confirm: () => void
  cancel: () => void
  openSettings: () => void
  requestRearrange: () => void
  confirmRearrange: () => void
  dismissRearrange: () => void
  keepAfterRoutineChange: () => void
  undo: () => void
  dismissDone: () => void
  /** From "done": lay the posts that are still in the rail onto the board. */
  arrangeMore: () => void
  showLater: () => void
}

type Stage =
  | "empty"
  | "no-routine"
  | "arrange"
  | "review"
  | "scheduling"
  | "partial"
  | "error"
  | "done"

function stageOf(v: FlowView): Stage {
  if (v.phase === "scheduling") return "scheduling"
  if (v.phase === "error") return "error"
  if (v.phase === "partial") return "partial"
  if (v.phase === "done") return "done"
  if (v.planned.length > 0) return "review"
  if (v.readyCount === 0) return "empty"
  if (!v.hasRoutine) return "no-routine"
  return "arrange"
}

/** Step 1 = arranging on the board, step 2 = scheduling what's there. */
function stepOf(stage: Stage): 1 | 2 {
  return stage === "empty" || stage === "no-routine" || stage === "arrange" ? 1 : 2
}

const posts = (n: number) => (n === 1 ? "פוסט אחד" : `${n} פוסטים`)

/** The primary label — always the next real action, never the last one. */
function primaryLabel(v: FlowView, stage: Stage): string {
  switch (stage) {
    case "review":
      return v.planned.length === 1 ? "תזמון פוסט אחד" : `תזמון ${v.planned.length} פוסטים`
    case "partial":
      return v.planned.length === 1 ? "תזמון הפוסט הנותר" : `תזמון ${v.planned.length} הנותרים`
    case "error":
      return "ניסיון חוזר"
    case "scheduling":
      return `מתזמנים ${v.progress.done} מתוך ${v.progress.total}...`
    case "no-routine":
      return "קביעת ימים ושעות"
    default:
      return "סידור אוטומטי בלוח"
  }
}

function doneLabel(n: number): string {
  return n === 1 ? "הפוסט תוזמן" : `כל ${n} הפוסטים תוזמנו`
}

/** One plain sentence: what is saved, and what the next click does. */
function statusLine(v: FlowView, stage: Stage): string {
  switch (stage) {
    case "empty":
      return "כשיהיו פוסטים מאושרים, נסדר אותם בלוח לפי הלו״ז הקבוע."
    case "no-routine":
      return `יש ${posts(v.readyCount)} מוכנים. כדי לסדר אותם קובעים פעם אחת באילו ימים ושעות מפרסמים.`
    case "arrange":
      return `נניח ${v.readyCount === 1 ? "את הפוסט" : `את ${v.readyCount} הפוסטים`} בלוח כטיוטה, לפי הלו״ז הקבוע. עוד לא מתזמנים כלום.`
    case "review": {
      const moved = v.movedCount > 0 ? ` · ${v.movedCount === 1 ? "הזזה ידנית אחת" : `${v.movedCount} הזזות ידניות`}` : ""
      return `טיוטה, עדיין לא נשמר${moved}. אפשר לגרור פוסטים ביומן.`
    }
    case "scheduling":
      return "שומרים ושולחים לאינסטגרם. זה לוקח כמה שניות."
    case "partial":
      return `${posts(v.lastBatch.length)} תוזמנו, ${v.failed.length === 1 ? "אחד לא נכנס" : `${v.failed.length} לא נכנסו`}. העברנו ${v.failed.length === 1 ? "אותו" : "אותם"} למשבצת הפנויה הבאה.`
    case "error":
      return "התזמון לא נשמר. שום פוסט לא תוזמן, והטיוטה עדיין על הלוח."
    case "done":
      return v.readyCount > 0
        ? `ביומן ובתור לאינסטגרם. נשארו ${posts(v.readyCount)} לסידור.`
        : "ביומן ובתור לאינסטגרם. אפשר לבטל עד שהראשון עולה."
  }
}

// --- shared pieces -------------------------------------------------------------

const linkButton =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs-body text-text-neutral-default hover:bg-gray-95 hover:text-text-primary-default dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 disabled:opacity-50"

function ProgressTrack({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label="התקדמות התזמון"
      className="h-1 w-full overflow-hidden rounded-full bg-gray-90 dark:bg-gray-30"
    >
      <div
        className="h-full rounded-full bg-button-primary-default transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Inline confirm before a re-arrange throws manual drags away. */
function RearrangeConfirm({ moved, actions }: { moved: number; actions: FlowActions }) {
  return (
    <div role="alertdialog" aria-label="סידור מחדש" className="flex flex-col gap-2 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 p-3">
      <p className="text-xs-body text-text-primary-default">
        <span className="text-small-bold">לסדר מחדש?</span>{" "}
        {moved === 1 ? "ההזזה הידנית שעשיתם תתבטל" : `${moved} ההזזות הידניות שעשיתם יתבטלו`}, והפוסטים
        יחזרו למקומות לפי הלו״ז.
      </p>
      <div className="flex items-center gap-2">
        <Button size="xs" onClick={actions.confirmRearrange}>
          סידור מחדש
        </Button>
        <Button size="xs" variant="outline" onClick={actions.dismissRearrange}>
          השארת ההזזות
        </Button>
      </div>
    </div>
  )
}

/** The routine changed under a draft that was laid out by the old one. */
function RoutineChangedNote({ actions }: { actions: FlowActions }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 p-3">
      <p className="text-xs-body text-text-primary-default">
        <span className="text-small-bold">הלו״ז עודכן.</span> הטיוטה על הלוח עדיין מסודרת לפי
        הלו״ז הקודם.
      </p>
      <div className="flex items-center gap-2">
        <Button size="xs" onClick={actions.confirmRearrange}>
          סידור לפי הלו״ז החדש
        </Button>
        <Button size="xs" variant="outline" onClick={actions.keepAfterRoutineChange}>
          להשאיר כך
        </Button>
      </div>
    </div>
  )
}

/** What didn't go in, why, and where it went instead. */
function FailedList({ failed }: { failed: FailedSlot[] }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="פוסטים שלא תוזמנו">
      {failed.map((f) => (
        <li
          key={`${f.corePostId}:${f.format}`}
          className="flex items-start gap-2 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 px-2.5 py-2"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-yellow-30" aria-hidden />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <FormatStatusChip format={f.format} state="ready" size="xs" type="icon" />
              <p className="truncate text-xs-body text-text-primary-default" title={f.hook}>
                {f.hook}
              </p>
            </div>
            <p className="text-xs-body text-text-neutral-default">
              {f.reason}
              {f.movedTo ? ` · הועבר ל${f.movedTo}` : " · אין משבצת פנויה, נשאר ברשימה"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Per-day recap of what just went in. */
function BatchSummary({ batch }: { batch: PlannedSlot[] }) {
  const sorted = [...batch].sort((a, b) =>
    `${a.scheduledDate} ${a.scheduledTime}`.localeCompare(`${b.scheduledDate} ${b.scheduledTime}`),
  )
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="מה תוזמן">
      {sorted.map((r) => (
        <li
          key={`${r.corePostId}:${r.format}`}
          className="inline-flex items-center gap-1 rounded-full border border-border-neutral-default bg-white dark:bg-gray-10 ps-1 pe-2 py-0.5"
        >
          <FormatStatusChip format={r.format} state="ready" size="xs" type="icon" />
          <span className="text-xs-body text-text-primary-default tabular-nums">
            {shortDayLabel(r.scheduledDate)} · {r.scheduledTime}
          </span>
        </li>
      ))}
    </ul>
  )
}

function DoneChip({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      role="status"
      className={`inline-flex h-[34px] items-center gap-1.5 rounded-[8px] bg-bg-surface-success-default px-3 text-[14px] leading-[1.3] text-text-success-default ${className}`}
    >
      <Check className="size-4" aria-hidden />
      {doneLabel(n)}
    </span>
  )
}

// --- A: the header button + its strip ----------------------------------------

export function FlowHeaderButton({ view, actions }: { view: FlowView; actions: FlowActions }) {
  const stage = stageOf(view)
  if (stage === "empty" || stage === "arrange") {
    return (
      <ScheduleAllButton
        label="סידור אוטומטי בלוח"
        count={view.readyCount}
        onClick={actions.arrange}
      />
    )
  }
  if (stage === "done") return <DoneChip n={view.lastBatch.length} />
  const icon =
    stage === "scheduling" ? (
      <Loader2 className="size-4 animate-spin" aria-hidden />
    ) : stage === "error" ? (
      <RotateCcw className="size-4" aria-hidden />
    ) : stage === "no-routine" ? (
      <Settings2 className="size-4" aria-hidden />
    ) : (
      <CalendarCheck className="size-4" aria-hidden />
    )
  const onClick = stage === "no-routine" ? actions.openSettings : actions.confirm
  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={stage === "scheduling"}
      aria-busy={stage === "scheduling" || undefined}
      className="tabular-nums"
    >
      {icon}
      {primaryLabel(view, stage)}
    </Button>
  )
}

export function FlowHeaderDetail({ view, actions }: { view: FlowView; actions: FlowActions }) {
  const stage = stageOf(view)
  const step = stepOf(stage)
  const busy = stage === "scheduling"
  return (
    <div className="px-4 pb-3 border-b border-border-neutral-default flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-xs-body text-text-neutral-default">
          {stage === "done" ? (
            "הסתיים"
          ) : (
            <>
              <span className="tabular-nums">שלב {step} מתוך 2</span> ·{" "}
              {step === 1 ? "סידור בלוח" : "תזמון"}
            </>
          )}
        </p>
        <p className={`text-xs-body ${stage === "error" ? "text-button-destructive-default" : "text-text-primary-default"}`}>
          {statusLine(view, stage)}
          {stage === "review" && view.laterCount > 0 && (
            <>
              {" "}
              <button type="button" onClick={actions.showLater} className="underline underline-offset-2 hover:text-text-neutral-default">
                {view.laterCount === 1 ? "אחד בשבוע הבא" : `${view.laterCount} בשבועות הבאים`}
              </button>
            </>
          )}
        </p>
      </div>

      {busy && <ProgressTrack done={view.progress.done} total={view.progress.total} />}
      {stage === "review" && view.askRearrange && <RearrangeConfirm moved={view.movedCount} actions={actions} />}
      {stage === "review" && view.routineChanged && !view.askRearrange && <RoutineChangedNote actions={actions} />}
      {stage === "partial" && <FailedList failed={view.failed} />}
      {(stage === "review" || stage === "error") && <UnmatchedNote cards={view.unmatched} />}

      {/* Secondary actions — small, always the same row, always in reach. */}
      <div className="flex items-center gap-1 flex-wrap -ms-1.5">
        {(stage === "review" || stage === "error" || stage === "partial") && (
          <button type="button" className={linkButton} onClick={actions.cancel}>
            <X className="size-3.5" aria-hidden />
            {stage === "partial" ? "השארת הנותרים ברשימה" : "ביטול הסידור"}
          </button>
        )}
        {stage === "review" && (
          <button type="button" className={linkButton} onClick={actions.requestRearrange}>
            <RotateCcw className="size-3.5" aria-hidden />
            סידור מחדש
          </button>
        )}
        {stage === "done" && (
          <>
            <button type="button" className={linkButton} onClick={actions.undo}>
              <Undo2 className="size-3.5" aria-hidden />
              ביטול התזמון
            </button>
            <button
              type="button"
              className={linkButton}
              onClick={view.readyCount > 0 ? actions.arrangeMore : actions.dismissDone}
            >
              {view.readyCount > 0 ? "סידור הפוסטים הנותרים" : "סגירה"}
            </button>
          </>
        )}
        {stage !== "done" && stage !== "no-routine" && (
          <button type="button" className={linkButton} onClick={actions.openSettings} disabled={busy}>
            <Settings2 className="size-3.5" aria-hidden />
            הגדרות תזמון
          </button>
        )}
      </div>
    </div>
  )
}

// --- B: the tray pinned to the bottom of the panel -----------------------------

function StepSegment({
  n,
  label,
  state,
}: {
  n: 1 | 2
  label: string
  state: "done" | "current" | "next"
}) {
  return (
    <li className="flex-1 flex flex-col gap-1.5" aria-current={state === "current" ? "step" : undefined}>
      <span
        className={`h-1 rounded-full ${
          state === "next" ? "bg-gray-90 dark:bg-gray-30" : "bg-button-primary-default"
        }`}
        aria-hidden
      />
      <span
        className={`flex items-center gap-1.5 text-xs-body ${
          state === "current" ? "text-text-primary-default font-semibold" : "text-text-neutral-default"
        }`}
      >
        <span
          className={`inline-flex size-4 items-center justify-center rounded-full text-[10px] leading-none tabular-nums ${
            state === "next"
              ? "border border-border-neutral-default"
              : "bg-gray-10 text-white dark:bg-gray-90 dark:text-gray-10"
          }`}
          aria-hidden
        >
          {state === "done" ? <Check className="size-2.5" /> : n}
        </span>
        {label}
        <span className="sr-only">
          {state === "done" ? " — הושלם" : state === "current" ? " — השלב הנוכחי" : " — השלב הבא"}
        </span>
      </span>
    </li>
  )
}

export function FlowTray({ view, actions }: { view: FlowView; actions: FlowActions }) {
  const stage = stageOf(view)
  const step = stepOf(stage)
  const busy = stage === "scheduling"
  const allDone = stage === "done"

  const headline = (() => {
    switch (stage) {
      case "empty":
        return "אין עדיין מה לסדר"
      case "no-routine":
        return "קודם קובעים מתי לפרסם"
      case "arrange":
        return "סידור הפוסטים בלוח"
      case "review":
        return "מרוצים מהסידור? אפשר לתזמן"
      case "scheduling":
        return "מתזמנים..."
      case "partial":
        return "כמעט הכל נכנס"
      case "error":
        return "התזמון לא נשמר"
      case "done":
        return doneLabel(view.lastBatch.length)
    }
  })()

  return (
    <section
      aria-label="סידור ותזמון"
      className="shrink-0 border-t border-border-neutral-default bg-bg-surface dark:bg-gray-10 px-4 pt-3 pb-4 flex flex-col gap-3 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.12)]"
    >
      <ol className="flex items-start gap-2" aria-label={allDone ? "שני השלבים הושלמו" : `שלב ${step} מתוך 2`}>
        <StepSegment n={1} label="סידור בלוח" state={step === 1 && !allDone ? "current" : "done"} />
        <StepSegment n={2} label="תזמון" state={allDone ? "done" : step === 2 ? "current" : "next"} />
      </ol>

      <div className="flex flex-col gap-0.5">
        <p className={`text-small-bold ${stage === "error" ? "text-button-destructive-default" : "text-text-primary-default"}`}>
          {headline}
        </p>
        <p className="text-xs-body text-text-neutral-default">
          {statusLine(view, stage)}
          {stage === "review" && view.laterCount > 0 && (
            <>
              {" "}
              <button type="button" onClick={actions.showLater} className="underline underline-offset-2 text-text-primary-default hover:text-text-neutral-default">
                {view.laterCount === 1 ? "אחד בשבוע הבא" : `${view.laterCount} בשבועות הבאים`}
              </button>
            </>
          )}
        </p>
      </div>

      {busy && <ProgressTrack done={view.progress.done} total={view.progress.total} />}
      {stage === "review" && view.askRearrange && <RearrangeConfirm moved={view.movedCount} actions={actions} />}
      {stage === "review" && view.routineChanged && !view.askRearrange && <RoutineChangedNote actions={actions} />}
      {stage === "partial" && (
        <>
          <BatchSummary batch={view.lastBatch} />
          <FailedList failed={view.failed} />
        </>
      )}
      {stage === "done" && <BatchSummary batch={view.lastBatch} />}
      {(stage === "review" || stage === "error") && <UnmatchedNote cards={view.unmatched} />}

      {/* The one primary — wide, same spot in every step. */}
      {stage === "done" ? (
        view.readyCount > 0 ? (
          <Button className="w-full" onClick={actions.arrangeMore}>
            <CalendarClock className="size-4" aria-hidden />
            סידור {view.readyCount === 1 ? "הפוסט הנותר" : `${view.readyCount} הפוסטים הנותרים`}
          </Button>
        ) : (
          <DoneChip n={view.lastBatch.length} className="h-[44px] w-full justify-center rounded-[12px] text-[16px]" />
        )
      ) : stage === "empty" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="block rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50">
              <Button className="w-full" disabled>
                <CalendarClock className="size-4" aria-hidden />
                סידור אוטומטי בלוח
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>אין פוסטים מוכנים לתזמון</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          className="w-full tabular-nums"
          onClick={
            stage === "arrange"
              ? actions.arrange
              : stage === "no-routine"
                ? actions.openSettings
                : actions.confirm
          }
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : stage === "arrange" ? (
            <CalendarClock className="size-4" aria-hidden />
          ) : stage === "no-routine" ? (
            <Settings2 className="size-4" aria-hidden />
          ) : stage === "error" ? (
            <RotateCcw className="size-4" aria-hidden />
          ) : (
            <CalendarCheck className="size-4" aria-hidden />
          )}
          {primaryLabel(view, stage)}
        </Button>
      )}

      <div className="flex items-center gap-2">
        {(stage === "review" || stage === "error" || stage === "partial") && (
          <Button variant="outline" size="sm" onClick={actions.cancel}>
            {stage === "partial" ? "השארה ברשימה" : "ביטול הסידור"}
          </Button>
        )}
        {stage === "review" && (
          <Button variant="outline" size="sm" onClick={actions.requestRearrange}>
            <RotateCcw className="size-3.5" aria-hidden />
            סידור מחדש
          </Button>
        )}
        {stage === "done" && (
          <Button variant="outline" size="sm" onClick={actions.undo}>
            <Undo2 className="size-3.5" aria-hidden />
            ביטול התזמון
          </Button>
        )}
        {stage === "done" && view.readyCount === 0 && (
          <Button variant="ghost" size="sm" onClick={actions.dismissDone}>
            סגירה
          </Button>
        )}
        {stage !== "done" && stage !== "no-routine" && (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
            onClick={actions.openSettings}
            disabled={busy}
          >
            <Settings2 className="size-3.5" aria-hidden />
            הגדרות תזמון
          </Button>
        )}
      </div>
    </section>
  )
}

// --- both: while the routine editor has the panel collapsed --------------------

/**
 * The routine editor needs the panel's width for its 7 columns, so the panel
 * slides away. The reopen button carries the step with it, so the progress
 * never disappears from the screen.
 */
export function FlowCollapsedPill({ view, onReopen }: { view: FlowView; onReopen: () => void }) {
  const stage = stageOf(view)
  const step = stepOf(stage)
  const text =
    stage === "review"
      ? `שלב 2 מתוך 2 · ${view.planned.length === 1 ? "טיוטה אחת" : `${view.planned.length} טיוטות`} על הלוח`
      : `שלב ${step} מתוך 2 · ${posts(view.readyCount)} לסידור`
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onReopen}
      aria-label={`פתיחת פאנל הפוסטים לתזמון — ${text}`}
      className="fixed top-20 end-3 z-40 bg-white dark:bg-gray-10 shadow-sm tabular-nums"
    >
      <PanelLeftOpen className="size-4" aria-hidden />
      {text}
    </Button>
  )
}

/** Under the routine editor's bar: the draft is waiting, nothing is lost. */
export function FlowRoutineEditNote({ view }: { view: FlowView }) {
  if (view.planned.length === 0 && view.hasRoutine) return null
  return (
    <p role="status" className="-mt-2 mb-4 text-xs-body text-text-neutral-default">
      {view.planned.length > 0
        ? `${view.planned.length === 1 ? "הטיוטה מחכה" : `${view.planned.length} הטיוטות מחכות`} על הלוח. אחרי השמירה נציע לסדר אותן מחדש לפי הלו״ז החדש.`
        : `אחרי השמירה נסדר את ${posts(view.readyCount)} בלוח לפי הלו״ז.`}
    </p>
  )
}

// --- review harness (`/calendar?variant=a|b&state=…`) -------------------------
// Everything below runs on seeded posts in component state. It never calls
// schedulePost, never saves the routine, never fetches: a review link costs
// nothing and writes nothing.

export const FLOW_STATES = [
  "idle",
  "empty",
  "no-routine",
  "arranged",
  "moved",
  "rearrange",
  "settings",
  "routine-changed",
  "scheduling",
  "partial",
  "error",
  "done",
] as const
export type FlowState = (typeof FLOW_STATES)[number]

export const FLOW_STATE_LABELS: Record<FlowState, string> = {
  idle: "שלב 1 · לפני סידור",
  empty: "אין פוסטים",
  "no-routine": "אין לו״ז",
  arranged: "שלב 2 · טיוטה על הלוח",
  moved: "אחרי גרירה ידנית",
  rearrange: "אזהרת סידור מחדש",
  settings: "הגדרות פתוחות",
  "routine-changed": "אחרי שינוי לו״ז",
  scheduling: "בזמן תזמון",
  partial: "חלק לא נכנס",
  error: "שגיאה",
  done: "הכל תוזמן + ביטול",
}

export function parseFlowState(raw: string | null): FlowState {
  return (FLOW_STATES as readonly string[]).includes(raw ?? "") ? (raw as FlowState) : "idle"
}

const SEED: { id: string; hook: string; formats: FormatId[]; media?: string }[] = [
  { id: "seed-flow-1", hook: "3 טעויות שעושות יועצות בפוסט הראשון שלהן", formats: ["talking_head", "carousel"], media: "/images/carousel-templates/ai-light.png" },
  { id: "seed-flow-2", hook: "למה הלקוחות שלכן לא קוראים עד הסוף", formats: ["story", "carousel"], media: "/images/carousel-templates/soft.png" },
  { id: "seed-flow-3", hook: "מה ששאלתי את עצמי לפני שהעליתי מחיר", formats: ["talking_head", "story"] },
  { id: "seed-flow-4", hook: "הדבר היחיד שאני כותבת לפני כל פגישת מכירה", formats: ["talking_head"] },
]

export const FLOW_SEED_POSTS: PanelItem[] = SEED.map((s) => ({
  corePostId: s.id,
  title: null,
  hookText: s.hook,
  format: s.formats[0],
  formats: s.formats,
  formatsWithMedia: s.formats,
  hasBody: true,
  formatMedia: s.media
    ? Object.fromEntries(s.formats.filter((f) => f === "carousel").map((f) => [f, s.media!]))
    : {},
}))

const SEED_CARD_COUNT = SEED.reduce((n, s) => n + s.formats.length, 0)

const keyOf = (s: { corePostId: string; format: FormatId }) => `${s.corePostId}:${s.format}`

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function useScheduleFlowHarness({
  enabled,
  initialState,
  railCards,
  weekRange,
  onJumpTo,
  openSettings,
}: {
  enabled: boolean
  initialState: FlowState
  /** What the (seeded) rail offers right now — the same input production plans from. */
  railCards: PlanInputCard[]
  weekRange: { start: string; end: string }
  onJumpTo: (dateKey: string) => void
  openSettings: () => void
}) {
  const [routine, setRoutine] = useState<PostingSchedule>(() => defaultPostingSchedule())
  const [routineDraft, setRoutineDraft] = useState<PostingSchedule>(() => cloneSchedule(routine))
  const [hasRoutine, setHasRoutine] = useState(true)
  const [planned, setPlanned] = useState<PlannedSlot[]>([])
  const [unmatched, setUnmatched] = useState<PlanInputCard[]>([])
  const [moved, setMoved] = useState<Set<string>>(new Set())
  const [askRearrange, setAskRearrange] = useState(false)
  const [routineChanged, setRoutineChanged] = useState(false)
  const [phase, setPhase] = useState<FlowView["phase"]>("plan")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [committed, setCommitted] = useState<PlannedSlot[]>([])
  const [lastBatch, setLastBatch] = useState<PlannedSlot[]>([])
  const [failed, setFailed] = useState<FailedSlot[]>([])
  const [seedEmpty, setSeedEmpty] = useState(false)
  const [pendingState, setPendingState] = useState<FlowState | null>(enabled ? initialState : null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => stopTimer, [])

  const plan = useCallback(
    (cards: PlanInputCard[], r: PostingSchedule, occupied: PlannedSlot[]) =>
      planScheduleAll(cards, r, occupied.map((c) => ({ ...c }))),
    [],
  )

  const jumpToFirst = (slots: PlannedSlot[]) => {
    const first = [...slots].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0]
    if (first) onJumpTo(first.scheduledDate)
  }

  /** Lay the rail onto the board. Pure state — nothing is saved. */
  const arrangeWith = (r: PostingSchedule, cards = railCards, occupied = committed) => {
    const p = plan(cards, r, occupied)
    if (p.placed.length === 0) {
      toast("לפורמטים שנשארו אין משבצת פנויה בלו״ז")
      return null
    }
    setPlanned(p.placed)
    setUnmatched(p.unmatched)
    setMoved(new Set())
    setAskRearrange(false)
    setRoutineChanged(false)
    setFailed([])
    setPhase("plan")
    jumpToFirst(p.placed)
    return p.placed
  }

  /** Where a failed draft can go instead: the next open slot for its format. */
  const relocate = (slots: PlannedSlot[], occupied: PlannedSlot[]) => {
    const p = plan(slots, routine, occupied)
    return slots.map((s) => {
      const to = p.placed.find((x) => keyOf(x) === keyOf(s))
      return { from: s, to: to ?? null }
    })
  }

  const finishCommit = (
    batch: PlannedSlot[],
    forceFail: Set<string>,
    occupiedBefore: PlannedSlot[],
  ) => {
    const fails = batch.filter(
      (s) => forceFail.has(keyOf(s)) || isSlotTooSoon(s.scheduledDate, s.scheduledTime),
    )
    const ok = batch.filter((s) => !fails.includes(s))
    const nextCommitted = [...occupiedBefore, ...ok]
    setCommitted(nextCommitted)
    setLastBatch(ok)
    if (fails.length === 0) {
      setPlanned([])
      setFailed([])
      setPhase("done")
      return
    }
    const moves = relocate(fails, nextCommitted)
    setPlanned(moves.flatMap((m) => (m.to ? [m.to] : [])))
    setFailed(
      moves.map((m) => ({
        corePostId: m.from.corePostId,
        format: m.from.format,
        hook: m.from.hook,
        reason: `השעה ${m.from.scheduledTime} ${
          m.from.scheduledDate === todayKey() ? "היום" : `ב${shortDayLabel(m.from.scheduledDate)}`
        } כבר עברה או קרובה מדי`,
        movedTo: m.to ? `${shortDayLabel(m.to.scheduledDate)} · ${m.to.scheduledTime}` : null,
      })),
    )
    setPhase("partial")
  }

  /** Simulated commit: ticks a progress count, then lands. No writes. */
  const runCommit = (batch: PlannedSlot[]) => {
    stopTimer()
    const occupiedBefore = committed
    setFailed([])
    setPhase("scheduling")
    setProgress({ done: 0, total: batch.length })
    let n = 0
    timer.current = setInterval(() => {
      n += 1
      setProgress({ done: n, total: batch.length })
      if (n >= batch.length) {
        stopTimer()
        finishCommit(batch, new Set(), occupiedBefore)
      }
    }, 260)
  }

  // Land a review link straight on its state, once the seeded rail is in.
  useEffect(() => {
    if (!pendingState) return
    const s = pendingState
    if (s === "empty") {
      setSeedEmpty(true)
      setPendingState(null)
      return
    }
    // Wait until the rail re-emits the full, fresh seed (after a reset the
    // previous run's leftovers can still be in flight).
    if (railCards.length < SEED_CARD_COUNT) return
    setPendingState(null)
    if (s === "idle") return
    if (s === "no-routine") {
      setHasRoutine(false)
      return
    }
    const placed = arrangeWith(routine)
    if (!placed) return
    if (s === "moved" || s === "rearrange") {
      // Two drafts dragged one day later, like a real edit.
      const shift = placed.slice(0, 2).map((p) => {
        const [y, m, d] = p.scheduledDate.split("-").map(Number)
        const next = new Date(y, m - 1, d + 1)
        const k = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`
        return { ...p, scheduledDate: k }
      })
      setPlanned([...shift, ...placed.slice(2)])
      setMoved(new Set(shift.map(keyOf)))
      if (s === "rearrange") setAskRearrange(true)
    } else if (s === "settings") {
      openSettings()
    } else if (s === "routine-changed") {
      setRoutineChanged(true)
    } else if (s === "scheduling") {
      setPhase("scheduling")
      setProgress({ done: Math.min(3, placed.length - 1), total: placed.length })
    } else if (s === "error") {
      setPhase("error")
    } else if (s === "partial") {
      // Two drafts dragged onto today, where their hour has already gone —
      // the real way a draft fails (drag keeps the time, moves the day).
      const dragged = placed.slice(-2).map((p) => ({ ...p, scheduledDate: todayKey(), scheduledTime: "07:00" }))
      finishCommit([...placed.slice(0, -2), ...dragged], new Set(dragged.map(keyOf)), [])
    } else if (s === "done") {
      finishCommit(placed, new Set(), [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingState, railCards])

  const laterCount = planned.filter(
    (p) => p.scheduledDate < weekRange.start || p.scheduledDate > weekRange.end,
  ).length

  const view: FlowView = {
    readyCount: railCards.length,
    hasRoutine,
    planned,
    unmatched,
    laterCount,
    movedCount: moved.size,
    askRearrange,
    routineChanged,
    phase,
    progress,
    lastBatch,
    failed,
  }

  const actions: FlowActions = {
    arrange: () => {
      if (!hasRoutine) return openSettings()
      arrangeWith(routine)
    },
    confirm: () => {
      if (planned.length === 0) return
      runCommit(planned)
    },
    cancel: () => {
      stopTimer()
      setPlanned([])
      setUnmatched([])
      setMoved(new Set())
      setAskRearrange(false)
      setRoutineChanged(false)
      setFailed([])
      // In "partial", the part that did go in stays scheduled.
      setPhase(phase === "partial" && lastBatch.length > 0 ? "done" : "plan")
    },
    openSettings,
    requestRearrange: () => {
      if (moved.size > 0) setAskRearrange(true)
      else arrangeWith(routine)
    },
    confirmRearrange: () => arrangeWith(routine),
    dismissRearrange: () => setAskRearrange(false),
    keepAfterRoutineChange: () => setRoutineChanged(false),
    undo: () => {
      const back = new Set(lastBatch.map(keyOf))
      setCommitted((c) => c.filter((x) => !back.has(keyOf(x))))
      setPlanned((p) => [...lastBatch, ...p])
      setLastBatch([])
      setFailed([])
      setPhase("plan")
      toast("התזמון בוטל. הפוסטים חזרו ללוח כטיוטה.")
    },
    dismissDone: () => {
      setLastBatch([])
      setFailed([])
      setPhase("plan")
    },
    arrangeMore: () => {
      setLastBatch([])
      arrangeWith(routine)
    },
    showLater: () => {
      const later = planned
        .filter((p) => p.scheduledDate > weekRange.end)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0]
      if (later) onJumpTo(later.scheduledDate)
    },
  }

  /** A draft dragged to another day (time kept), exactly like production. */
  const movePlanned = (corePostId: string, format: FormatId, dayKey: string) => {
    setPlanned((list) =>
      list.map((x) =>
        x.corePostId === corePostId && x.format === format ? { ...x, scheduledDate: dayKey } : x,
      ),
    )
    setMoved((m) => new Set(m).add(`${corePostId}:${format}`))
  }

  /** The routine editor's save, kept in memory. */
  const saveRoutine = () => {
    const next = cloneSchedule(routineDraft)
    setRoutine(next)
    if (!hasRoutine) {
      setHasRoutine(true)
      arrangeWith(next)
      return
    }
    if (planned.length > 0) setRoutineChanged(true)
  }
  const discardRoutine = () => setRoutineDraft(cloneSchedule(routine))

  const seed = useMemo(
    () => ({
      posts: seedEmpty ? [] : FLOW_SEED_POSTS,
      loading: false,
      error: null,
      excludeCardIds: new Set(committed.map(keyOf)),
    }),
    [seedEmpty, committed],
  )

  /** Reset to a state from the review toggle without reloading the page. */
  const reset = (s: FlowState) => {
    stopTimer()
    setRoutine(defaultPostingSchedule())
    setRoutineDraft(defaultPostingSchedule())
    setHasRoutine(true)
    setPlanned([])
    setUnmatched([])
    setMoved(new Set())
    setAskRearrange(false)
    setRoutineChanged(false)
    setPhase("plan")
    setProgress({ done: 0, total: 0 })
    setCommitted([])
    setLastBatch([])
    setFailed([])
    setSeedEmpty(false)
    setPendingState(s)
  }

  return {
    view,
    actions,
    routine,
    routineDraft,
    setRoutineDraft,
    routineDirty: JSON.stringify(routineDraft) !== JSON.stringify(routine),
    saveRoutine,
    discardRoutine,
    committed,
    movePlanned,
    seed,
    reset,
  }
}

/** Review-only bar: which direction, which state. Not part of either design. */
export function FlowReviewBar({
  variant,
  state,
  onChange,
}: {
  variant: "a" | "b"
  state: FlowState
  onChange: (variant: "a" | "b", state: FlowState) => void
}) {
  return (
    <div
      role="region"
      aria-label="תצוגת סקירה"
      className="mb-4 flex flex-col gap-2 rounded-xl border border-dashed border-gray-70 bg-bg-surface px-3 py-2"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs-body text-text-neutral-default">
          תצוגת סקירה · פוסטים לדוגמה · שום דבר לא נשמר ולא נשלח
        </span>
        <div className="ms-auto flex items-center gap-1">
          {(["a", "b"] as const).map((v) => (
            <Button
              key={v}
              size="xs"
              variant={v === variant ? "default" : "outline"}
              onClick={() => onChange(v, state)}
              aria-pressed={v === variant}
            >
              {v === "a" ? "אופציה A · כפתור בכותרת" : "אופציה B · מגש בתחתית"}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {FLOW_STATES.map((s) => (
          <Button
            key={s}
            size="xs"
            variant={s === state ? "default" : "outline"}
            onClick={() => onChange(variant, s)}
            aria-pressed={s === state}
          >
            {FLOW_STATE_LABELS[s]}
          </Button>
        ))}
      </div>
    </div>
  )
}
