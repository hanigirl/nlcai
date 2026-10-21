"use client"

import { useState } from "react"
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select } from "@/components/ui/select"
import { toDateKey } from "@/lib/timing-storage"

/**
 * The calendar's one date + time picker.
 *
 * Lived inline in the calendar card's "תזמון לתאריך" dialog until the format
 * preview needed the same control (2026-10-18). The brief was explicit: one
 * date-and-time component in both places, so changing a slot feels the same
 * wherever it is done. Behaviour is unchanged from the inline version:
 *   - Month grid, Sunday-first; RTL flips it so Sunday lands on the right.
 *   - Past days are disabled.
 *   - The picked day gets the primary fill; today gets a soft ring.
 *   - Time sits under the grid — a date without a time isn't a schedule
 *     (Hani, 2026-10-15). Hourly, the same options as the weekly schedule; an
 *     off-grid saved time stays selectable.
 *
 * Renders a fragment so it drops into a Dialog or a panel without adding a
 * wrapper the parent's gap has to account for.
 */

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const

/** Hourly, 07:00–23:00 — the same options the weekly posting schedule offers. */
export const SCHEDULE_HOURS: string[] = Array.from(
  { length: 17 },
  (_, i) => `${String(i + 7).padStart(2, "0")}:00`,
)

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function parseDateKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
  return new Date()
}

export function ScheduleDateTimePicker({
  idBase,
  anchorDate,
  date,
  time,
  onDateChange,
  onTimeChange,
  disablePastHours = false,
}: {
  /** Unique per instance — wires the time label to its select. */
  idBase: string
  /** YYYY-MM-DD currently on the board — decides which month opens first. */
  anchorDate: string
  /** YYYY-MM-DD picked (not saved yet). */
  date: string
  /** "HH:00" picked (not saved yet). */
  time: string
  onDateChange: (date: string) => void
  onTimeChange: (time: string) => void
  /**
   * When the picked day is today, hide hours that have already passed. The
   * publisher refuses anything less than a few minutes ahead, so offering
   * 09:00 at 14:30 only sets up a failure.
   */
  disablePastHours?: boolean
}) {
  const now = new Date()
  const isTodayPicked = date === toDateKey(now)
  const hours = SCHEDULE_HOURS.filter(
    (h) => !(disablePastHours && isTodayPicked && parseInt(h, 10) <= now.getHours()),
  )
  const options = hours.includes(time) ? hours : [time, ...hours]

  return (
    <>
      <MiniMonthCalendar currentDate={anchorDate} selectedDate={date} onPick={onDateChange} />
      <div className="flex items-center gap-3 border-t border-border-neutral-default pt-3">
        <Label htmlFor={`time-${idBase}`} className="text-small shrink-0">
          שעה
        </Label>
        <Select
          id={`time-${idBase}`}
          selectSize="small"
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
          className="tabular-nums"
        >
          {options.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
      </div>
    </>
  )
}

/** The provider refuses anything closer than a few minutes; 7 is the tested floor. */
const MIN_LEAD_MINUTES = 7

function slotLabel(date: string, time: string): string {
  const day = parseDateKey(date).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return `${day} · ${time}`
}

function clampPart(raw: string, max: number): string | null {
  if (!/^\d{1,2}$/.test(raw)) return null
  const n = parseInt(raw, 10)
  return n > max ? null : String(n).padStart(2, "0")
}

/**
 * Date + time as one field (Hani, 2026-10-21, format preview A): the slot reads
 * like a select; clicking it opens a datepicker popover with the time as an
 * editable HH:MM field under the grid. No "שינוי" / "שמירה" buttons — picking
 * is the edit, and closing the popover commits it to the board (the board is
 * the source of truth). A time that's already passed, or too close to go out,
 * keeps the popover open with the reason; Escape reverts.
 */
export function ScheduleDateTimeField({
  idBase,
  date,
  time,
  onCommit,
  disabled = false,
}: {
  idBase: string
  /** YYYY-MM-DD currently on the board. */
  date: string
  /** "HH:MM" currently on the board. */
  time: string
  onCommit: (date: string, time: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState(date)
  const [hh, setHh] = useState(time.slice(0, 2))
  const [mm, setMm] = useState(time.slice(3, 5))
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setDraftDate(date)
    setHh(time.slice(0, 2))
    setMm(time.slice(3, 5))
    setError(null)
  }

  // Returns the committed time, or null with `error` set.
  const validate = (): string | null => {
    const h = clampPart(hh, 23)
    const m = clampPart(mm, 59)
    if (h === null || m === null) {
      setError("שעה לא תקינה")
      return null
    }
    const at = parseDateKey(draftDate)
    at.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0)
    if (at.getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000) {
      setError(`אפשר לתזמן רק לפחות ${MIN_LEAD_MINUTES} דקות קדימה`)
      return null
    }
    setError(null)
    return `${h}:${m}`
  }

  const onOpenChange = (next: boolean) => {
    if (next) {
      reset()
      setOpen(true)
      return
    }
    const committed = validate()
    if (committed === null) return // stay open, reason is showing
    if (draftDate !== date || committed !== time) onCommit(draftDate, committed)
    setOpen(false)
  }

  const timeInput =
    "h-9 w-11 rounded-lg border border-border-neutral-default bg-bg-surface text-center text-p-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-3 text-start text-p text-text-primary-default tabular-nums transition-colors hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CalendarDays className="size-4 shrink-0 text-text-neutral-default" />
          <span className="flex-1 truncate">{slotLabel(date, time)}</span>
          <ChevronDown className="size-4 shrink-0 text-text-neutral-default" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        // Same width as the field, so it opens like a select in either direction.
        className="flex w-(--radix-popover-trigger-width) min-w-72 flex-col gap-3"
        onEscapeKeyDown={() => {
          reset()
          setOpen(false)
        }}
      >
        <MiniMonthCalendar
          currentDate={date}
          selectedDate={draftDate}
          onPick={(d) => {
            setDraftDate(d)
            setError(null)
          }}
        />
        <div className="flex flex-col gap-1.5 border-t border-border-neutral-default pt-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`hh-${idBase}`} className="text-small shrink-0">
              שעה
            </Label>
            {/* Time reads left-to-right even in RTL: HH : MM. */}
            <div dir="ltr" className="flex items-center gap-1.5">
              <input
                id={`hh-${idBase}`}
                aria-label="שעות"
                inputMode="numeric"
                maxLength={2}
                value={hh}
                onChange={(e) => {
                  setHh(e.target.value.replace(/\D/g, ""))
                  setError(null)
                }}
                onBlur={() => setHh((v) => clampPart(v, 23) ?? v)}
                onFocus={(e) => e.target.select()}
                className={timeInput}
              />
              <span className="text-p-bold text-text-primary-default">:</span>
              <input
                aria-label="דקות"
                inputMode="numeric"
                maxLength={2}
                value={mm}
                onChange={(e) => {
                  setMm(e.target.value.replace(/\D/g, ""))
                  setError(null)
                }}
                onBlur={() => setMm((v) => clampPart(v, 59) ?? v)}
                onFocus={(e) => e.target.select()}
                className={timeInput}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs-body text-red-50">
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MiniMonthCalendar({
  currentDate,
  selectedDate,
  onPick,
}: {
  currentDate: string
  selectedDate: string
  onPick: (newDate: string) => void
}) {
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = parseDateKey(currentDate)
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })

  const today = startOfDay(new Date())

  // Always 6 rows × 7 cols so the picker height is stable across months.
  const firstOfMonth = new Date(viewMonth)
  firstOfMonth.setDate(1)
  const gridStart = addDays(startOfDay(firstOfMonth), -firstOfMonth.getDay())
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const monthLabel = new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "long",
  }).format(viewMonth)

  const shift = (delta: number) => {
    const d = new Date(viewMonth)
    d.setMonth(d.getMonth() + delta)
    setViewMonth(d)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* In RTL, ChevronRight points to the previous month. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="חודש קודם"
          className="size-7 inline-flex items-center justify-center rounded-md text-text-primary-default hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="text-small-bold text-text-primary-default tabular-nums">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="חודש הבא"
          className="size-7 inline-flex items-center justify-center rounded-md text-text-primary-default hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-xs-body text-text-neutral-default">
            {label.slice(0, 1)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = day.getMonth() === viewMonth.getMonth()
          const past = startOfDay(day).getTime() < today.getTime()
          const isCurrent = toDateKey(day) === selectedDate
          const isToday = toDateKey(day) === toDateKey(today)

          const base =
            "h-8 inline-flex items-center justify-center rounded-md text-small tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          const state = past
            ? "text-text-primary-disabled cursor-not-allowed"
            : isCurrent
              ? "bg-button-primary-default text-white hover:bg-button-primary-hover cursor-pointer"
              : isToday
                ? "ring-1 ring-yellow-50 text-text-primary-default hover:bg-bg-surface-hover cursor-pointer"
                : inMonth
                  ? "text-text-primary-default hover:bg-bg-surface-hover cursor-pointer"
                  : "text-text-primary-disabled hover:bg-bg-surface-hover cursor-pointer"

          return (
            <button
              key={toDateKey(day)}
              type="button"
              disabled={past}
              onClick={() => {
                if (!past) onPick(toDateKey(day))
              }}
              aria-label={day.toLocaleDateString("he-IL", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              aria-pressed={isCurrent || undefined}
              className={`${base} ${state}`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
