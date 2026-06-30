"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  ChevronLeft,
  MoreVertical,
  PanelLeftOpen,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { QueuePanel } from "@/components/queue-panel"
import { CorePostSheet, type CorePostSheetData } from "@/components/core-post-sheet"
import { FormatThumbnail } from "@/components/format-thumbnail"
import {
  FormatStatusChip,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import {
  DEFAULT_SCHEDULED_TIME,
  TIMING_KEYS,
  getPublishedMap,
  getScheduledPosts,
  schedulePost,
  toDateKey,
  unmarkPublished,
  unschedulePost,
  type FormatId,
  type ScheduledPost,
} from "@/lib/timing-storage"

// Sunday-first because Israeli work week starts on Sunday. RTL flips the
// visual order so Sunday lands on the right edge — the user's natural start.
const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const

// The board no longer renders an hour grid (post-2026-06-30, Hani): each day
// is a single cell that holds its scheduled cards. A post's time is still
// tracked under the hood (queue/publish logic unchanged) — it's just not
// drawn as a row anymore. New drops land on DEFAULT_SCHEDULED_TIME.

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

/** Build the 7 days of the week starting at `weekStart`. */
function buildWeekGrid(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
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

// --- format card --------------------------------------------------------

/**
 * Day-cell card — ONE scheduled format in one time slot. Post-2026-06-24
 * spec (Hani): the calendar's unit is the (core post × format), not the
 * core post. A single core post scheduled on N formats paints N separate
 * cards, each carrying its own format identity, media thumbnail, and
 * reschedule / unschedule controls.
 *
 *   ┌─────────────────────────────────────┐
 *   │ 🎬  hook text (truncated)   ⋮  [▣]  │
 *   └─────────────────────────────────────┘
 *
 * This replaces the old multi-format chip (4 format icons + the
 * scheduled-here / scheduled-elsewhere / ready color-and-dashed logic),
 * which is all gone: a card is just "this format, scheduled here", so
 * there are no cross-slot states left to encode.
 *
 * Interactions:
 *   - Whole card is the drag handle → reschedule THIS format to another slot.
 *   - Click the card body → open the Sheet (preview) for the core post,
 *     landed on this format; the Sheet's "עריכה" button hands off to the
 *     /project edit screen.
 *   - Kebab → reschedule (date picker) / unschedule THIS format only.
 *   - Published format → opacity-60 on the whole card.
 */
function FormatCard({
  post,
  hook,
  mediaUrl,
  isPublished,
  onCardClick,
  onUnschedule,
  onReschedule,
}: {
  post: ScheduledPost
  /** Resolved hook text for the core post (live > snapshot > placeholder). */
  hook: string
  /** Per-(post, format) media URL for the thumbnail. Undefined → icon fallback. */
  mediaUrl?: string
  isPublished: boolean
  /** Click on the card body — open the preview Sheet for the core post. */
  onCardClick: () => void
  /** Kebab → "הסרת הפורמט". Unschedules THIS format at THIS slot. */
  onUnschedule: () => void
  /** Kebab → "תזמון לתאריך". Re-schedules THIS format to the picked date. */
  onReschedule: (newDate: string) => void
}) {
  const formatLabel = getFormatChipLabel(post.format)
  const publishedTitle = post.publishedAt
    ? `${formatLabel} · ${hook} — פורסם בתאריך ${new Date(post.publishedAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`
    : `${formatLabel} · ${hook}`

  // Local UI state for the date-picker dialog — only the picked date bubbles
  // up via onReschedule, so the parent doesn't need to know it exists.
  const [dateDialogOpen, setDateDialogOpen] = useState(false)

  return (
    <div
      // Whole card is the drag handle — stamps the (post, format) tuple so a
      // drop re-schedules exactly this format's row (upsert-keyed in storage).
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/x-scheduled-chip",
          JSON.stringify({ corePostId: post.corePostId, format: post.format }),
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
      aria-label={`${formatLabel} מתוזמן: ${hook}`}
      className={`group/chip relative w-full min-w-0 flex flex-col gap-1.5 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 p-1.5 cursor-grab active:cursor-grabbing transition-all hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
        isPublished ? "opacity-60" : ""
      }`}
    >
      {/* Media — a small portrait slot mirroring the queue / core-post card
          (aspect 4:5). Carousel (square) assets show fully (contain + padding);
          everything else covers. A Drive-link-only format falls back to the
          format icon on a neutral gray box. */}
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-gray-95">
        <FormatThumbnail
          url={mediaUrl}
          format={post.format}
          className="size-full"
          iconClassName="size-5"
          fallbackClassName="bg-gray-95"
          fit={post.format === "carousel" ? "contain" : "cover"}
        />

        {/* Kebab — hover/focus revealed, top-end over the media. Swallows
            click + pointer + keydown so the outer card's onClick / dragstart
            never fire while the menu is in use. */}
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") e.stopPropagation()
              }}
              aria-label="פעולות"
              className="absolute top-1 end-1 z-10 size-5 rounded bg-white/90 text-text-neutral-default hover:bg-white hover:text-text-primary-default inline-flex items-center justify-center shadow-sm transition-all opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              <MoreVertical className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="left"
            align="start"
            sideOffset={6}
            className="min-w-[180px]"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem className="text-xs" onSelect={() => setDateDialogOpen(true)}>
              תזמון לתאריך
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              variant="destructive"
              onSelect={() => onUnschedule()}
            >
              הסרת הפורמט
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Text — hook + format chip, mirroring the queue card (compact). */}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="line-clamp-2 text-xs-body leading-tight text-text-primary-default">
          {hook}
        </p>
        <div className="flex">
          <FormatStatusChip format={post.format} state="ready" size="xs" />
        </div>
      </div>

      {/* Re-schedule date picker. Portalled by Radix, so it sits outside the
          card's DOM and the card's onClick / drag handlers don't fire while
          the user is picking a date. */}
      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
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
  )
}

/* ------------------------------------------------------------------ */
/*  MiniMonthCalendar                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compact month grid used inside the FormatCard's "תזמון לתאריך"
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
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today))

  // Queue rail collapse. Owned here (not in QueuePanel) because the rail's
  // width is reserved as `pe-[480px]` on the layout container below — the two
  // must move together, so a single source of truth drives both the panel's
  // slide-out and the grid's widening.
  const [panelCollapsed, setPanelCollapsed] = useState(false)

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
  // Per-(post, format) media URL — drives the thumbnail on each format card.
  // Sourced from the same /api/core-posts list as the hooks; the list
  // endpoint now returns a `format_media` map (format → first non-cover URL,
  // video preferred). A format that's "ready" only via a Drive link has no
  // entry here and the card falls back to its format icon.
  const [formatMediaByPost, setFormatMediaByPost] = useState<
    Map<string, Record<string, string>>
  >(new Map())
  useEffect(() => {
    let cancelled = false
    fetch("/api/core-posts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const hookMap = new Map<string, string>()
        const mediaMap = new Map<string, Record<string, string>>()
        type ApiPost = {
          id: string
          hook_text?: string | null
          title?: string | null
          format_media?: Record<string, string> | null
        }
        for (const p of (data.posts ?? []) as ApiPost[]) {
          if (!p.id) continue
          const text = p.hook_text?.trim() || p.title?.trim()
          if (text) hookMap.set(p.id, text)
          if (p.format_media) mediaMap.set(p.id, p.format_media)
        }
        setHookByPostId(hookMap)
        setFormatMediaByPost(mediaMap)
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

  // Group scheduled posts by day (YYYY-MM-DD) so each day-cell lookup is
  // O(1). Within a day we sort by time so earlier posts sit on top — the
  // time is still tracked even though the board no longer shows an hour grid.
  const postsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>()
    for (const post of scheduled) {
      const list = map.get(post.scheduledDate) ?? []
      list.push(post)
      map.set(post.scheduledDate, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? ""),
      )
    }
    return map
  }, [scheduled])

  const goPrev = () => setWeekStart((d) => addDays(d, -7))
  const goNext = () => setWeekStart((d) => addDays(d, 7))
  const goThisWeek = () => setWeekStart(startOfWeek(today))

  // --- DnD handlers ------------------------------------------------------
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    day: Date,
    dayKey: string,
  ) => {
    if (isPastDate(day, today)) return // past day: no preventDefault → drop disallowed
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dragOverDay !== dayKey) setDragOverDay(dayKey)
  }

  const handleDragLeave = (dayKey: string) => {
    if (dragOverDay === dayKey) setDragOverDay(null)
  }

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    day: Date,
    dayKey: string,
  ) => {
    if (isPastDate(day, today)) return
    e.preventDefault()
    setDragOverDay(null)

    // Source 1: card-to-card reschedule. A scheduled card stamps this MIME
    // type on dragstart with `{corePostId, format}` — the (post, format)
    // tuple is the unique key for a scheduled row. We keep the row's existing
    // time and only move the date; re-running schedulePost upserts it in
    // place (same key), so the card moves to this day. Same-day drop is a no-op.
    const rescheduleRaw = e.dataTransfer.getData(
      "application/x-scheduled-chip",
    )
    if (rescheduleRaw) {
      try {
        const { corePostId, format } = JSON.parse(rescheduleRaw) as {
          corePostId: string
          format: FormatId
        }
        const existing = scheduled.find(
          (p) => p.corePostId === corePostId && p.format === format,
        )
        const time = existing?.scheduledTime ?? DEFAULT_SCHEDULED_TIME
        schedulePost(corePostId, format, dayKey, time)
      } catch (err) {
        console.error("[calendar] failed to parse reschedule payload", err)
      }
      return
    }

    // Source 2: a single ready-format card dragged from the queue rail. The
    // rail is now per-format, so a drop schedules exactly that one format —
    // no picker. The payload carries the resolved hook so the new card can
    // render it without a refetch. Lands on the default time for the day.
    const readyRaw = e.dataTransfer.getData("application/x-ready-format")
    if (readyRaw) {
      try {
        const { corePostId, format, hook } = JSON.parse(readyRaw) as {
          corePostId: string
          format: FormatId
          hook?: string | null
        }
        const trimmed = hook?.trim()
        schedulePost(
          corePostId,
          format,
          dayKey,
          DEFAULT_SCHEDULED_TIME,
          trimmed ? { hook: trimmed } : undefined,
        )
      } catch (err) {
        console.error("[calendar] failed to parse ready-format payload", err)
      }
    }
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

  // Deep link from the /project schedule toast: `/calendar?post_id=<id>`
  // opens that post's side panel straight away so the user lands ready to
  // schedule, not on a blank calendar. Read once on mount via the URL (no
  // useSearchParams → no Suspense boundary needed), then strip the param so
  // a later refresh doesn't force the panel back open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pid = params.get("post_id")
    if (!pid) return
    openSheetForCorePost(pid)
    const url = new URL(window.location.href)
    url.searchParams.delete("post_id")
    window.history.replaceState({}, "", url.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppShell>
      {/*
        Two-column layout in a single full-height column container.
        The AppShell <main> sets `pt-8 px-6 pb-6` and lets the area
        scroll vertically. To make the queue panel a full-height rail, we
        size THIS container to fill the available height (viewport minus
        the AppShell padding) and lay out a horizontal row of:
          - calendar column (header + week nav + grid card) → takes remaining width
          - queue panel → shrink-0 320px, h-full, scrolls its own list
        The calendar column itself is a flex-col so the grid card can grow
        to fill the height alongside the panel.
      */}
      <div
        // Reserve 480px on the visual end (left in RTL) for the
        // QueuePanel. The rail renders its ready-format cards two-up; at
        // 480 each column is ≈218px — the same width as a /core_posts
        // grid card. Must match the panel's own `w-[480px]` or the
        // calendar grid renders underneath it. When the rail is collapsed
        // the padding animates to 0 (in lockstep with the rail's slide-out)
        // so the week grid expands to full width.
        className={`w-full flex gap-5 h-[calc(100vh-2rem-3rem)] min-h-0 transition-[padding] duration-300 ease-in-out ${
          panelCollapsed ? "pe-0" : "pe-[480px]"
        }`}
        dir="rtl"
      >
        {/* Calendar column — header + week nav at standard page width,
            grid card stretches to full width below. */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Header at the standard page width — keeps the title aligned
              with the rest of the system. */}
          <div className="max-w-[1200px] w-full mx-auto">
            {/* Level 1 — page identity. Title + leading illustration,
                matching /core_posts + /hooks. Subtitle intentionally
                omitted per Hani. */}
            <div className="flex items-center gap-2 mb-6">
              <img
                src="/images/calendar-min.png"
                alt=""
                className="w-[48px] h-[48px]"
              />
              <h2 className="text-text-primary-default">תזמון</h2>
            </div>

            {/* Level 2 — week navigation. */}
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Button variant="ghost" size="icon-sm" onClick={goPrev} aria-label="שבוע קודם">
                  <ChevronRight className="size-4" />
                </Button>
                <span className="text-[16px] leading-none font-medium text-text-primary-default text-center px-1 tabular-nums">
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
          <div className="flex-1 min-h-0 min-w-0 -ms-6 -me-6 -mb-6 border-y border-border-neutral-default bg-white dark:bg-gray-10 overflow-hidden flex flex-col">
            {/* Top strip — 7 day labels, one per column. No hours column:
                the board is a day-grid now, each day a single tall cell.
                `z-20` keeps the headers above the dragOver ring (z-10). */}
            <div className="shrink-0 z-20 grid grid-cols-7 bg-bg-surface border-b border-border-neutral-default">
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

            {/* Body — 7 day columns, each ONE cell that fills the height and
                scrolls its own stack of cards. No hour rows: a card is just
                "this format, scheduled on this day". Dropping anywhere in a
                column schedules to that day (the time is kept under the hood). */}
            <div className="grid grid-cols-7 flex-1 min-h-0">
              {days.map((day, i) => {
                const dayKey = toDateKey(day)
                const isToday = isSameDay(day, today)
                const dayOfWeek = day.getDay()
                const isLastCol = i === days.length - 1
                const past = isPastDate(day, today)
                const isDragOver = dragOverDay === dayKey
                const dayPosts = postsByDay.get(dayKey) ?? []

                // Today gets a very subtle warm tint (yellow-95 at 40%) —
                // visible enough to read as "this is today" but light enough
                // that the column still looks interactive (droppable).
                const dayBg = isToday
                  ? "bg-yellow-95/40"
                  : "bg-white dark:bg-gray-10"

                return (
                  <div
                    key={day.toISOString()}
                    onDragOver={(e) => handleDragOver(e, day, dayKey)}
                    onDragLeave={() => handleDragLeave(dayKey)}
                    onDrop={(e) => handleDrop(e, day, dayKey)}
                    aria-label={`${WEEKDAY_LABELS[dayOfWeek]} ${day.getDate()}${isToday ? " — היום" : ""}${past ? " — תאריך שעבר" : ""}`}
                    className={`relative overflow-y-auto scrollbar-subtle min-w-0 transition-colors ${isLastCol ? "" : "border-l"} border-border-neutral-default ${dayBg} ${
                      isDragOver ? "ring-2 ring-inset ring-yellow-50 bg-bg-surface-hover z-10" : ""
                    } ${past ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    {/* Cards stack from the top. `min-h-full` keeps the whole
                        column a drop target even when it's nearly empty. */}
                    <div className="flex flex-col gap-1.5 p-2 min-h-full">
                      {dayPosts.map((post) => {
                        const isPublished = publishedSet.has(
                          `${post.corePostId}:${post.format}`,
                        )
                        // Prefer the live hook over the snapshot persisted at
                        // schedule time, then a placeholder.
                        const hook =
                          (
                            hookByPostId.get(post.corePostId) ||
                            post.hook ||
                            ""
                          ).trim() || "פוסט מתוזמן"
                        const mediaUrl = formatMediaByPost.get(
                          post.corePostId,
                        )?.[post.format]
                        return (
                          <FormatCard
                            key={`${post.corePostId}:${post.format}`}
                            post={post}
                            hook={hook}
                            mediaUrl={mediaUrl}
                            isPublished={isPublished}
                            onCardClick={() =>
                              openSheetForCorePost(
                                post.corePostId,
                                post.format,
                                "preview",
                              )
                            }
                            onUnschedule={() => {
                              // Send THIS format back to the queue and drop
                              // its stale published mark (returning a format
                              // means "it isn't done yet").
                              unschedulePost(post.corePostId, post.format)
                              unmarkPublished(post.corePostId, post.format)
                              toast.success("הפורמט הוחזר לתור")
                            }}
                            onReschedule={(newDate) => {
                              // Move THIS format to the picked date, keeping
                              // its current time.
                              const time =
                                post.scheduledTime ?? DEFAULT_SCHEDULED_TIME
                              schedulePost(
                                post.corePostId,
                                post.format,
                                newDate,
                                time,
                                { hook },
                              )
                              toast.success("התזמון עודכן")
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {/* /Calendar column */}

        {/* Queue panel — full-height rail on the visual end (left in RTL).
            Sibling of the calendar column inside the outer flex row, so it
            stretches to the full container height (`h-[calc(100vh-2rem-3rem)]`).
            The panel itself uses `h-full` so its inner list scrolls
            independently of the calendar grid. */}
        <QueuePanel
          collapsed={panelCollapsed}
          onToggleCollapse={() => setPanelCollapsed((v) => !v)}
          onItemClick={(corePostId, format) =>
            openSheetForCorePost(corePostId, format, "preview")
          }
        />

        {/* Reopen affordance — shown only while the rail is collapsed. Pinned
            to the end edge (left in RTL) just below the topbar, where the
            rail's collapse button sat, so the open/close controls live on
            the same edge. z-40 keeps it above the grid's dragOver ring. */}
        {panelCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPanelCollapsed(false)}
                aria-label="פתיחת פאנל הפוסטים לתזמון"
                className="fixed top-20 end-3 z-40 bg-white dark:bg-gray-10 shadow-sm"
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">פוסטים לתזמון</TooltipContent>
          </Tooltip>
        )}
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

    </AppShell>
  )
}
