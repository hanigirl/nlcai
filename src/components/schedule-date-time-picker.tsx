"use client"

import { useState } from "react"
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
}: {
  /** Unique per instance — wires the time label to its input. */
  idBase: string
  /** YYYY-MM-DD currently on the board — decides which month opens first. */
  anchorDate: string
  /** YYYY-MM-DD picked (not saved yet). */
  date: string
  /** "HH:MM" picked (not saved yet). */
  time: string
  onDateChange: (date: string) => void
  onTimeChange: (time: string) => void
}) {
  return (
    <>
      <MiniMonthCalendar currentDate={anchorDate} selectedDate={date} onPick={onDateChange} />
      {/* Editable HH:MM, not an hourly list (Hani, 2026-10-21). Whether the
          slot is far enough ahead is checked on save — see checkSlot. */}
      <TimeField idBase={idBase} time={time} onTimeChange={onTimeChange} />
    </>
  )
}

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

/** The provider refuses anything closer than a few minutes; 7 is the tested floor. */
export const MIN_LEAD_MINUTES = 7

/**
 * "HH:MM" if the slot is a real time at least MIN_LEAD_MINUTES ahead, else the
 * Hebrew reason. Shared by every place that commits a slot.
 */
export function checkSlot(date: string, time: string): { ok: true } | { ok: false; reason: string } {
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!date || !m || parseInt(m[1], 10) > 23 || parseInt(m[2], 10) > 59) {
    return { ok: false, reason: "שעה לא תקינה" }
  }
  const at = parseDateKey(date)
  at.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0)
  if (at.getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000) {
    return { ok: false, reason: `אפשר לתזמן רק לפחות ${MIN_LEAD_MINUTES} דקות קדימה` }
  }
  return { ok: true }
}

/**
 * Date + time as one field (Hani, 2026-10-21, format preview A): the slot reads
 * like a select; clicking it opens a datepicker popover with the time as an
 * editable HH:MM field under the grid. Controlled — the field only edits a
 * draft. Committing is the parent's primary "תזמון פוסט" button, which sits in
 * the footer next to "עריכה בקנבס" (Hani, same day).
 */
export function ScheduleDateTimeField({
  idBase,
  date,
  time,
  onChange,
  error,
  disabled = false,
}: {
  idBase: string
  /** Draft YYYY-MM-DD; "" = not picked yet (shows the placeholder). */
  date: string
  /** Draft "HH:MM"; "" = not picked yet. */
  time: string
  onChange: (date: string, time: string) => void
  /** Shown under the field — e.g. the slot is too close to go out. */
  error?: string | null
  disabled?: boolean
}) {
  // Nothing picked yet → the grid opens on tomorrow, the time on 09:00.
  const startDate = date || toDateKey(addDays(new Date(), 1))
  const startTime = time || "09:00"
  return (
    <div className="flex flex-col gap-1.5">
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            data-invalid={error ? "" : undefined}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-3 text-start text-p text-text-primary-default tabular-nums transition-colors hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 data-[invalid]:border-red-50"
          >
            <CalendarDays className="size-4 shrink-0 text-text-neutral-default" />
            {date ? (
              <span className="flex-1 truncate">{slotLabel(date, time || startTime)}</span>
            ) : (
              <span className="flex-1 truncate text-text-neutral-default">בחירת תאריך ושעה</span>
            )}
            <ChevronDown className="size-4 shrink-0 text-text-neutral-default" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          // Same width as the field, so it opens like a select in either direction.
          className="flex w-(--radix-popover-trigger-width) min-w-72 flex-col gap-3"
        >
          <MiniMonthCalendar
            currentDate={startDate}
            selectedDate={date}
            onPick={(d) => onChange(d, time || startTime)}
          />
          <TimeField
            idBase={idBase}
            time={time || startTime}
            onTimeChange={(t) => onChange(startDate, t)}
          />
        </PopoverContent>
      </Popover>
      {error && (
        <p role="alert" className="text-xs-body text-red-50">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Editable "HH : MM" (24h), left-to-right even in RTL. Emits only complete,
 * valid times; partial typing stays local until it parses.
 */
function TimeField({
  idBase,
  time,
  onTimeChange,
}: {
  idBase: string
  time: string
  onTimeChange: (time: string) => void
}) {
  const [hh, setHh] = useState(time.slice(0, 2))
  const [mm, setMm] = useState(time.slice(3, 5))
  const [synced, setSynced] = useState(time)
  if (synced !== time) {
    setSynced(time)
    setHh(time.slice(0, 2))
    setMm(time.slice(3, 5))
  }
  const emit = (h: string, m: string) => {
    const ch = clampPart(h, 23)
    const cm = clampPart(m, 59)
    if (ch !== null && cm !== null) {
      const next = `${ch}:${cm}`
      setSynced(next)
      onTimeChange(next)
    }
  }
  const box =
    "h-9 w-11 rounded-lg border border-border-neutral-default bg-bg-surface text-center text-p-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border-neutral-default pt-3">
      <Label htmlFor={`hh-${idBase}`} className="text-small shrink-0">
        שעה
      </Label>
      <div dir="ltr" className="flex items-center gap-1.5">
        <input
          id={`hh-${idBase}`}
          aria-label="שעות"
          inputMode="numeric"
          maxLength={2}
          value={hh}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "")
            setHh(v)
            emit(v, mm)
          }}
          onBlur={() => setHh((v) => clampPart(v, 23) ?? v)}
          onFocus={(e) => e.target.select()}
          className={box}
        />
        <span className="text-p-bold text-text-primary-default">:</span>
        <input
          aria-label="דקות"
          inputMode="numeric"
          maxLength={2}
          value={mm}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "")
            setMm(v)
            emit(hh, v)
          }}
          onBlur={() => setMm((v) => clampPart(v, 59) ?? v)}
          onFocus={(e) => e.target.select()}
          className={box}
        />
      </div>
    </div>
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
