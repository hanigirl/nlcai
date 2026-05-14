"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  ChevronLeft,
  MoreVertical,
} from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { QueuePanel } from "@/components/queue-panel"
import { CorePostSheet, type CorePostSheetData } from "@/components/core-post-sheet"
import { ScheduleFormatPicker } from "@/components/schedule-format-picker"
import {
  FormatStatusChip,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import {
  DEFAULT_SCHEDULED_TIME,
  TIMING_KEYS,
  getFormatReadiness,
  getPublishedMap,
  getScheduledPosts,
  schedulePost,
  toDateKey,
  unmarkPublished,
  unschedulePost,
  type FormatId,
  type FormatReadiness,
  type ReadinessPostInput,
  type ScheduledPost,
} from "@/lib/timing-storage"

// Sunday-first because Israeli work week starts on Sunday. RTL flips the
// visual order so Sunday lands on the right edge — the user's natural start.
const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const

// Hour grid 07:00–23:00 (17 hours). Matches Hani's reference: a "work day"
// span that's wider than 9-to-5 so evening posts (typical IG/Reels times)
// have a slot. If a post lacks a time it defaults to 09:00.
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7) // [7..23]
const DEFAULT_HOUR = 9

// Format identity helpers — sourced from `format-status-chip` so the icon +
// short Hebrew label used inside the day-cell chip stay aligned with every
// other chip surface (Sheet header, /core_posts cards, queue panel). Phase 4
// removed a local FORMAT_ICONS map that had drifted: it was missing `story`
// and used a different icon for `carousel`. One source for "what does this
// format look like" prevents that drift from coming back.

// --- date helpers ---------------------------------------------------------

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Sunday of the week containing `date` (local time). */
function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() - d.getDay()) // getDay(): 0 = Sunday
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isPastDate(date: Date, today: Date): boolean {
  return startOfDay(date).getTime() < startOfDay(today).getTime()
}

/**
 * A "slot" is the intersection of a day and an hour. Past slots can't accept
 * drops. For days before today, every slot is past. For today, only hours
 * before the current wall-clock hour are past — the user can still schedule
 * "later today".
 */
function isPastSlot(day: Date, hour: number, today: Date, currentHour: number): boolean {
  if (isPastDate(day, today)) return true
  if (isSameDay(day, today) && hour < currentHour) return true
  return false
}

/** Build the 7 days of the week starting at `weekStart`. */
function buildWeekGrid(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** Compose a slot key the postsBySlot map and dragOverSlot state agree on. */
function slotKey(dateKey: string, hour: number): string {
  return `${dateKey}T${String(hour).padStart(2, "0")}`
}

/**
 * Parse "HH:00" → integer hour, with safety net. Anything outside 7–23 falls
 * back to the default — we never want a bad time to make a post invisible.
 */
function getHourFromTime(time?: string | null): number {
  if (!time) return DEFAULT_HOUR
  const h = parseInt(time.slice(0, 2), 10)
  if (Number.isNaN(h) || h < HOURS[0] || h > HOURS[HOURS.length - 1]) {
    return DEFAULT_HOUR
  }
  return h
}

/**
 * Hebrew range label that handles three cases:
 *   - Same month:    "4–10 במאי 2026"
 *   - Cross month:   "29 באפריל – 5 במאי 2026"
 *   - Cross year:    "29 בדצמבר 2026 – 4 בינואר 2027"
 */
function formatWeekRange(weekStart: Date, weekEnd: Date): string {
  const dayFmt = new Intl.DateTimeFormat("he-IL", { day: "numeric" })
  const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "long" })
  const yearFmt = new Intl.DateTimeFormat("he-IL", { year: "numeric" })

  const startDay = dayFmt.format(weekStart)
  const endDay = dayFmt.format(weekEnd)
  const startMonth = monthFmt.format(weekStart)
  const endMonth = monthFmt.format(weekEnd)
  const startYear = yearFmt.format(weekStart)
  const endYear = yearFmt.format(weekEnd)

  if (startYear !== endYear) {
    return `${startDay} ב${startMonth} ${startYear} – ${endDay} ב${endMonth} ${endYear}`
  }
  if (startMonth !== endMonth) {
    return `${startDay} ב${startMonth} – ${endDay} ב${endMonth} ${endYear}`
  }
  return `${startDay}–${endDay} ב${startMonth} ${endYear}`
}

// --- chip ----------------------------------------------------------------

/**
 * The 4 canonical formats, in display order. The day-cell card always
 * renders these 4 icons regardless of which formats are scheduled — gray
 * for "not on the calendar yet", green for "set" (scheduled somewhere).
 */
const CANONICAL_FORMATS: FormatId[] = [
  "story",
  "talking_head",
  "carousel",
  "image_post",
]

/**
 * Day-cell card — interactive surface representing one scheduled post in
 * one time slot. Post-2026-05-13 spec (Hani):
 *
 *   ┌─────────────────────────────────┐
 *   │ Hook text (truncated, 2 lines)  │
 *   │                                 │
 *   │ [🟢] [⚪] [🟢] [⚪]             │  ← 4 format icons
 *   └─────────────────────────────────┘
 *
 * Visual rules:
 *   - Whole card is the drag handle (move this scheduling to another slot).
 *   - Click on card body → open Sheet to the post (no specific format).
 *   - Click on a format icon → open Sheet at that specific format.
 *   - Each of the 4 format icons reflects SLOT-LEVEL state (per Hani
 *     2026-05-13): green only for formats scheduled at THIS exact
 *     (date, hour), gray for everything else — even formats of the
 *     same post that are scheduled in OTHER slots. The calendar is
 *     slot-precise; cross-day status lives on /core_posts cards.
 *   - Published post: opacity-60 on the whole card.
 *
 * What we removed from the prior design:
 *   - The "..." dropdown menu (edit / move / unschedule). Those actions
 *     live in the Sheet now. Drag still works for re-scheduling.
 *   - The "mark as published" checkbox. Published state is set via the
 *     Sheet or storage layer; the chip just reflects it via opacity.
 */
function ScheduledChip({
  post,
  isPublished,
  scheduledFormats,
  scheduledElsewhere,
  readyFormats,
  formatDates,
  onCardClick,
  onFormatClick,
  onUnschedule,
  onReschedule,
}: {
  post: ScheduledPost
  isPublished: boolean
  /**
   * The set of FormatIds of THIS post that are scheduled at THIS
   * exact slot (date + hour). Drives the green-with-✓ state of the
   * 4 format icons — the ✓ is the "scheduled HERE" marker.
   */
  scheduledFormats: Set<FormatId>
  /**
   * FormatIds of THIS post that are scheduled at OTHER slots
   * (different date or hour). Rendered green-WITHOUT-✓ and with a
   * dashed border: same set palette as `scheduledFormats`, but
   * weaker — corner badge + solid border are reserved for
   * "scheduled HERE."
   */
  scheduledElsewhere: Set<FormatId>
  /**
   * FormatIds of THIS post that are NOT on the calendar yet but have
   * a script + media (or drive link) — i.e. `getFormatReadiness` returns
   * "ready". Rendered with a dashed gray border so the user can see at
   * a glance which formats could still join the calendar, even while
   * looking at a slot. Hani 2026-05-13.
   */
  readyFormats: Set<FormatId>
  /**
   * Per-format YYYY-MM-DD where each format of THIS post is
   * scheduled (one entry per scheduled format). Used to surface
   * "מתוזמן 14.5" in the tooltip when a format is in the
   * `scheduledElsewhere` set, so the user can see at a glance
   * where the other instance lives.
   */
  formatDates: Map<FormatId, string>
  /** Click on the card body — open Sheet for the post. */
  onCardClick: () => void
  /** Click on a specific format icon — open Sheet at that format. */
  onFormatClick: (format: FormatId) => void
  /** Kebab menu → "הסרת הפוסט". Unschedules every format at THIS slot. */
  onUnschedule: () => void
  /**
   * Kebab menu → "תזמון לתאריך". Re-schedules every format at THIS
   * slot to the picked YYYY-MM-DD, preserving each format's existing
   * hour. The parent owns the loop because it already knows which
   * formats share this slot (the deduper that collapsed them into one
   * card lives there).
   */
  onReschedule: (newDate: string) => void
}) {
  const hookLabel = post.hook?.trim() || "פוסט מתוזמן"
  const publishedTitle = post.publishedAt
    ? `${hookLabel} — פורסם בתאריך ${new Date(post.publishedAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`
    : hookLabel

  // Local UI state for the date-picker dialog. Lives inside the chip
  // because the parent doesn't need to know about it — the only thing
  // bubbling up is the picked date via `onReschedule`. Closed on pick.
  const [dateDialogOpen, setDateDialogOpen] = useState(false)

  // Build the 4-chip status row that the hover popover renders. We keep
  // this in a closure so the popover can reuse the same chip + state
  // projection used to live inline on the card before the compact
  // redesign (per Hani's 2026-05-13 spec: one-line card by default,
  // status detail moves to hover).
  const renderFormatChipsRow = () => (
    <div className="flex items-center gap-1">
      {CANONICAL_FORMATS.map((fmt) => {
        const isScheduledHere = scheduledFormats.has(fmt)
        const isScheduledElsewhere =
          !isScheduledHere && scheduledElsewhere.has(fmt)
        const isScheduledSomewhere =
          isScheduledHere || isScheduledElsewhere
        const isReady = !isScheduledSomewhere && readyFormats.has(fmt)
        const label = getFormatChipLabel(fmt)
        let elsewhereDateLabel = ""
        if (isScheduledElsewhere) {
          const isoDate = formatDates.get(fmt)
          if (isoDate) {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
            if (m) {
              elsewhereDateLabel = `${parseInt(m[3], 10)}.${parseInt(m[2], 10)}`
            } else {
              elsewhereDateLabel = isoDate
            }
          }
        }
        const tooltip = isScheduledHere
          ? `${label} — מתוזמן`
          : isScheduledElsewhere
            ? elsewhereDateLabel
              ? `${label} — מתוזמן ${elsewhereDateLabel}`
              : `${label} — מתוזמן ביום/שעה אחרים`
            : isReady
              ? `${label} — מוכן לתזמון`
              : label
        // 3-state projection:
        //   scheduled (any slot) → green / "scheduled" chip state
        //   ready (script + media, not yet on calendar) → dashed gray
        //   else → solid gray "empty" pill
        const chipState: FormatReadiness = isScheduledSomewhere
          ? "scheduled"
          : isReady
            ? "ready"
            : "empty"
        return (
          <Tooltip key={fmt}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onFormatClick(fmt)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation()
                  }
                }}
                aria-label={tooltip}
                className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              >
                <FormatStatusChip
                  format={fmt}
                  state={chipState}
                  type="icon"
                  size="sm"
                  // "Scheduled elsewhere" → muted ✓ (gray-teal disc)
                  // so the chip reads as "on the calendar" without
                  // competing with the bold green ✓ that anchors
                  // "scheduled HERE" on a sibling slot.
                  cornerBadgeMuted={isScheduledElsewhere}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          // Whole card is the drag handle. Dragstart writes the (post, format)
          // tuple for THIS card; if the post has multiple formats at the same
          // slot, the deduper picks one — re-scheduling moves just that one.
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(
              "application/x-scheduled-chip",
              JSON.stringify({
                corePostId: post.corePostId,
                format: post.format,
              }),
            )
            e.dataTransfer.effectAllowed = "move"
          }}
          onClick={onCardClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onCardClick()
            }
          }}
          title={publishedTitle}
          aria-label={`פוסט מתוזמן: ${hookLabel}`}
          // Compact card per Hani 2026-05-13:
          //   [hook truncated to one line] [kebab]
          // Status detail moved into the HoverCard popover below. The
          // anchored format icon ALSO moves out — it floats outside the
          // card's top-end corner as a single FormatStatusChip badge.
          // `overflow-visible` is critical: the floating chip overhangs
          // the card edge, and `overflow-hidden` would clip it. The
          // parent cell drops its own clip in the cell wrapper above.
          className={`group/chip relative w-full h-full min-w-0 flex items-center gap-2 ps-2.5 pe-2 py-2 rounded-md border border-border-neutral-default bg-white cursor-grab active:cursor-grabbing transition-all hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
            isPublished ? "opacity-60" : ""
          }`}
        >
          {/* Floating format chip — sticks out the card's top-right
              corner. Shows the format anchored at THIS slot (post.format
              from the deduper). `pointer-events-none` keeps it
              decorative: clicks pass through to the card body, drag
              starts on the card itself, and the user opens per-format
              detail via the chips inside the hover popover. */}
          <div className="absolute -top-2 -right-2 z-10 pointer-events-none">
            <FormatStatusChip
              format={post.format}
              state="scheduled"
              type="icon"
              size="sm"
            />
          </div>

          {/* Hook — single truncated line. The card itself is intentionally
              minimal; the full hook + format statuses show in the hover
              popover. `min-w-0` is required so `truncate` actually clips
              inside a flex row (flex items default to min-width: auto). */}
          <span className="flex-1 min-w-0 truncate text-text-primary-default text-xs-body leading-tight">
            {hookLabel}
          </span>

          {/* Kebab — always visible (per Hani's earlier spec). Click →
              DropdownMenu with two items. We swallow click + drag +
              keydown on the trigger so the outer card's onClick /
              dragstart never fire while the user is interacting with
              the menu. */}
          <DropdownMenu dir="rtl">
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation()
                      }
                    }}
                    aria-label="פעולות"
                    className="shrink-0 size-6 rounded-md bg-gray-95 text-text-neutral-default hover:bg-bg-surface-hover hover:text-text-primary-default inline-flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                  >
                    <MoreVertical className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>פעולות</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              side="left"
              align="start"
              sideOffset={6}
              className="min-w-[180px]"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => setDateDialogOpen(true)}
              >
                תזמון לתאריך
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                variant="destructive"
                onSelect={() => onUnschedule()}
              >
                הסרת הפוסט
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Re-schedule date picker. Portalled by Radix, so it sits
              outside the card's DOM and the card's onClick/drag handlers
              don't fire while the user is picking a date. */}
          <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
            <DialogContent
              dir="rtl"
              className="sm:max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <DialogHeader>
                <DialogTitle>תזמון לתאריך</DialogTitle>
              </DialogHeader>
              <MiniMonthCalendar
                currentDate={post.scheduledDate}
                onPick={(newDate) => {
                  setDateDialogOpen(false)
                  onReschedule(newDate)
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </HoverCardTrigger>

      {/* Hover popover — full hook text + 4 format chips with statuses.
          Portalled by Radix so it isn't clipped by the cell or grid.
          Opens below the card with the anchor on the trailing edge
          (RTL trailing = left), matching the user's screenshot. */}
      <HoverCardContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-72"
      >
        <div dir="rtl" className="flex flex-col gap-3">
          {renderFormatChipsRow()}
          <p className="text-small text-text-primary-default leading-relaxed">
            {hookLabel}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/* ------------------------------------------------------------------ */
/*  MiniMonthCalendar                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compact month grid used inside the ScheduledChip's "תזמון לתאריך"
 * dialog. We keep it inline (not a shared component) because it's
 * tightly coupled to the chip's reschedule UX:
 *   - Picks ONE date (not a range, not a date+time).
 *   - Past days are disabled — re-scheduling to yesterday makes no
 *     sense; the existing isPastDate helper draws the line.
 *   - The currently scheduled date is highlighted as the anchor so
 *     the user sees "where it is now → where it will move".
 *   - Today gets a softer secondary ring so the user can find it
 *     when they jumped months ahead.
 * RTL is handled by the parent DialogContent's `dir="rtl"` — we
 * flip Sunday to the right by rendering the weekday array in order
 * and letting RTL CSS direction reverse it visually, same trick used
 * in the main weekly grid above.
 */
function MiniMonthCalendar({
  currentDate,
  onPick,
}: {
  /** YYYY-MM-DD currently scheduled — initial visible month + highlight. */
  currentDate: string
  /** Called with YYYY-MM-DD when the user clicks a valid day. */
  onPick: (newDate: string) => void
}) {
  // Parse the current date as local time so the visible month matches
  // what the rest of the calendar shows (toDateKey writes local YYYY-MM-DD).
  const parsed = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(currentDate)
    if (m) {
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
    }
    return new Date()
  })()

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = new Date(parsed)
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })

  const today = startOfDay(new Date())

  // Build the 6-week grid for the visible month. We always render 6
  // rows × 7 cols so the dialog height is stable across months — short
  // months don't make the picker jump. Days from the prev/next month
  // are rendered as ghost cells (disabled, faded).
  const firstOfMonth = new Date(viewMonth)
  firstOfMonth.setDate(1)
  const gridStart = startOfWeek(firstOfMonth) // Sunday on/before the 1st
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const monthLabel = new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "long",
  }).format(viewMonth)

  const goPrev = () => {
    const d = new Date(viewMonth)
    d.setMonth(d.getMonth() - 1)
    setViewMonth(d)
  }
  const goNext = () => {
    const d = new Date(viewMonth)
    d.setMonth(d.getMonth() + 1)
    setViewMonth(d)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Month nav. In RTL, ChevronRight visually points to the
          previous month and ChevronLeft to the next — matching the
          main weekly grid's nav arrows. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          aria-label="חודש קודם"
          className="size-7 inline-flex items-center justify-center rounded-md text-text-primary-default hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="text-small-bold text-text-primary-default tabular-nums">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={goNext}
          aria-label="חודש הבא"
          className="size-7 inline-flex items-center justify-center rounded-md text-text-primary-default hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>

      {/* Weekday header. Sunday-first to match the main weekly grid;
          RTL flips it visually so Sunday lands on the right. */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-xs-body text-text-neutral-default"
          >
            {label.slice(0, 1)}
          </div>
        ))}
      </div>

      {/* Day grid. Past days disabled. Current scheduled date gets the
          primary fill; today gets a softer ring so the user can locate
          it at a glance across months. */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = day.getMonth() === viewMonth.getMonth()
          const past = isPastDate(day, today)
          const isCurrent = toDateKey(day) === currentDate
          const isToday = isSameDay(day, today)
          const disabled = past

          const base =
            "h-8 inline-flex items-center justify-center rounded-md text-small tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          const state = disabled
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
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                onPick(toDateKey(day))
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

// --- page ----------------------------------------------------------------

export default function CalendarPage() {
  // We hold "today" and "now" in state so they stay stable across re-renders
  // within a session. (Re-computing on every render would make `isToday`
  // flicker if a render straddled midnight — rare, but cheap to avoid.)
  const [today] = useState<Date>(() => startOfDay(new Date()))
  const [currentHour] = useState<number>(() => new Date().getHours())

  // Minute-precision "now" cursor for the yellow now-line that overlays
  // the grid. Updated every 60s so the line drifts down through the day
  // naturally. We don't bother with sub-minute precision — visible drift
  // at the second scale would be jittery, and the line's purpose is "where
  // are we in the day, roughly" not "exact second of right now."
  const [nowMinutes, setNowMinutes] = useState<number>(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })
  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date()
      setNowMinutes(n.getHours() * 60 + n.getMinutes())
    }, 60_000)
    return () => clearInterval(id)
  }, [])
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today))

  // Scheduled posts live in localStorage. We hydrate after mount to avoid
  // SSR/CSR mismatch (localStorage doesn't exist on the server).
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([])

  // Per-post published mark — kept as a Set for O(1) lookups in render.
  const [publishedSet, setPublishedSet] = useState<Set<string>>(new Set())

  // Subtitle counter — driven by the queue panel via callback.

  // Sheet state. Two modes share the same data hydration:
  //  - "edit"    → opens CorePostSheet (master + format detail, editable).
  //                Triggered by clicking a calendar-grid chip.
  //  - "preview" → opens CorePostPreviewSheet (read-only "ready formats"
  //                discovery). Triggered by clicking a QueuePanel row.
  // Per Hani: /calendar = "מתי לפרסם" → click is preview, drag is action.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState<"edit" | "preview">("edit")
  const [sheetData, setSheetData] = useState<CorePostSheetData | null>(null)
  const [sheetLoading, setSheetLoading] = useState(false)
  // Phase 4: which format the Sheet should scroll to on open. Set when the
  // user clicks a day-cell chip (we know which format that chip represents).
  // Cleared when the Sheet closes so a subsequent open from the queue panel
  // doesn't accidentally inherit the previous chip's format.
  const [sheetInitialFormat, setSheetInitialFormat] = useState<FormatId | undefined>(undefined)

  // Phase 3b: format-picker dialog state. Set when the user drops a post
  // with >1 ready format — the dialog asks which one to schedule. Cleared
  // on cancel/confirm. We hold the target slot here so the same data flows
  // straight into `schedulePost` after the user picks.
  const [formatPicker, setFormatPicker] = useState<{
    corePostId: string
    displayText: string | null
    formatStates: Record<FormatId, FormatReadiness>
    targetDate: string
    targetTime: string
  } | null>(null)

  useEffect(() => {
    const reload = () => {
      const rows = getScheduledPosts()
      setScheduled(rows)
      // Rebuild the published set keyed by `${corePostId}:${format}`. The
      // per-format era means a single core post can be published on one
      // format and still pending on another — we can't collapse to a single
      // post-level boolean any more.
      const set = new Set<string>()
      for (const p of rows) {
        const key = `${p.corePostId}:${p.format}`
        if (p.publishedAt) {
          set.add(key)
        } else {
          const map = getPublishedMap(p.corePostId)
          if (map[p.format]) set.add(key)
        }
      }
      setPublishedSet(set)
    }
    reload()

    // Stay in sync with any source that may write to scheduled / published.
    // The published key is per-post, so we match by prefix.
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (
        e.key === TIMING_KEYS.scheduled ||
        e.key.startsWith(TIMING_KEYS.publishedPrefix)
      ) {
        reload()
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  // Live hook lookup: scheduled rows persist a `hook` snapshot at schedule
  // time, but old rows (and any reschedule that lost the cache) won't have
  // it. Fetch the live core-posts list once on mount so the slot card can
  // resolve `corePostId → hook` against the source of truth, falling back
  // to the persisted hook (then to the placeholder) if the fetch fails.
  const [hookByPostId, setHookByPostId] = useState<Map<string, string>>(
    new Map(),
  )
  // Readiness inputs per post — needed so the slot card can render
  // not-yet-scheduled formats that have script + media as a "ready"
  // (dashed) chip instead of the default "empty" gray pill. Hani
  // 2026-05-13: "בפוסט שנמצא בלוח לפעמים יש פורמט נוסף שהוא מוכן
  // לתזמון, אני רוצה שהוא יהיה מקווקו." We source the same shape
  // the QueuePanel uses, so getFormatReadiness gives the same result
  // across both surfaces.
  const [readinessByPostId, setReadinessByPostId] = useState<
    Map<string, ReadinessPostInput>
  >(new Map())
  useEffect(() => {
    let cancelled = false
    fetch("/api/core-posts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const hookMap = new Map<string, string>()
        const readinessMap = new Map<string, ReadinessPostInput>()
        type ApiPost = {
          id: string
          hook_text?: string | null
          title?: string | null
          body?: string | null
          formats?: FormatId[] | null
          formats_with_media?: FormatId[] | null
        }
        for (const p of (data.posts ?? []) as ApiPost[]) {
          if (!p.id) continue
          const text = p.hook_text?.trim() || p.title?.trim()
          if (text) hookMap.set(p.id, text)
          readinessMap.set(p.id, {
            id: p.id,
            formats: p.formats ?? [],
            formatsWithMedia: p.formats_with_media ?? [],
            hasBody: !!p.body?.trim(),
          })
        }
        setHookByPostId(hookMap)
        setReadinessByPostId(readinessMap)
      })
      .catch((err) => {
        // Surface loudly so an invisible hook-resolution failure doesn't
        // get blamed on "the placeholder is showing"; the user still sees
        // the calendar (just with the placeholder text where hooks fail).
        console.error("[calendar] failed to fetch hooks for slot cards", err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const days = useMemo(() => buildWeekGrid(weekStart), [weekStart])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])
  const isCurrentWeek = isSameDay(weekStart, startOfWeek(today))

  // Group scheduled posts by `${dateKey}T${hour}` so the per-cell lookup is
  // O(1) instead of O(n) on every render.
  const postsBySlot = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>()
    for (const post of scheduled) {
      const hour = getHourFromTime(post.scheduledTime)
      const key = slotKey(post.scheduledDate, hour)
      const list = map.get(key) ?? []
      list.push(post)
      map.set(key, list)
    }
    return map
  }, [scheduled])

  // Post-level format projection: every format-id this post has
  // scheduled ANYWHERE on the calendar, alongside the date that
  // format lives on. Used by SlotCard to mark "scheduled elsewhere"
  // dots + show the date in their tooltip — same green palette as
  // the here-anchored dots, dashed border, no ✓.
  const scheduledFormatsByPost = useMemo(() => {
    const map = new Map<string, Set<FormatId>>()
    for (const p of scheduled) {
      const set = map.get(p.corePostId) ?? new Set<FormatId>()
      set.add(p.format)
      map.set(p.corePostId, set)
    }
    return map
  }, [scheduled])

  const formatDatesByPost = useMemo(() => {
    const map = new Map<string, Map<FormatId, string>>()
    for (const p of scheduled) {
      let inner = map.get(p.corePostId)
      if (!inner) {
        inner = new Map<FormatId, string>()
        map.set(p.corePostId, inner)
      }
      // (corePostId, format) is unique in storage — schedulePost is
      // upsert-keyed — so this overwrite never loses information.
      inner.set(p.format, p.scheduledDate)
    }
    return map
  }, [scheduled])

  const goPrev = () => setWeekStart((d) => addDays(d, -7))
  const goNext = () => setWeekStart((d) => addDays(d, 7))
  const goThisWeek = () => setWeekStart(startOfWeek(today))

  // --- DnD handlers ------------------------------------------------------
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null)

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    day: Date,
    hour: number,
    slot: string,
  ) => {
    if (isPastSlot(day, hour, today, currentHour)) return // past: no preventDefault → drop disallowed
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dragOverSlot !== slot) setDragOverSlot(slot)
  }

  const handleDragLeave = (slot: string) => {
    if (dragOverSlot === slot) setDragOverSlot(null)
  }

  /**
   * Canonical four formats — kept aligned with Sheet/cards so the picker
   * dialog renders the same slate everywhere. Defined inline (not imported)
   * because it's a UI constant for THIS surface, not a storage concept.
   */
  const PICKER_FORMATS: FormatId[] = [
    "story",
    "talking_head",
    "carousel",
    "image_post",
  ]

  /**
   * Pretty Hebrew label for a (date, time) tuple — used in the picker
   * dialog header so the user sees exactly which slot they're committing
   * to. Kept colocated because the layout of the label is calendar-specific.
   */
  function formatPickerTargetLabel(dateKey: string, time: string): string {
    try {
      const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10))
      const date = new Date(y, m - 1, d)
      const dateStr = date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "long",
      })
      return `${dateStr} בשעה ${time}`
    } catch {
      return `${dateKey} ${time}`
    }
  }

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    day: Date,
    hour: number,
    dayKey: string,
  ) => {
    if (isPastSlot(day, hour, today, currentHour)) return
    e.preventDefault()
    setDragOverSlot(null)
    const time = `${String(hour).padStart(2, "0")}:00`

    // Source 1: chip-to-chip reschedule. The chip stamps a dedicated MIME
    // type on dragstart with `{corePostId, format}` — the (post, format)
    // tuple is the unique key for a scheduled row. Re-running schedulePost
    // updates that row in place (same key → upsert), so the chip moves
    // from its old slot to this one without any explicit "remove + add"
    // dance. Idempotent: dropping on the same slot is a no-op.
    const rescheduleRaw = e.dataTransfer.getData(
      "application/x-scheduled-chip",
    )
    if (rescheduleRaw) {
      try {
        const { corePostId, format } = JSON.parse(rescheduleRaw) as {
          corePostId: string
          format: FormatId
        }
        schedulePost(corePostId, format, dayKey, time)
      } catch (err) {
        console.error("[calendar] failed to parse reschedule payload", err)
      }
      return
    }

    const corePostId = e.dataTransfer.getData("text/x-core-post-id")
    if (!corePostId) return

    // Read the readiness payload the queue panel set on drag start. If it's
    // missing (e.g. a future drag source that doesn't supply it), we fall
    // back to opening the dialog with no readiness info — the dialog will
    // show all formats as empty, which is wrong, so we'd rather just bail
    // gracefully. Today the only drag source is QueuePanel which always
    // sets it, so this is just a safety net.
    const raw = e.dataTransfer.getData("application/x-core-post-readiness")
    if (!raw) {
      console.warn("[calendar] drop missing readiness payload — bailing")
      toast.error("לא ניתן לתזמן את הפוסט הזה")
      return
    }
    let payload: {
      corePostId: string
      formats: string[]
      formatsWithMedia: string[]
      hasBody: boolean
      displayText: string | null
    }
    try {
      payload = JSON.parse(raw)
    } catch (err) {
      console.error("[calendar] failed to parse readiness payload", err)
      return
    }

    // Derive readiness for every canonical format. The picker shows them
    // all (ready ones selectable, others disabled with a reason); we also
    // use this same map to decide whether to bypass the dialog entirely.
    const readinessInput: ReadinessPostInput = {
      id: payload.corePostId,
      formats: payload.formats,
      formatsWithMedia: payload.formatsWithMedia,
      hasBody: payload.hasBody,
    }
    const formatStates = Object.fromEntries(
      PICKER_FORMATS.map((f) => [f, getFormatReadiness(readinessInput, f)]),
    ) as Record<FormatId, FormatReadiness>

    const readyFormats = PICKER_FORMATS.filter(
      (f) => formatStates[f] === "ready",
    )

    // Bypass 0: no ready format means there's nothing to schedule.
    // Surface a toast that points the user back to creating a script +
    // media — opening the picker with zero selectable options would feel
    // like a dead end.
    if (readyFormats.length === 0) {
      toast.error(
        "הפוסט אינו מוכן לתזמון — צרו סקריפט והעלו מדיה לפחות לפורמט אחד",
        { duration: 5000 },
      )
      return
    }

    // Per Hani: ALWAYS open the picker when there's at least one ready
    // format — even if only one is ready. The picker confirms WHICH
    // format we're scheduling and is the user's chance to back out
    // before commit.
    setFormatPicker({
      corePostId,
      displayText: payload.displayText,
      formatStates,
      targetDate: dayKey,
      targetTime: time,
    })
  }

  /**
   * Confirm handler for the format picker. Commits the schedule for EACH
   * selected format at the same (date, hour) slot — so a single drag can
   * paint N chips on the calendar (one per format), each with its own
   * semantic color.
   *
   * The picker guarantees `formats.length >= 1` (the confirm button is
   * disabled otherwise), so the loop always commits at least one row.
   * Kept on the page (not in the picker) so the picker stays I/O-free and
   * re-usable from any future drag source.
   */
  const handleConfirmFormatPick = (formats: FormatId[]) => {
    if (!formatPicker) return
    // Persist the hook with each scheduled row so the calendar slot card
    // can render the post's hook directly — without the cached hook the
    // card falls back to a generic "פוסט מתוזמן" placeholder and the user
    // can't tell which post is in which slot.
    const hook = formatPicker.displayText?.trim() || undefined
    for (const format of formats) {
      schedulePost(
        formatPicker.corePostId,
        format,
        formatPicker.targetDate,
        formatPicker.targetTime,
        hook ? { hook } : undefined,
      )
    }
    setFormatPicker(null)
  }

  // --- Sheet open helpers ------------------------------------------------
  /**
   * Open the Sheet for a core post. Pass `initialFormat` ONLY when the caller
   * knows which format the user clicked (e.g. a day-cell chip). Other call
   * sites (queue panel rows, /core_posts cards, "edit" from the chip menu)
   * leave it undefined and the Sheet opens at its natural top.
   */
  const openSheetForCorePost = async (
    corePostId: string,
    initialFormat?: FormatId,
    mode: "edit" | "preview" = "edit",
  ) => {
    setSheetMode(mode)
    setSheetLoading(true)
    setSheetOpen(true)
    setSheetData(null)
    setSheetInitialFormat(initialFormat)
    try {
      const res = await fetch(`/api/core-posts/${corePostId}`)
      const data = await res.json()
      const p = data?.post as
        | {
            id: string
            title: string | null
            body: string
            hook_text: string | null
            created_at: string
            videoUrl?: string | null
            coverUrl?: string | null
            formatPosts?: Record<string, string>
            formatsWithMedia?: string[]
            formatMedia?: Record<string, string>
          }
        | undefined
      if (!p) {
        setSheetOpen(false)
        return
      }
      // Phase 3a: prefer the keys present in `formatPosts` (which is "this
      // format actually has a script row"). Falls back to an empty list when
      // the API returns nothing. The Sheet uses `formatBodies` directly to
      // render per-format scripts, and `formats` to derive readiness.
      const formats = Object.keys(p.formatPosts ?? {})
      setSheetData({
        id: p.id,
        title: p.title,
        body: p.body,
        hookText: p.hook_text,
        formats,
        formatsWithMedia: p.formatsWithMedia ?? [],
        // Phase 3a: pass the per-format script map straight through. The
        // Sheet uses it to render each FormatSection's script block and
        // to derive `hasBodyByFormat` for the readiness chips, so chip
        // and section can never disagree on "ready vs. empty".
        formatBodies: p.formatPosts ?? {},
        // Per-format media URLs from the detail endpoint (post-2026-05-13).
        // Without this the Sheet would render `primaryMediaUrl` (a single
        // post-level URL — typically the talking_head video) on every
        // tab, masking story / carousel / image_post uploads.
        formatMedia: p.formatMedia as
          | Partial<Record<FormatId, string>>
          | undefined,
        createdAt: p.created_at,
        primaryMediaUrl: p.videoUrl ?? null,
        coverUrl: p.coverUrl ?? null,
      })
    } catch (err) {
      console.error("[calendar] failed to load post for sheet", err)
      setSheetOpen(false)
    } finally {
      setSheetLoading(false)
    }
  }

  return (
    <AppShell>
      {/*
        Two-column layout in a single full-height column container.
        The AppShell <main> sets `pt-[72px] px-6 pb-6` and lets the area
        scroll vertically. To make the queue panel a full-height rail, we
        size THIS container to fill the available height (viewport minus
        the AppShell padding) and lay out a horizontal row of:
          - calendar column (header + week nav + grid card) → takes remaining width
          - queue panel → shrink-0 320px, h-full, scrolls its own list
        The calendar column itself is a flex-col so the grid card can grow
        to fill the height alongside the panel.
      */}
      <div
        // Reserve 400px on the visual end (left in RTL) for the
        // QueuePanel — matches the MediaPanel width, the smallest of
        // our standard side panel sizes (400 / 520 / 680). Without the
        // padding the calendar grid would render underneath the
        // fixed-positioned panel.
        className="w-full flex gap-5 h-[calc(100vh-72px-3rem)] min-h-0 pe-[420px]"
        dir="rtl"
      >
        {/* Calendar column — header + week nav at standard page width,
            grid card stretches to full width below. */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Header at the standard page width — keeps the title aligned
              with the rest of the system. */}
          <div className="max-w-[1200px] w-full mx-auto">
            {/* Level 1 — page identity. Title (with leading illustration,
                matching /core_posts + /hooks) + static subtitle that
                explains the JTBD ("what can I do here?"). */}
            <div className="flex flex-col gap-1.5 mb-6">
              <div className="flex items-center gap-2">
                <img
                  src="/images/calendar-min.png"
                  alt=""
                  className="w-[48px] h-[48px]"
                />
                <h2 className="text-text-primary-default">תזמון</h2>
              </div>
              <p className="text-p text-text-neutral-default">
                ניתן לתזמן פורמט אחד או יותר של פוסט ליבה מוכן. סקריפט + מדיה
              </p>
            </div>

            {/* Level 2 — week navigation. */}
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Button variant="ghost" size="icon-sm" onClick={goPrev} aria-label="שבוע קודם">
                  <ChevronRight className="size-4" />
                </Button>
                <span className="text-p-bold text-text-primary-default text-center px-1 tabular-nums">
                  {formatWeekRange(weekStart, weekEnd)}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={goNext} aria-label="שבוע הבא">
                  <ChevronLeft className="size-4" />
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={goThisWeek} disabled={isCurrentWeek}>
                השבוע
              </Button>
            </div>
          </div>

          {/* Level 3 — week grid (full-bleed). Negative margins cancel
              `<main>`'s px-6/pb-6 so the grid hugs the sidebar on the
              start side, the queue panel on the end side, and the
              viewport bottom. No rounded corners — per Hani: edge-to-edge. */}
          <div className="flex-1 min-h-0 min-w-0 -ms-6 -me-6 -mb-6 border-y border-border-neutral-default bg-white dark:bg-gray-10 overflow-auto">
            {/* Top strip — empty corner + 7 day labels. Sticky so the day
                headers stay pinned to the top while the hour grid scrolls
                vertically beneath them. `z-20` keeps them above scheduled
                chips (the dragOver ring uses z-10). */}
            <div className="sticky top-0 z-20 grid grid-cols-[64px_repeat(7,minmax(0,1fr))] bg-bg-surface border-b border-border-neutral-default">
              <div className="border-l border-border-neutral-default" aria-hidden />
              {days.map((day, i) => {
                const isToday = isSameDay(day, today)
                const isLastCol = i === days.length - 1
                return (
                  <div
                    key={day.toISOString()}
                    className={`px-3 py-2.5 text-center ${isLastCol ? "" : "border-l"} border-border-neutral-default`}
                  >
                    <div className="text-xs-body text-text-neutral-default">
                      {WEEKDAY_LABELS[day.getDay()]}
                    </div>
                    <div className="text-small-bold text-text-primary-default tabular-nums">
                      {isToday ? (
                        <span className="inline-flex items-center justify-center size-6 rounded-full bg-yellow-50">
                          {day.getDate()}
                        </span>
                      ) : (
                        day.getDate()
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Body — hours column + 7 day columns. The yellow now-line
                is rendered inside today's column (below), scoped to that
                column's width so it only marks "now" against today —
                not against unrelated past/future days. */}
            <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
              <div className="grid grid-rows-[repeat(17,3.5rem)] border-l border-border-neutral-default">
                {HOURS.map((hour, i) => {
                  const isLastRow = i === HOURS.length - 1
                  return (
                    <div
                      key={hour}
                      className={`px-2 pt-1 text-xs-body text-text-neutral-default tabular-nums text-center ${isLastRow ? "" : "border-b"} border-border-neutral-default`}
                    >
                      {String(hour).padStart(2, "0")}:00
                    </div>
                  )
                })}
              </div>

              {days.map((day, i) => {
                const dayKey = toDateKey(day)
                const isToday = isSameDay(day, today)
                const dayOfWeek = day.getDay()
                const isLastCol = i === days.length - 1

                // Today gets a very subtle warm tint (yellow-95 at 40%)
                // — visible enough to read as "this is today" but light
                // enough that future hours still look interactive. The
                // earlier gray bg-bg-surface read as "disabled column"
                // which blocked Hani from dropping on future hours.
                const dayBg = isToday
                  ? "bg-yellow-95/40"
                  : "bg-white dark:bg-gray-10"

                // Now-line offset (only relevant for today's column).
                // Computed locally so we can render it absolutely inside
                // the column's relative container — keeps the line scoped
                // to today's width.
                const FIRST_HOUR = HOURS[0]
                const LAST_HOUR = HOURS[HOURS.length - 1]
                // Hour-row height in px — kept in sync with the
                // `grid-rows-[repeat(17,3.5rem)]` template on the day
                // column. 3.5rem × 16px = 56px. Drives the now-line
                // vertical position; drift between the two values
                // would put the yellow now-line at the wrong minute.
                const ROW_H_PX = 56
                let nowLineTopPx: number | null = null
                if (isToday) {
                  const minutesFromStart = nowMinutes - FIRST_HOUR * 60
                  const gridSpanMinutes = (LAST_HOUR + 1 - FIRST_HOUR) * 60
                  if (minutesFromStart >= 0 && minutesFromStart <= gridSpanMinutes) {
                    nowLineTopPx = (minutesFromStart / 60) * ROW_H_PX
                  }
                }

                return (
                  <div
                    key={day.toISOString()}
                    className={`relative grid grid-rows-[repeat(17,3.5rem)] min-w-0 ${isLastCol ? "" : "border-l"} border-border-neutral-default ${dayBg}`}
                  >
                    {nowLineTopPx !== null && (
                      <div
                        aria-hidden
                        style={{ top: `${nowLineTopPx}px` }}
                        className="absolute inset-x-0 h-0.5 bg-yellow-50 z-30 pointer-events-none"
                      />
                    )}
                    {HOURS.map((hour) => {
                      const slot = slotKey(dayKey, hour)
                      const isPast = isPastSlot(day, hour, today, currentHour)
                      const isDragOver = dragOverSlot === slot
                      const slotPosts = postsBySlot.get(slot) ?? []
                      const isLastRow = hour === HOURS[HOURS.length - 1]

                      return (
                        <div
                          key={slot}
                          onDragOver={(e) => handleDragOver(e, day, hour, slot)}
                          onDragLeave={() => handleDragLeave(slot)}
                          onDrop={(e) => handleDrop(e, day, hour, dayKey)}
                          aria-label={`${WEEKDAY_LABELS[dayOfWeek]} ${day.getDate()} ${String(hour).padStart(2, "0")}:00${isToday ? " — היום" : ""}${isPast ? " — שעה שעברה" : ""}`}
                          // `overflow-visible` (removed `overflow-hidden`)
                          // lets the ScheduledChip's floating format
                          // badge overhang the cell's top-end corner
                          // per Hani's design. The chip itself is the
                          // only content here and clips its own text
                          // via line-clamp, so dropping the cell's
                          // clip is safe.
                          className={`relative p-1 min-w-0 transition-colors ${isLastRow ? "" : "border-b"} border-border-neutral-default ${
                            isDragOver ? "ring-2 ring-inset ring-yellow-50 bg-bg-surface-hover z-10" : ""
                          } ${isPast ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                          {/*
                            Dedupe by corePostId within a slot. If multiple
                            formats of the same post happen to share a slot,
                            they collapse to ONE card — the 4-icon row inside
                            the card already communicates which formats are
                            scheduled, so showing multiple cards would be
                            redundant. We keep the first occurrence's post
                            data (hook, publishedAt, format) so drag still
                            has a valid (corePostId, format) tuple to move.
                          */}
                          {(() => {
                            const seen = new Set<string>()
                            const uniquePosts = slotPosts.filter((p) => {
                              if (seen.has(p.corePostId)) return false
                              seen.add(p.corePostId)
                              return true
                            })
                            return uniquePosts.map((post) => {
                              // A slot is "published" only if ALL its scheduled
                              // formats are marked published — otherwise the
                              // post is still partly active and shouldn't fade.
                              const allFormatsAtSlot = slotPosts
                                .filter((p) => p.corePostId === post.corePostId)
                                .map((p) => p.format)
                              const isPublished = allFormatsAtSlot.every((f) =>
                                publishedSet.has(`${post.corePostId}:${f}`),
                              )
                              // Two projections for the dots:
                              //   scheduledFormats   — formats of this
                              //                        post anchored
                              //                        to THIS slot
                              //                        (date+hour).
                              //                        Rendered green
                              //                        WITH the ✓.
                              //   scheduledElsewhere — formats of the
                              //                        same post that
                              //                        live in OTHER
                              //                        slots. Same
                              //                        green palette,
                              //                        no ✓ — green is
                              //                        "on the
                              //                        calendar"; ✓
                              //                        narrows that to
                              //                        "on the
                              //                        calendar HERE."
                              const scheduledFormats = new Set<FormatId>(
                                allFormatsAtSlot,
                              )
                              const allScheduled =
                                scheduledFormatsByPost.get(post.corePostId) ??
                                new Set<FormatId>()
                              const scheduledElsewhere = new Set<FormatId>()
                              for (const f of allScheduled) {
                                if (!scheduledFormats.has(f)) {
                                  scheduledElsewhere.add(f)
                                }
                              }
                              // "Ready but not scheduled" formats for this
                              // post. `getFormatReadiness` returns "ready"
                              // only when the format has a script + media
                              // (or drive URL) AND isn't already on the
                              // calendar / published — so a format already
                              // in `allScheduled` is naturally excluded.
                              // If we haven't hydrated readiness yet (the
                              // API hasn't returned), the set is empty and
                              // the chip falls back to its prior "empty"
                              // rendering — no broken intermediate state.
                              const readyFormats = new Set<FormatId>()
                              const readinessInput = readinessByPostId.get(
                                post.corePostId,
                              )
                              if (readinessInput) {
                                for (const fmt of CANONICAL_FORMATS) {
                                  if (
                                    getFormatReadiness(readinessInput, fmt) ===
                                    "ready"
                                  ) {
                                    readyFormats.add(fmt)
                                  }
                                }
                              }
                              // Prefer the live hook from the core-posts API
                              // over the snapshot persisted at schedule time —
                              // ensures edits to the hook propagate to the
                              // calendar card without a re-schedule, and
                              // backfills hooks for older schedules that
                              // didn't snapshot one.
                              const liveHook = hookByPostId.get(post.corePostId)
                              const enrichedPost = liveHook
                                ? { ...post, hook: liveHook }
                                : post
                              return (
                                <ScheduledChip
                                  key={`${post.corePostId}:${slot}`}
                                  post={enrichedPost}
                                  isPublished={isPublished}
                                  scheduledFormats={scheduledFormats}
                                  scheduledElsewhere={scheduledElsewhere}
                                  readyFormats={readyFormats}
                                  formatDates={
                                    formatDatesByPost.get(post.corePostId) ??
                                    new Map<FormatId, string>()
                                  }
                                  onCardClick={() =>
                                    openSheetForCorePost(
                                      post.corePostId,
                                      undefined,
                                      "edit",
                                    )
                                  }
                                  onFormatClick={(format) =>
                                    openSheetForCorePost(
                                      post.corePostId,
                                      format,
                                      "edit",
                                    )
                                  }
                                  onUnschedule={() => {
                                    // Drop ALL formats of this post at
                                    // this exact slot — the user sees
                                    // ONE card here regardless of how
                                    // many formats share the slot
                                    // (the deduper above collapses
                                    // them), so unscheduling should
                                    // match that one-card mental
                                    // model and not leave an
                                    // invisible variant scheduled.
                                    // QueuePanel filters by "not in
                                    // scheduled set", so removing
                                    // these rows automatically
                                    // returns the post to the
                                    // side panel as "ready to
                                    // schedule" again — no extra
                                    // wiring needed.
                                    //
                                    // Also clear the per-format
                                    // PUBLISHED mark for each format
                                    // we're sending back. Without this
                                    // the queue card's chip would keep
                                    // a green V (Hani 2026-05-13:
                                    // "הפורמט שהחזרתי עדיין מופיע ב-V
                                    // כאילו הוא מתוזמן בלוח") — the
                                    // published mark in localStorage
                                    // outlived the schedule row that
                                    // sourced it, and getFormatReadiness
                                    // returns "published" before
                                    // checking schedule state. "Return
                                    // to queue" means "this isn't
                                    // done yet", so we drop the stale
                                    // confirmation.
                                    for (const f of allFormatsAtSlot) {
                                      unschedulePost(post.corePostId, f)
                                      unmarkPublished(post.corePostId, f)
                                    }
                                    toast.success("הפוסט הוחזר לתור")
                                  }}
                                  onReschedule={(newDate) => {
                                    // Same one-card-per-slot mental
                                    // model as onUnschedule: move
                                    // EVERY format at this slot to
                                    // the picked date, preserving
                                    // each format's existing hour
                                    // (which is the slot's hour). The
                                    // chip the user clicked carries
                                    // the slot's time on
                                    // `post.scheduledTime`, and every
                                    // format at the slot shares it by
                                    // construction (they're grouped
                                    // by hour up the tree).
                                    const time =
                                      post.scheduledTime ??
                                      DEFAULT_SCHEDULED_TIME
                                    for (const f of allFormatsAtSlot) {
                                      schedulePost(
                                        post.corePostId,
                                        f,
                                        newDate,
                                        time,
                                        { hook: enrichedPost.hook },
                                      )
                                    }
                                    toast.success("התזמון עודכן")
                                  }}
                                />
                              )
                            })
                          })()}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {/* /Calendar column */}

        {/* Queue panel — full-height rail on the visual end (left in RTL).
            Sibling of the calendar column inside the outer flex row, so it
            stretches to the full container height (`h-[calc(100vh-72px-3rem)]`).
            The panel itself uses `h-full` so its inner list scrolls
            independently of the calendar grid. */}
        <QueuePanel
          onItemClick={(corePostId) =>
            openSheetForCorePost(corePostId, undefined, "preview")
          }
        />
      </div>

      {/* Single Sheet for both entry points (chip click on the board +
          queue-panel click). Per Hani 2026-05-13: the previous split
          into CorePostSheet (edit) + CorePostPreviewSheet (preview)
          produced two visually different Sheets for the same thing.
          Now we always render CorePostSheet and hide the "תזמון פוסט"
          CTA when the user is in preview mode — they're already on
          /calendar, so the schedule affordance would loop. */}
      <CorePostSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) {
            setSheetData(null)
            setSheetInitialFormat(undefined)
          }
        }}
        post={sheetLoading ? null : sheetData}
        initialFormat={sheetInitialFormat}
        hideScheduleButton={sheetMode === "preview"}
        onScheduleClick={() => {
          // Always on /calendar — close the Sheet so the user can drop
          // the (now-queued) post into a slot. Friendlier than navigating.
          setSheetOpen(false)
        }}
      />

      {/* Format picker dialog — opens when the user drops a post that has
          more than one ready format. The picker is purely presentational;
          we drive open/close from `formatPicker` state and commit the
          schedule on confirm. */}
      {formatPicker && (
        <ScheduleFormatPicker
          open={!!formatPicker}
          onOpenChange={(open) => {
            if (!open) setFormatPicker(null)
          }}
          post={{
            corePostId: formatPicker.corePostId,
            displayText: formatPicker.displayText,
            formatStates: formatPicker.formatStates,
          }}
          targetLabel={formatPickerTargetLabel(
            formatPicker.targetDate,
            formatPicker.targetTime,
          )}
          onConfirm={handleConfirmFormatPick}
        />
      )}

    </AppShell>
  )
}
