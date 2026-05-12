"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  Pencil,
  Move,
  XCircle,
} from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { createClient } from "@/lib/supabase/client"
import { isOwner } from "@/lib/owner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { toast } from "sonner"
import { QueuePanel } from "@/components/queue-panel"
import { CorePostSheet, type CorePostSheetData } from "@/components/core-post-sheet"
import { CorePostPreviewSheet } from "@/components/core-post-preview-sheet"
import { ScheduleFormatPicker } from "@/components/schedule-format-picker"
import {
  getFormatChipClasses,
  getFormatChipIcon,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import {
  DEFAULT_SCHEDULED_TIME,
  TIMING_KEYS,
  getFormatReadiness,
  getPublishedMap,
  getScheduledPosts,
  markPublished,
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
 * Day-cell chip — interactive surface for a single scheduled post.
 *
 * Anatomy (RTL):
 *   [✓ checkbox] [icon] [hook text]                              [...menu]
 *
 * Published state:
 *   - opacity-60 on the chip
 *   - ✓ icon next to the checkbox
 *   - title attr surfaces "פורסם בתאריך X" on hover
 *
 * Click behavior:
 *   - Click on the body area → open Sheet (parent callback)
 *   - Click on checkbox → toggle published (local + storage)
 *   - Click on "..." → dropdown menu (edit / move / unschedule)
 */
function ScheduledChip({
  post,
  isPublished,
  onClick,
  onTogglePublished,
  onEdit,
  onMove,
  onUnschedule,
}: {
  post: ScheduledPost
  isPublished: boolean
  onClick: () => void
  onTogglePublished: () => void
  onEdit: () => void
  onMove: () => void
  onUnschedule: () => void
}) {
  // Per Hani: only past-dated posts can be marked as published. A user
  // can't have "published" something that hasn't aired yet — so until
  // the slot's datetime has passed, the checkbox is disabled. Already
  // published posts stay enabled so the user can un-mark a mistake.
  const slotDatetime = (() => {
    try {
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(post.scheduledDate)
      if (!ymd) return null
      const [hh, mm] = (post.scheduledTime ?? DEFAULT_SCHEDULED_TIME)
        .split(":")
        .map((s) => parseInt(s, 10))
      return new Date(
        Number(ymd[1]),
        Number(ymd[2]) - 1,
        Number(ymd[3]),
        Number.isFinite(hh) ? hh : 9,
        Number.isFinite(mm) ? mm : 0,
      )
    } catch {
      return null
    }
  })()
  const slotIsPast = slotDatetime ? slotDatetime.getTime() <= Date.now() : false
  const canTogglePublished = isPublished || slotIsPast
  // Phase 4: per-chip format identity. Icon + short Hebrew label come from
  // the shared `format-status-chip` helpers, so day-cell chips speak the
  // same visual language as the Sheet header and the queue panel. The hook
  // text moved to a `title` attribute (and aria-label) — the chip surface
  // is too narrow for two lines of hook text once we also carry the format
  // tag and the time, and the user already recognizes the post by its
  // format+time at a glance.
  const FormatIcon = getFormatChipIcon(post.format)
  const formatLabelShort = getFormatChipLabel(post.format)
  const timeLabel = post.scheduledTime ?? DEFAULT_SCHEDULED_TIME
  const hookLabel = post.hook?.trim() || "פוסט מתוזמן"
  const publishedTitle = post.publishedAt
    ? `${hookLabel} — פורסם בתאריך ${new Date(post.publishedAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`
    : hookLabel

  // PHASE-3 INTERIM: per-format color identity (see format-status-chip.tsx
  // file header). `published` chips use the published variant + opacity-60;
  // active scheduled chips use the scheduled variant + a hover deepening.
  // No green V badge here — published is already legible from opacity +
  // checkbox state, and adding a corner badge would crowd the cell.
  const chipClasses = getFormatChipClasses(
    post.format,
    isPublished ? "published" : "scheduled",
  )

  return (
    <div
      // The whole chip is the drag handle so the user can pick it up from
      // any "blank" pixel (icon, label, gap). The inner buttons keep their
      // own click handlers — a click without movement is still a click; a
      // mousedown + move starts the native drag. Reschedule data goes on a
      // dedicated MIME type so the calendar drop handler can tell a
      // reschedule from a queue-panel drop.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/x-scheduled-chip",
          JSON.stringify({ corePostId: post.corePostId, format: post.format }),
        )
        e.dataTransfer.effectAllowed = "move"
      }}
      className={`group/chip relative w-full h-full min-w-0 flex items-center gap-1 ps-1 pe-6 py-1 rounded-md border ${chipClasses.container} text-xs-body overflow-hidden cursor-grab active:cursor-grabbing transition-all ${
        isPublished ? "opacity-60" : chipClasses.hover
      }`}
      title={publishedTitle}
    >
      {/* Checkbox at the visual start (right in RTL) — sized to fit the 14px
          chip rhythm. Disabled for future slots (per Hani: you can only
          mark "published" once the time has actually passed). */}
      <Checkbox
        checked={isPublished}
        onCheckedChange={onTogglePublished}
        onClick={(e) => e.stopPropagation()}
        disabled={!canTogglePublished}
        aria-label={
          !canTogglePublished
            ? "אפשר לסמן כפורסם רק אחרי שעבר התאריך"
            : isPublished
              ? "בטלו סימון פרסום"
              : "סמנו כפורסם"
        }
        className="size-4 shrink-0"
      />

      {/* Body — the click target for opening the Sheet. The visible label
          is "{format} · HH:MM" so the user reads format identity FIRST and
          time SECOND. Hook text is in title/aria-label for full context
          without squeezing the chip layout. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        aria-label={`${formatLabelShort} בשעה ${timeLabel} — ${hookLabel}`}
        className="flex items-center gap-1 flex-1 min-w-0 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-sm"
      >
        <FormatIcon className="size-3 shrink-0" aria-hidden />
        <span className="truncate text-right flex-1 min-w-0 leading-tight tabular-nums">
          {formatLabelShort} · {timeLabel}
        </span>
      </button>

      {/* "..." dropdown — absolutely positioned at the end (left in RTL) so
          it doesn't add intrinsic min-width to the flex row. Without this,
          on narrow day columns the chip's `shrink-0` items combine to push
          past the column width. The chip already reserves space via `pe-6`. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label="עוד פעולות"
            // Neutral overlay (`hover:bg-black/10`) instead of a hard yellow
            // — the chip's bg color now varies per format, so a fixed-hue
            // hover would clash. A transparent darken reads consistently
            // on top of any of the four families.
            className="absolute end-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 transition-opacity"
          >
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuItem onSelect={onEdit} className="gap-2 text-right justify-end">
            <span>עריכה</span>
            <Pencil className="size-3.5" />
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onMove} className="gap-2 text-right justify-end">
            <span>העברת תאריך</span>
            <Move className="size-3.5" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onUnschedule} className="gap-2 text-right justify-end text-button-destructive-default">
            <span>ביטול תזמון</span>
            <XCircle className="size-3.5" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// --- page ----------------------------------------------------------------

export default function CalendarPage() {
  // Owner gate. The /calendar surface is intentionally limited to the
  // owner only — every other user gets bounced home. `granted` starts
  // null so we render an empty shell while the auth check resolves,
  // and never flash the calendar grid to a non-owner before the redirect.
  const router = useRouter()
  const [granted, setGranted] = useState<boolean | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isOwner(user?.email)) {
        setGranted(true)
      } else {
        setGranted(false)
        router.replace("/")
      }
    })
  }, [router])

  // We hold "today" and "now" in state so they stay stable across re-renders
  // within a session. (Re-computing on every render would make `isToday`
  // flicker if a render straddled midnight — rare, but cheap to avoid.)
  const [today] = useState<Date>(() => startOfDay(new Date()))
  const [currentHour] = useState<number>(() => new Date().getHours())
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

  // "Move to another day" picker — date+time inputs are simpler than a
  // popover + month grid for a P2 task, and fully keyboard/mobile accessible.
  const [moveDialog, setMoveDialog] = useState<{
    corePostId: string
    format: FormatId
    date: string
    time: string
  } | null>(null)

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
    for (const format of formats) {
      schedulePost(
        formatPicker.corePostId,
        format,
        formatPicker.targetDate,
        formatPicker.targetTime,
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

  // --- chip menu actions -------------------------------------------------
  const handleTogglePublished = (
    corePostId: string,
    format: FormatId,
    currentlyPublished: boolean,
  ) => {
    if (currentlyPublished) {
      unmarkPublished(corePostId, format)
      return
    }
    markPublished(corePostId, format)
    toast.success("הפוסט סומן כפורסם")
  }

  const handleUnschedule = (corePostId: string, format: FormatId) => {
    // Removes the scheduled slot for THIS format. The post itself still
    // exists; the queue panel will pick it up automatically because it
    // filters server posts by SCHEDULED_KEY membership.
    unschedulePost(corePostId, format)
  }

  const openMoveDialog = (post: ScheduledPost) => {
    setMoveDialog({
      corePostId: post.corePostId,
      format: post.format,
      date: post.scheduledDate,
      time: post.scheduledTime ?? DEFAULT_SCHEDULED_TIME,
    })
  }

  const confirmMove = () => {
    if (!moveDialog) return
    schedulePost(
      moveDialog.corePostId,
      moveDialog.format,
      moveDialog.date,
      moveDialog.time,
    )
    setMoveDialog(null)
  }

  // Owner gate render-time guard. Until the auth check resolves to "yes,
  // owner", render nothing inside the shell — that way a non-owner who
  // direct-navigates to /calendar never sees the grid before the redirect
  // fires, and the owner sees a blank flash for one paint instead of stale
  // calendar state.
  if (granted !== true) {
    return <AppShell><div /></AppShell>
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
        className="w-full flex gap-5 h-[calc(100vh-72px-3rem)] min-h-0 pe-[400px]"
        dir="rtl"
      >
        {/* Calendar column — header + week nav at standard page width,
            grid card stretches to full width below. */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Header at the standard page width — keeps the title aligned
              with the rest of the system. */}
          <div className="max-w-[1200px] w-full mx-auto">
            {/* Level 1 — page identity. Title + static subtitle that
                explains the JTBD ("what can I do here?"). Matches the
                rest of the app: h2 with no leading icon. */}
            <div className="flex flex-col gap-1.5 mb-6">
              <h2 className="text-text-primary-default">תזמון</h2>
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
                    className={`px-3 py-2.5 text-center ${isLastCol ? "" : "border-l"} border-border-neutral-default ${
                      isToday ? "bg-bg-surface" : ""
                    }`}
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

            {/* Body — hours column + 7 day columns. */}
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

                const dayBg = isToday
                  ? "bg-bg-surface"
                  : "bg-white dark:bg-gray-10"

                return (
                  <div
                    key={day.toISOString()}
                    className={`grid grid-rows-[repeat(17,3.5rem)] min-w-0 ${isLastCol ? "" : "border-l"} border-border-neutral-default ${dayBg}`}
                  >
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
                          className={`relative p-1 min-w-0 overflow-hidden transition-colors ${isLastRow ? "" : "border-b"} border-border-neutral-default ${
                            isDragOver ? "ring-2 ring-inset ring-yellow-50 bg-bg-surface-hover z-10" : ""
                          } ${isPast ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                          {slotPosts.map((post) => {
                            const isPublished = publishedSet.has(
                              `${post.corePostId}:${post.format}`,
                            )
                            return (
                              <ScheduledChip
                                key={`${post.corePostId}:${post.format}`}
                                post={post}
                                isPublished={isPublished}
                                // Per Hani: a chip on the calendar is an
                                // already-scheduled item — clicking it is
                                // an edit affordance, not a preview. The
                                // minimal preview Sheet is reserved for
                                // queue rows (where the post hasn't been
                                // committed yet). Same applies to the
                                // chip menu's "ערכו" action.
                                onClick={() =>
                                  openSheetForCorePost(
                                    post.corePostId,
                                    post.format,
                                    "edit",
                                  )
                                }
                                onTogglePublished={() =>
                                  handleTogglePublished(
                                    post.corePostId,
                                    post.format,
                                    isPublished,
                                  )
                                }
                                onEdit={() =>
                                  openSheetForCorePost(
                                    post.corePostId,
                                    post.format,
                                    "edit",
                                  )
                                }
                                onMove={() => openMoveDialog(post)}
                                onUnschedule={() =>
                                  handleUnschedule(post.corePostId, post.format)
                                }
                              />
                            )
                          })}
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

      {/* Sheets — two surfaces sharing the same data hydration:
          - "edit" mode (calendar-grid chip) → full editable Sheet.
          - "preview" mode (queue panel row) → read-only discovery Sheet. */}
      {sheetMode === "edit" ? (
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
          onScheduleClick={() => {
            // Already on /calendar — close the Sheet so the user can drop
            // the (now-queued) post into a slot. Friendlier than navigating.
            setSheetOpen(false)
          }}
        />
      ) : (
        <CorePostPreviewSheet
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
        />
      )}

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

      {/* Move dialog — date + time picker. Native inputs keep keyboard +
          mobile UX consistent without pulling in a date library. */}
      <Dialog
        open={!!moveDialog}
        onOpenChange={(open) => {
          if (!open) setMoveDialog(null)
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>העבירו ליום אחר</DialogTitle>
          </DialogHeader>
          {moveDialog && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="move-date" className="text-small text-text-primary-default">
                  תאריך
                </Label>
                <Input
                  id="move-date"
                  inputSize="small"
                  type="date"
                  value={moveDialog.date}
                  min={toDateKey(today)}
                  onChange={(e) =>
                    setMoveDialog((m) => (m ? { ...m, date: e.target.value } : m))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="move-time" className="text-small text-text-primary-default">
                  שעה
                </Label>
                <Select
                  id="move-time"
                  selectSize="small"
                  value={moveDialog.time}
                  onChange={(e) =>
                    setMoveDialog((m) => (m ? { ...m, time: e.target.value } : m))
                  }
                >
                  {HOURS.map((h) => {
                    const v = `${String(h).padStart(2, "0")}:00`
                    return (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    )
                  })}
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="flex flex-row-reverse gap-2 w-full sm:justify-start">
            <Button onClick={confirmMove} className="flex-1">
              העבירו
            </Button>
            <Button variant="outline" onClick={() => setMoveDialog(null)} className="flex-1">
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
