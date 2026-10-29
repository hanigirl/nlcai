"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  ChevronLeft,
  MoreVertical,
  PanelLeftOpen,
} from "lucide-react"
import Link from "next/link"
import {
  usePostingSchedule,
} from "@/components/posting-schedule-parts"
import {
  GhostSlot,
  RoutineButton,
  RoutineDayEditor,
  RoutineEditBar,

  unfilledSlots,
} from "@/components/calendar-routine"
import { defaultPostingSchedule, slotsForDate } from "@/lib/posting-schedule"
import { AppShell } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { checkSlot, ScheduleDateTimePicker } from "@/components/schedule-date-time-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { QueuePanel, type QueueApprovalMode } from "@/components/queue-panel"
import { FormatPreviewDialog } from "@/components/format-preview/format-preview-dialog"
import {
  canvasHref,
  type FormatPreviewData,
  type PreviewContentState,
  type PreviewSlide,
  type PublishStatus as PreviewPublishStatus,
} from "@/components/format-preview/shared"
import { usePreviewAccess, useScheduleAllA, useSchedulingAccess } from "@/lib/use-scheduling-access"
import {
  hasAnySlot,
  planScheduleAll,
  type PlanInputCard,
  type PlannedSlot,
} from "@/lib/schedule-all"
import { NoSettingsDialog, PreviewBar, ScheduleAllButton } from "@/components/schedule-all"
import { CorePostSheet, type CorePostSheetData } from "@/components/core-post-sheet"
import { FormatThumbnail } from "@/components/format-thumbnail"
import { InstagramConnectionControl } from "@/components/instagram-connect"
import { PublishStatusLine } from "@/components/publish-status"
import { useInstagramConnection, type InstagramConnection } from "@/lib/instagram-connection"
import { isSlotTooSoon } from "@/lib/social/slot-time"
import {
  FormatStatusChip,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import {
  DEFAULT_SCHEDULED_TIME,
  TIMING_KEYS,
  getFormatMeta,
  getPublishedMap,
  getScheduledPosts,
  markPublished,
  retryPublish,
  refreshPublishStatus,
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
/**
 * A post "סידור אוטומטי בלוח" laid on the board, not scheduled yet: dashed,
 * no menu. Can be dragged to another day before "תזמון כל הפוסטים".
 */
function PlannedCard({
  slot,
  likeScheduled = false,
  onOpen,
}: {
  slot: PlannedSlot
  likeScheduled?: boolean
  /** Opens the post's edit modal, as a click on a scheduled card does (Hani, 2026-10-29). */
  onOpen?: () => void
}) {
  const formatLabel = getFormatChipLabel(slot.format)
  // A click opens the post; a drag still moves it (the browser fires no click after a drag).
  const open = onOpen
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onOpen()
          }
        },
      }
    : {}
  // Direction A (Hani, 2026-10-29): a draft is the scheduled card exactly —
  // image, time badge, hook, chip — and only the dashed border tells it apart.
  if (likeScheduled) {
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/x-schedule-ghost",
            JSON.stringify({ corePostId: slot.corePostId, format: slot.format }),
          )
          e.dataTransfer.effectAllowed = "move"
        }}
        {...open}
        aria-label={`${formatLabel} טיוטה, עוד לא תוזמן: ${slot.hook}`}
        className="relative w-full min-w-0 flex flex-col gap-1.5 rounded-lg border border-dashed border-gray-70 bg-white dark:bg-gray-10 p-1.5 cursor-grab active:cursor-grabbing transition-all hover:bg-bg-surface-hover hover:border-gray-80"
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-gray-95">
          <FormatThumbnail
            url={slot.mediaUrl}
            format={slot.format}
            className="size-full"
            iconClassName="size-5"
            fallbackClassName="bg-gray-95"
            fit={slot.format === "carousel" ? "contain" : "cover"}
          />
          <Badge className="absolute top-1 start-1 z-10 bg-button-primary-default text-white dark:text-gray-10 tabular-nums">
            {slot.scheduledTime}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="line-clamp-2 text-xs-body leading-tight text-text-primary-default">{slot.hook}</p>
          <div className="flex">
            <FormatStatusChip format={slot.format} state="ready" size="xs" />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/x-schedule-ghost",
          JSON.stringify({ corePostId: slot.corePostId, format: slot.format }),
        )
        e.dataTransfer.effectAllowed = "move"
      }}
      {...open}
      aria-label={`${formatLabel} מוצע לתזמון, עוד לא תוזמן: ${slot.hook}`}
      className="relative w-full min-w-0 flex flex-col gap-1.5 rounded-lg border border-dashed border-gray-70 bg-bg-surface dark:bg-gray-20 p-1.5 cursor-grab active:cursor-grabbing transition-all hover:bg-gray-95 hover:border-gray-80"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-gray-95 opacity-70">
        <FormatThumbnail
          url={slot.mediaUrl}
          format={slot.format}
          className="absolute inset-0 w-full h-full"
          iconClassName="size-5"
          fit={slot.format === "carousel" ? "contain" : "cover"}
        />
      </div>
      <div className="flex flex-col gap-1 px-0.5">
        <p className="line-clamp-2 text-xs-body leading-tight text-text-primary-default">{slot.hook}</p>
        <div className="flex items-center gap-1 flex-wrap">
          <FormatStatusChip format={slot.format} state="ready" size="xs" />
          <span className="text-[10px] leading-none text-text-neutral-default tabular-nums">
            {slot.scheduledTime} · עוד לא תוזמן
          </span>
        </div>
      </div>
    </div>
  )
}

function FormatCard({
  post,
  hook,
  mediaUrl,
  isPublished,
  selected,
  past = false,
  onCardClick,
  onUnschedule,
  onReschedule,
  showPublish,
  connection,
  onConnectInstagram,
  onFixMedia,
}: {
  post: ScheduledPost
  /** Resolved hook text for the core post (live > snapshot > placeholder). */
  hook: string
  /** Per-(post, format) media URL for the thumbnail. Undefined → icon fallback. */
  mediaUrl?: string
  isPublished: boolean
  /** Format preview (`?preview=b`) — this card's preview is the one open. */
  selected?: boolean
  /** The slot's time has passed — disabled: faded, no drag, no menu. */
  past?: boolean
  /** Click on the card body — open the preview Sheet for the core post. */
  onCardClick: () => void
  /** Kebab → "הסרת הפורמט". Unschedules THIS format at THIS slot. */
  onUnschedule: () => void
  /** Kebab → "תזמון לתאריך". Re-schedules THIS format to the picked date + time. */
  onReschedule: (newDate: string, newTime: string) => void
  /** Scheduling release: show where this slot stands with Instagram. */
  showPublish: boolean
  /** Shared Instagram connection state — drives the publish-status line. */
  connection: InstagramConnection
  /** Opens the shared Instagram connection modal (the card's "reconnect"). */
  onConnectInstagram: () => void
  /** Takes her to where this format's media is edited. */
  onFixMedia: () => void
}) {
  const formatLabel = getFormatChipLabel(post.format)
  const publishedTitle = post.publishedAt
    ? `${formatLabel} · ${hook} — פורסם בתאריך ${new Date(post.publishedAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`
    : `${formatLabel} · ${hook}`

  // Local UI state for the date-picker dialog — only the picked date bubbles
  // up via onReschedule, so the parent doesn't need to know it exists.
  const [dateDialogOpen, setDateDialogOpen] = useState(false)
  const currentTime = post.scheduledTime ?? DEFAULT_SCHEDULED_TIME
  const [pickedDate, setPickedDate] = useState(post.scheduledDate)
  const [pickedTime, setPickedTime] = useState(currentTime)
  const [slotError, setSlotError] = useState<string | null>(null)
  const openDateDialog = () => {
    setPickedDate(post.scheduledDate)
    setPickedTime(currentTime)
    setSlotError(null)
    setDateDialogOpen(true)
  }

  return (
    <div
      // Whole card is the drag handle — stamps the (post, format) tuple so a
      // drop re-schedules exactly this format's row (upsert-keyed in storage).
      draggable={!past}
      onDragStart={(e) => {
        if (past) return
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
      aria-disabled={past || undefined}
      className={`group/chip relative w-full min-w-0 flex flex-col gap-1.5 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 p-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
        past
          ? "opacity-50 grayscale cursor-pointer"
          : "cursor-grab active:cursor-grabbing hover:bg-bg-surface-hover hover:border-gray-80 hover:ring-2 hover:ring-gray-80/30"
      } ${isPublished && !past ? "opacity-60" : ""}${selected ? " ring-2 ring-yellow-50 border-yellow-50" : ""}`}
      aria-current={selected || undefined}
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

        {/* The slot's time, readable without opening the post (Hani,
            2026-10-22): the app's Badge in the primary-button colour, white
            text, time only. Top-start; the kebab owns top-end. */}
        <Badge className="absolute top-1 start-1 z-10 bg-button-primary-default text-white dark:text-gray-10 tabular-nums">
          {post.scheduledTime ?? DEFAULT_SCHEDULED_TIME}
        </Badge>

        {/* Kebab — hover/focus revealed, top-end over the media. Swallows
            click + pointer + keydown so the outer card's onClick / dragstart
            never fire while the menu is in use. */}
        {!past && (
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
            <DropdownMenuItem className="text-xs" onSelect={openDateDialog}>
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
        )}
      </div>

      {/* Text — hook + format chip, mirroring the queue card (compact). */}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="line-clamp-2 text-xs-body leading-tight text-text-primary-default">
          {hook}
        </p>
        <div className="flex">
          <FormatStatusChip format={post.format} state="ready" size="xs" />
        </div>
        {/* Where this slot stands with Instagram — "תוזמן" only when the
            provider holds it, otherwise what's wrong and one way to fix it. */}
        {showPublish && <PublishStatusLine
          post={post}
          connection={connection}
          onConnect={onConnectInstagram}
          onPickTime={() => setDateDialogOpen(true)}
          onFixMedia={onFixMedia}
        />}
      </div>

      {/* Re-schedule date picker. Portalled by Radix, so it sits outside the
          card's DOM and the card's onClick / drag handlers don't fire while
          the user is picking a date. */}
      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>תזמון לתאריך</DialogTitle>
          </DialogHeader>
          <ScheduleDateTimePicker
            idBase={`${post.corePostId}-${post.format}`}
            anchorDate={post.scheduledDate}
            date={pickedDate}
            time={pickedTime}
            onDateChange={(d) => {
              setPickedDate(d)
              setSlotError(null)
            }}
            onTimeChange={(t) => {
              setPickedTime(t)
              setSlotError(null)
            }}
          />
          {slotError && (
            <p role="alert" className="text-xs-body text-red-50">
              {slotError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              onClick={() => {
                const check = checkSlot(pickedDate, pickedTime)
                if (!check.ok) {
                  setSlotError(check.reason)
                  return
                }
                setDateDialogOpen(false)
                onReschedule(pickedDate, pickedTime)
              }}
              disabled={pickedDate === post.scheduledDate && pickedTime === currentTime}
            >
              שמירה
            </Button>
            <Button variant="outline" onClick={() => setDateDialogOpen(false)}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The slot's moment has passed (Hani, 2026-10-22, Later-style): the card on
 * the board goes disabled — faded, not draggable, no actions menu. Click still
 * opens the preview, read-only.
 */
function isSlotPast(post: ScheduledPost, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(post.scheduledDate)
  if (!m) return false
  const [h, min] = (post.scheduledTime ?? DEFAULT_SCHEDULED_TIME).split(":").map(Number)
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h || 0, min || 0)
  return at.getTime() <= now.getTime()
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

  // --- Scheduling release (lib/scheduling-access) ------------------------
  // Live for the listed accounts only; for everyone else this page is the
  // board it was before. Includes the weekly routine on the board (ghost
  // slots + in-place edit), the approved-only rail and the format preview.
  const schedulingOn = useSchedulingAccess() === true
  // Today's batch (2026-10-29): a click on an auto-arranged card opens it — Hani only.
  const previewOn = usePreviewAccess() === true
  // Direction A of "schedule all" (task 4084d905): one row in the panel
  // header, drafts drawn like scheduled cards, no schedule settings on the
  // board. Hani only for now (lib/scheduling-access).
  const scheduleAllA = useScheduleAllA() === true && schedulingOn
  const rulesVariant: "a" | null = schedulingOn ? "a" : null
  const routine = usePostingSchedule()
  const [routineEditing, setRoutineEditing] = useState(false)
  const panelBeforeEditRef = useRef(false)
  const startRoutineEdit = () => {
    panelBeforeEditRef.current = panelCollapsed
    setPanelCollapsed(true) // the 7 columns need the room
    setRoutineEditing(true)
  }
  const endRoutineEdit = () => {
    setRoutineEditing(false)
    setPanelCollapsed(panelBeforeEditRef.current)
  }

  // Instagram: one shared connection state for the pill above the board and
  // every card's status line; one modal, opened from either.
  const router = useRouter()
  const connection = useInstagramConnection()
  const [igDialogOpen, setIgDialogOpen] = useState(false)

  // What happened in the queue since the last visit — outcomes of slots
  // whose time passed, edits after queuing, a lapsed connection.
  useEffect(() => {
    if (schedulingOn) void refreshPublishStatus()
  }, [schedulingOn])

  /**
   * The provider refuses anything under ~6 minutes ahead. When posts really
   * go out, a slot that's already too close is stopped here, while she's
   * dragging, with the reason — not discovered later as a failed post. A
   * board-only user (no connection) plans freely, as before.
   */
  const blockedAsTooSoon = (dateKey: string, time: string): boolean => {
    if (!schedulingOn || connection.status !== "connected") return false
    if (!isSlotTooSoon(dateKey, time)) return false
    toast.error(`השעה ${time} כבר עברה או קרובה מדי, ולכן הפוסט לא יוכל לצאת בזמן. בחרו יום אחר.`)
    return true
  }

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

  /**
   * Re-read the board from the local cache into component state.
   *
   * Hoisted out of the mount effect (and into a useCallback) so the mutation
   * handlers on this page can call it DIRECTLY after they schedule / unschedule.
   * They used to rely solely on the synthetic `storage` event that
   * `timing-storage` dispatches — which meant that if that event didn't land,
   * the write succeeded, the success toast fired, and the card never moved. The
   * button looked broken even though the action had worked; only a refresh
   * showed the truth. The event listener stays for cross-surface updates
   * (Sheet checkbox, queue panel, another tab), it's just no longer the only
   * path for this page's own actions.
   */
  const reloadBoard = useCallback(() => {
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
  }, [])

  useEffect(() => {
    reloadBoard()

    // Stay in sync with any source that may write to scheduled / published.
    // The published key is per-post, so we match by prefix.
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (
        e.key === TIMING_KEYS.scheduled ||
        e.key.startsWith(TIMING_KEYS.publishedPrefix)
      ) {
        reloadBoard()
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [reloadBoard])

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

  // The approved-only rail: a ready format is draggable once it's approved
  // on the canvas; the rest wait behind "ממתינים לאישור".
  const approvalMode = useMemo<QueueApprovalMode | undefined>(() => {
    if (!schedulingOn) return undefined
    return {
      variant: "a",
      isApproved: (corePostId, format) =>
        !!getFormatMeta(corePostId, format).approvedAt,
      pendingHref: "/core_posts?status=pending",
    }
  }, [schedulingOn])

  // --- "תזמון הכל" (scheduling release) ------------------------------------
  // "סידור אוטומטי בלוח" lays every ready post onto the board by the weekly
  // routine as dashed cards; "תזמון כל הפוסטים" schedules them all.
  const [railCards, setRailCards] = useState<PlanInputCard[]>([])
  const [planned, setPlanned] = useState<PlannedSlot[] | null>(null)
  const [plannedUnmatched, setPlannedUnmatched] = useState<PlanInputCard[]>([])
  const [noSettingsOpen, setNoSettingsOpen] = useState(false)
  const onArrange = () => {
    if (scheduleAllA) {
      // No settings on the board: her saved routine, or the default one.
      const plan = planScheduleAll(
        railCards,
        hasAnySlot(routine.saved) ? routine.saved : defaultPostingSchedule(),
        scheduled,
      )
      if (plan.placed.length === 0) {
        toast("לפורמטים שנשארו אין משבצת פנויה בלו״ז")
        return
      }
      setPlanned(plan.placed)
      setPlannedUnmatched(plan.unmatched)
      const first = [...plan.placed].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0]
      if (first) {
        const [y, m, d] = first.scheduledDate.split("-").map((n) => parseInt(n, 10))
        setWeekStart(startOfWeek(new Date(y, m - 1, d)))
      }
      return
    }
    if (!hasAnySlot(routine.saved)) {
      setNoSettingsOpen(true)
      return
    }
    const plan = planScheduleAll(railCards, routine.saved, scheduled)
    if (plan.placed.length === 0) {
      toast("לפורמטים שנשארו אין משבצת פנויה בלו״ז", {
        action: { label: "התאמת הלו״ז", onClick: () => startRoutineEdit() },
      })
      return
    }
    setPlanned(plan.placed)
    setPlannedUnmatched(plan.unmatched)
    // Land on the week the first post goes out.
    const first = [...plan.placed].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0]
    if (first) {
      const [y, m, d] = first.scheduledDate.split("-").map((n) => parseInt(n, 10))
      setWeekStart(startOfWeek(new Date(y, m - 1, d)))
    }
  }
  const onConfirmPlanned = () => {
    if (!planned) return
    let count = 0
    for (const p of planned) {
      if (blockedAsTooSoon(p.scheduledDate, p.scheduledTime)) continue
      schedulePost(p.corePostId, p.format, p.scheduledDate, p.scheduledTime, { hook: p.hook })
      count++
    }
    reloadBoard()
    setPlanned(null)
    setPlannedUnmatched([])
    if (count > 0) toast.success(count === 1 ? "פוסט אחד תוזמן" : `${count} פוסטים תוזמנו`)
  }
  const plannedByDay = useMemo(() => {
    const map = new Map<string, PlannedSlot[]>()
    for (const p of planned ?? []) {
      const list = map.get(p.scheduledDate) ?? []
      list.push(p)
      map.set(p.scheduledDate, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
    return map
  }, [planned])
  const plannedIds = useMemo(
    () => (planned ? new Set(planned.map((p) => `${p.corePostId}:${p.format}`)) : undefined),
    [planned],
  )

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

    // A post laid out by "סידור אוטומטי בלוח", moved before it's scheduled.
    const plannedRaw = e.dataTransfer.getData("application/x-schedule-ghost")
    if (plannedRaw) {
      try {
        const { corePostId, format } = JSON.parse(plannedRaw) as {
          corePostId: string
          format: FormatId
        }
        setPlanned((list) =>
          list
            ? list.map((x) =>
                x.corePostId === corePostId && x.format === format
                  ? { ...x, scheduledDate: dayKey }
                  : x,
              )
            : list,
        )
      } catch (err) {
        console.error("[calendar] failed to parse planned payload", err)
      }
      return
    }

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
        if (existing?.scheduledDate === dayKey) return
        if (blockedAsTooSoon(dayKey, time)) return
        schedulePost(corePostId, format, dayKey, time)
        reloadBoard()
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
        if (blockedAsTooSoon(dayKey, DEFAULT_SCHEDULED_TIME)) return
        schedulePost(
          corePostId,
          format,
          dayKey,
          DEFAULT_SCHEDULED_TIME,
          trimmed ? { hook: trimmed } : undefined,
        )
        reloadBoard()
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

  // --- Format preview (scheduling release) --------------------------------
  // A board card or a rail card opens the post as it will go out: media,
  // caption, the slot, and the Instagram status. The caption and the slot
  // are saved by its one "תזמון פוסט" button.
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewDetail, setPreviewDetail] = useState<{
    key: string
    caption: string
    slides: PreviewSlide[]
    coverUrl?: string
  } | null>(null)
  const openPreview = (corePostId: string, format: FormatId) => {
    const key = `${corePostId}:${format}`
    setPreviewKey(key)
    setPreviewDetail(null)
    fetch(`/api/core-posts/${corePostId}`)
      .then((r) => r.json())
      .then((data) => {
        const p = data?.post as
          | {
              formatPosts?: Record<string, string>
              formatMedia?: Record<string, string>
              videoUrl?: string | null
              coverUrl?: string | null
              carouselImageUrls?: string[]
              storyImageUrls?: string[]
            }
          | undefined
        if (!p) throw new Error("post not found")
        const isVideo = (u: string) => /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(u)
        const slide = (u: string): PreviewSlide => ({ url: u, type: isVideo(u) ? "video" : "image" })
        let urls: string[] = []
        if (format === "carousel") urls = p.carouselImageUrls ?? []
        else if (format === "story") {
          urls = p.storyImageUrls ?? []
          if (urls.length === 0 && p.formatMedia?.story) urls = [p.formatMedia.story]
        } else if (format === "talking_head") urls = p.videoUrl ? [p.videoUrl] : []
        else if (p.formatMedia?.[format]) urls = [p.formatMedia[format]]
        setPreviewDetail({
          key,
          caption: p.formatPosts?.[format] ?? "",
          slides: urls.map(slide),
          coverUrl: format === "talking_head" ? p.coverUrl ?? undefined : undefined,
        })
      })
      .catch((err) => {
        console.error("[calendar] failed to load post for preview", err)
        setPreviewDetail({ key, caption: "", slides: [] })
      })
  }
  const previewRow: ScheduledPost | null = previewKey
    ? scheduled.find((p) => `${p.corePostId}:${p.format}` === previewKey) ??
      (() => {
        const [corePostId, format] = previewKey.split(":")
        return {
          corePostId,
          format: format as FormatId,
          scheduledDate: "",
          scheduledTime: "",
          publishedAt: null,
        }
      })()
    : null
  const previewPast = previewRow?.scheduledDate ? isSlotPast(previewRow, new Date()) : false
  const previewPublish = (row: ScheduledPost): PreviewPublishStatus => {
    if (!row.scheduledDate) return { kind: "unscheduled" }
    const st = row.publish
    if (row.publishedAt || st?.status === "published") {
      return { kind: "published", permalink: st?.permalink ?? undefined }
    }
    if (st?.status === "sent" || (previewPast && (!st || st.status === "idle"))) {
      return { kind: "sent" }
    }
    if (connection.status !== "connected") return { kind: "not_connected" }
    if (st?.status === "queued" && st.code !== "content_changed") return { kind: "scheduled" }
    if (st?.status === "failed") {
      return {
        kind: "failed",
        reason: st.message || "הפוסט לא תוזמן.",
        action:
          st.code === "needs_reconnect" || st.code === "not_connected"
            ? "reconnect"
            : st.code === "media_rejected"
              ? "fix_media"
              : "retry",
      }
    }
    return { kind: "pending" }
  }
  const previewData: FormatPreviewData | null = previewRow
    ? {
        corePostId: previewRow.corePostId,
        format: previewRow.format,
        hook:
          (hookByPostId.get(previewRow.corePostId) || previewRow.hook || "").trim() ||
          "פוסט מתוזמן",
        caption: previewDetail?.key === previewKey ? previewDetail.caption : "",
        slides: previewDetail?.key === previewKey ? previewDetail.slides : [],
        coverUrl: previewDetail?.key === previewKey ? previewDetail.coverUrl : undefined,
        handle: connection.primary?.handle ?? "",
        scheduledDate: previewRow.scheduledDate,
        scheduledTime: previewRow.scheduledDate
          ? (previewRow.scheduledTime ?? DEFAULT_SCHEDULED_TIME)
          : "",
        isPast: previewPast,
        publish: previewPublish(previewRow),
      }
    : null
  const previewContentState: PreviewContentState =
    previewDetail?.key !== previewKey
      ? "loading"
      : previewDetail.slides.length === 0
        ? "no-media"
        : "ready"
  const previewHandlers = previewRow
    ? {
        onReschedule: (date: string, time: string) => {
          if (blockedAsTooSoon(date, time)) return
          schedulePost(previewRow.corePostId, previewRow.format, date, time, {
            hook: previewData?.hook,
          })
          reloadBoard()
          toast.success(
            previewRow.scheduledDate ? "התזמון עודכן" : "הפוסט תוזמן ונוסף ללוח",
          )
        },
        onCaptionSave: (caption: string) => {
          const key = previewKey
          fetch(`/api/core-posts/${previewRow.corePostId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formatPosts: { [previewRow.format]: caption } }),
          })
            .then((r) => {
              if (!r.ok) throw new Error(`PATCH ${r.status}`)
              setPreviewDetail((d) => (d && d.key === key ? { ...d, caption } : d))
              toast.success("הכיתוב עודכן")
            })
            .catch((err) => {
              console.error("[calendar] caption save failed", err)
              toast.error("לא הצלחנו לשמור את הכיתוב. נסו שוב.")
            })
        },
        onUnschedule: () => {
          unschedulePost(previewRow.corePostId, previewRow.format)
          unmarkPublished(previewRow.corePostId, previewRow.format)
          reloadBoard()
          setPreviewKey(null)
          toast.success("הפורמט חזר ל״מוכנים לתזמון״")
        },
        onOpenCanvas: () => router.push(canvasHref(previewRow)),
        onStatusAction: (
          action: "connect" | "reconnect" | "retry" | "fix_media" | "open_post",
        ) => {
          if (action === "connect" || action === "reconnect") setIgDialogOpen(true)
          else if (action === "fix_media") router.push(canvasHref(previewRow))
          else if (action === "open_post") {
            const link = previewRow.publish?.permalink
            if (link) window.open(link, "_blank", "noopener")
            else markPublished(previewRow.corePostId, previewRow.format)
          } else {
            void retryPublish(previewRow.corePostId, previewRow.format, "retry").then((next) => {
              reloadBoard()
              if (next?.status === "queued") toast.success("הפוסט תוזמן לאינסטגרם")
              else if (next?.status === "failed" && next.message) toast.error(next.message)
            })
          }
        },
      }
    : null

  // One board card — shared by the day-column board and the hour-rows board.
  const renderCard = (post: ScheduledPost) => {
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
    const mediaUrl = formatMediaByPost.get(post.corePostId)?.[post.format]
    return (
      <FormatCard
        key={`${post.corePostId}:${post.format}`}
        post={post}
        past={isSlotPast(post, new Date())}
        hook={hook}
        mediaUrl={mediaUrl}
        isPublished={isPublished}
        onCardClick={() =>
          schedulingOn
            ? openPreview(post.corePostId, post.format)
            : openSheetForCorePost(
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
          reloadBoard()
          toast.success("הפורמט חזר ל״מוכנים לתזמון״")
        }}
        onReschedule={(newDate, newTime) => {
          // Move THIS format to the picked date + time.
          if (blockedAsTooSoon(newDate, newTime)) return
          schedulePost(
            post.corePostId,
            post.format,
            newDate,
            newTime,
            { hook },
          )
          reloadBoard()
          toast.success("התזמון עודכן")
        }}
        showPublish={schedulingOn}
        connection={connection}
        onConnectInstagram={() => setIgDialogOpen(true)}
        onFixMedia={() =>
          router.push(
            `/project?post_id=${post.corePostId}&format=${post.format}`,
          )
        }
      />
    )
  }

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
              {schedulingOn && (
                <InstagramConnectionControl
                  className="ms-auto"
                  open={igDialogOpen}
                  onOpenChange={setIgDialogOpen}
                />
              )}
            </div>

            {/* Level 2 — week navigation (or, in variant A edit mode, the
                routine editor's bar). */}
            {rulesVariant === "a" && routineEditing ? (
              <RoutineEditBar
                draft={routine.draft}
                saving={routine.saving}
                saveError={routine.saveError}
                dirty={routine.dirty}
                onStoryGap={(m) => routine.setDraft({ ...routine.draft, storyGapMinutes: m })}
                onCancel={() => {
                  routine.discard()
                  endRoutineEdit()
                }}
                onSave={() =>
                  routine.save(() => {
                    endRoutineEdit()
                    toast.success("הלו״ז נשמר")
                  })
                }
              />
            ) : (
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
              <div className="flex items-center gap-2">
                {rulesVariant === "a" && !scheduleAllA && (
                  <RoutineButton schedule={routine.saved} onEdit={startRoutineEdit} />
                )}
                <Button variant="outline" size="sm" onClick={goThisWeek} disabled={isCurrentWeek}>
                  השבוע
                </Button>
              </div>
            </div>
            )}
          </div>

          {planned && !scheduleAllA && (
            <div className="max-w-[1200px] w-full mx-auto">
              <PreviewBar
                plan={planned}
                unmatched={plannedUnmatched}
                error={false}
                laterCount={
                  planned.filter((p) => {
                    const k = p.scheduledDate
                    return k < toDateKey(weekStart) || k > toDateKey(weekEnd)
                  }).length
                }
                onConfirm={onConfirmPlanned}
                onCancel={() => {
                  setPlanned(null)
                  setPlannedUnmatched([])
                }}
                onOpenSettings={startRoutineEdit}
              />
            </div>
          )}

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
                    {rulesVariant === "a" && routineEditing ? (
                      <div className="text-small-bold text-text-primary-default">
                        {routine.draft.days[day.getDay()].length || "—"}
                      </div>
                    ) : (
                    <div className="text-small-bold text-text-primary-default tabular-nums">
                      {isToday ? (
                        <span className="inline-flex items-center justify-center size-6 rounded-full bg-yellow-50">
                          {day.getDate()}
                        </span>
                      ) : (
                        day.getDate()
                      )}
                    </div>
                    )}
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
                const editingRoutine = rulesVariant === "a" && routineEditing
                const past = !editingRoutine && isPastDate(day, today)
                const isDragOver = dragOverDay === dayKey
                const dayPosts = postsByDay.get(dayKey) ?? []

                // Today gets a very subtle warm tint (yellow-95 at 40%) —
                // visible enough to read as "this is today" but light enough
                // that the column still looks interactive (droppable).
                const dayBg = isToday && !editingRoutine
                  ? "bg-yellow-95/40"
                  : "bg-white dark:bg-gray-10"

                return (
                  <div
                    key={day.toISOString()}
                    onDragOver={editingRoutine ? undefined : (e) => handleDragOver(e, day, dayKey)}
                    onDragLeave={editingRoutine ? undefined : () => handleDragLeave(dayKey)}
                    onDrop={editingRoutine ? undefined : (e) => handleDrop(e, day, dayKey)}
                    aria-label={`${WEEKDAY_LABELS[dayOfWeek]} ${day.getDate()}${isToday ? " — היום" : ""}${past ? " — תאריך שעבר" : ""}`}
                    className={`relative overflow-y-auto scrollbar-subtle min-w-0 transition-colors ${isLastCol ? "" : "border-l"} border-border-neutral-default ${dayBg} ${
                      isDragOver ? "ring-2 ring-inset ring-yellow-50 bg-bg-surface-primary-default z-10" : ""
                    } ${past ? "cursor-not-allowed" : ""}`}
                  >
                    {editingRoutine ? (
                      <RoutineDayEditor
                        dayIndex={dayOfWeek}
                        draft={routine.draft}
                        onChange={routine.setDraft}
                      />
                    ) : (
                    /* Cards stack from the top. `min-h-full` keeps the whole
                        column a drop target even when it's nearly empty. */
                    <div className="flex flex-col gap-1.5 p-2 min-h-full">
                      {dayPosts.map(renderCard)}
                      {(plannedByDay.get(dayKey) ?? []).map((slot) => (
                        <PlannedCard
                          key={`planned:${slot.corePostId}:${slot.format}`}
                          slot={slot}
                          likeScheduled={scheduleAllA}
                          onOpen={
                            previewOn
                              ? () =>
                                  schedulingOn
                                    ? openPreview(slot.corePostId, slot.format)
                                    : openSheetForCorePost(slot.corePostId, slot.format, "preview")
                              : undefined
                          }
                        />
                      ))}
                      {/* Variant A: the routine's still-open slots for this
                          day, as dashed ghosts. Upcoming days only. */}
                      {rulesVariant === "a" &&
                        !scheduleAllA &&
                        routine.hasCustom &&
                        !past &&
                        unfilledSlots(
                          slotsForDate(routine.saved, day),
                          [
                            ...dayPosts.map((p) => p.format),
                            ...(plannedByDay.get(dayKey) ?? []).map((p) => p.format),
                          ],
                        ).map((slot) => (
                          <GhostSlot key={slot.id} slot={slot} onEdit={startRoutineEdit} />
                        ))}
                    </div>
                    )}
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
          onReadyCardsChange={schedulingOn ? setRailCards : undefined}
          previewPlacedIds={plannedIds}
          headerAction={
            scheduleAllA ? (
              planned ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPlanned(null)
                      setPlannedUnmatched([])
                    }}
                  >
                    ביטול
                  </Button>
                  <Button size="sm" onClick={onConfirmPlanned}>
                    <CalendarCheck className="size-4" aria-hidden />
                    תזמון כל הפוסטים
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={onArrange} disabled={railCards.length === 0}>
                  <CalendarClock className="size-4" aria-hidden />
                  סידור אוטומטי בלוח
                </Button>
              )
            ) : schedulingOn ? (
              <ScheduleAllButton
                label="סידור אוטומטי בלוח"
                count={railCards.length}
                onClick={onArrange}
              />
            ) : undefined
          }
          collapsed={panelCollapsed}
          onToggleCollapse={() => setPanelCollapsed((v) => !v)}
          onItemClick={(corePostId, format) =>
            schedulingOn && format
              ? openPreview(corePostId, format)
              : openSheetForCorePost(corePostId, format, "preview")
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
      {/* The format preview, as a modal over the board. */}
      {schedulingOn && previewHandlers && (
        <FormatPreviewDialog
          open={!!previewData}
          onOpenChange={(open) => {
            if (!open) setPreviewKey(null)
          }}
          data={previewData}
          content={previewContentState}
          {...previewHandlers}
        />
      )}

      {schedulingOn && (
        <NoSettingsDialog
          open={noSettingsOpen}
          onOpenChange={setNoSettingsOpen}
          count={railCards.length}
          onOpenSettings={() => {
            setNoSettingsOpen(false)
            startRoutineEdit()
          }}
        />
      )}

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
