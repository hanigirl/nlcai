"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
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
