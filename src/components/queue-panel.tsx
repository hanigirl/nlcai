"use client"

/**
 * QueuePanel — the side rail on /calendar that lists every core post the
 * user can still schedule.
 *
 * Source of truth: the server (`GET /api/core-posts`). Previously this
 * component read from a local "queue" namespace in localStorage (posts the
 * user manually added via "תזמנו בלוח שנה"). That model created two
 * problems:
 *
 *   1. The list was always shorter than reality — most posts the user
 *      created never made it to the queue, so the panel felt empty even
 *      when the user had a full inventory.
 *   2. There was an in-between "in queue" state that didn't map to
 *      anything visible — neither scheduled nor truly draft.
 *
 * New model (binary):
 *   - "scheduled"     → has a row in SCHEDULED_KEY
 *   - "not scheduled" → everything else (i.e. shown here)
 *
 * Implementation notes:
 *   - We fetch all core posts on mount, then filter out the ones already
 *     scheduled (read from localStorage). The filtered list is the panel.
 *   - Storage events on SCHEDULED_KEY re-filter — so when the user drops
 *     a card on the grid, this panel updates without a refetch.
 *   - DnD: native HTML5, sets `text/x-core-post-id` so the calendar grid
 *     can treat it identically to the previous queue source.
 *   - Search is local — runs on the in-memory list. With 50–200 posts
 *     this stays instant and avoids server round trips on every keystroke.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import confetti from "canvas-confetti"
import { FileText, Inbox, PanelLeftClose, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  TIMING_KEYS,
  getFormatReadiness,
  getScheduledPosts,
  type FormatId,
  type ReadinessPostInput,
} from "@/lib/timing-storage"
import {
  FormatStatusChip,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import { FormatThumbnail } from "@/components/format-thumbnail"
import { HEADER_CHIP_FORMATS } from "@/components/core-post-sheet"
import { GeneratingStatus } from "@/components/generating-status"

/**
 * Help-card state — onboarding cap.
 *
 * Per Hani: a brand-new tool should re-show short explainers a few times
 * even if the user clicked "got it" too fast, so they get multiple
 * natural exposures. 5 page loads is the industry sweet spot (Linear /
 * Notion / Figma sit in the 3–5 range — enough reinforcement, not so
 * many that it nags).
 *
 * Persisted shape:
 *   { views: number, dismissed: boolean }
 *
 * Visibility rule:
 *   show if !dismissed AND views < MAX_HELP_VIEWS
 *
 * "הבנתי" sets `dismissed = true` (permanent opt-out). Otherwise each
 * panel mount counts as one view; the card simply stops appearing once
 * the user has seen it `MAX_HELP_VIEWS` times.
 */
const QUEUE_HELP_KEY = "nlcai.ui.queue-help"
const MAX_HELP_VIEWS = 5

type HelpState = { views: number; dismissed: boolean }

function readHelpState(): HelpState {
  if (typeof window === "undefined") return { views: 0, dismissed: false }
  try {
    const raw = window.localStorage.getItem(QUEUE_HELP_KEY)
    if (!raw) return { views: 0, dismissed: false }
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) {
      return { views: 0, dismissed: false }
    }
    const obj = parsed as Record<string, unknown>
    return {
      views: typeof obj.views === "number" ? obj.views : 0,
      dismissed: obj.dismissed === true,
    }
  } catch {
    return { views: 0, dismissed: false }
  }
}

function writeHelpState(state: HelpState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(QUEUE_HELP_KEY, JSON.stringify(state))
  } catch {
    // localStorage can throw in private mode / when quota is hit — the
    // help card simply re-appears next mount, which is benign.
  }
}


/**
 * The minimum we need from /api/core-posts to render a panel item.
 * The endpoint returns more (formats_with_media, primary_media_url) but the
 * panel only needs identity + display text + a hint of format.
 */
type ApiCorePost = {
  id: string
  title: string | null
  body: string
  hook_text: string | null
  user_response: string | null
  status: string
  created_at: string
  updated_at: string
  formats?: string[]
  formats_with_media?: string[]
  format_media?: Record<string, string>
}

/**
 * Shape used inside the panel — a thin projection of ApiCorePost plus the
 * "primary format" we picked for the icon. We keep this type local so the
 * external onItemClick callback can stay generic to a corePostId.
 *
 * `formats` + `formatsWithMedia` + `hasBody` are carried so each item can
 * derive its own per-format readiness (which the `FormatStatusChip`
 * inside the row needs). We could store the chip state directly, but
 * keeping the *inputs* means a storage change to schedule/published rows
 * also updates the displayed chip without a refetch.
 */
export type PanelItem = {
  corePostId: string
  title: string | null
  hookText: string | null
  /** First format we know about — drives the icon. Null = generic text. */
  format: FormatId | null
  /** All formats this post has been duplicated into. */
  formats: string[]
  /** Subset of `formats` that have at least one media asset. */
  formatsWithMedia: string[]
  /** Whether the post body is non-empty — body fallback for "ready". */
  hasBody: boolean
  /** Per-format first non-cover media URL — drives the card thumbnail. */
  formatMedia: Record<string, string>
}

/**
 * One rail card = one READY format of a core post. The rail is per-format
 * now: every schedulable format is its own draggable card.
 */
type ReadyCard = {
  /** `${corePostId}:${format}` — unique per card, used as key + drag id. */
  id: string
  corePostId: string
  format: FormatId
  /** Resolved display text (hook → title → fallback). */
  hook: string
  /** Per-format media URL for the thumbnail; undefined → icon fallback. */
  mediaUrl?: string
}

export type QueuePanelProps = {
  /** Called whenever the displayed list size changes. */
  onCountChange?: (count: number) => void
  /**
   * Called when the user starts dragging an item. The parent uses this to
   * set a global "isDragging" hint (so drop targets can ring up earlier).
   * Optional — DnD still works without it.
   */
  onDragStartItem?: (corePostId: string) => void
  onDragEndItem?: () => void
  /**
   * Called when a card is clicked — parent opens the Sheet. `format` is the
   * specific format of the clicked card, so the Sheet can land on it.
   */
  onItemClick?: (corePostId: string, format: FormatId) => void
  /**
   * Collapsed state — owned by the parent (the calendar page) because it
   * also controls the matching `pe-[480px]` reserved for the rail. When
   * true the rail slides off the end edge and the parent shows a reopen
   * button. Defaults to expanded.
   */
  collapsed?: boolean
  /** Toggle handler for the in-header collapse button. */
  onToggleCollapse?: () => void
}

export function QueuePanel({
  onCountChange,
  onDragStartItem,
  onDragEndItem,
  onItemClick,
  collapsed = false,
  onToggleCollapse,
}: QueuePanelProps) {
  const [allPosts, setAllPosts] = useState<PanelItem[]>([])
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Help card — onboarding visibility. See `readHelpState` for the
  // visibility rule (≤ MAX_HELP_VIEWS shown OR explicit "הבנתי" dismiss).
  // Initial state is computed from storage synchronously so the card
  // doesn't flicker in on first paint when it should be hidden.
  const [helpVisible, setHelpVisible] = useState<boolean>(() => {
    const state = readHelpState()
    return !state.dismissed && state.views < MAX_HELP_VIEWS
  })
  // Count one view per panel mount. Increments only when the card is
  // actually rendered this mount (helpVisible was true at init) — we
  // don't want to burn views during a session that already hit the cap.
  // Guarded by a ref to survive React 18's StrictMode double-mount in
  // dev so a single page-load doesn't get counted twice.
  const viewCountedRef = useRef(false)
  useEffect(() => {
    if (!helpVisible) return
    if (viewCountedRef.current) return
    viewCountedRef.current = true
    const state = readHelpState()
    writeHelpState({ ...state, views: state.views + 1 })
    // intentionally one-shot — we only want to count the first mount,
    // not subsequent visibility flips. The empty dep array is correct
    // because helpVisible is checked at first render and won't change
    // back to true mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const dismissHelp = useCallback(() => {
    setHelpVisible(false)
    const state = readHelpState()
    writeHelpState({ ...state, dismissed: true })
  }, [])

  // Refresh the scheduled-id set from localStorage. Cheap (synchronous read)
  // — we recompute on mount and on every relevant storage event.
  const refreshScheduled = useCallback(() => {
    const ids = new Set(getScheduledPosts().map((p) => p.corePostId))
    setScheduledIds(ids)
  }, [])

  // Initial fetch + scheduled hydrate.
  useEffect(() => {
    let cancelled = false
    refreshScheduled()
    setLoading(true)
    setError(null)
    fetch("/api/core-posts")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: { posts?: ApiCorePost[] }) => {
        if (cancelled) return
        const posts = (data.posts ?? []).map<PanelItem>((p) => ({
          corePostId: p.id,
          title: p.title,
          hookText: p.hook_text,
          format: (p.formats?.[0] as FormatId | undefined) ?? null,
          formats: p.formats ?? [],
          formatsWithMedia: p.formats_with_media ?? [],
          hasBody: !!p.body?.trim(),
          formatMedia: p.format_media ?? {},
        }))
        setAllPosts(posts)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("[queue-panel] failed to load core posts", err)
        setError("שגיאה בטעינת הפוסטים")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshScheduled])

  // Bumped every time we want to re-derive READY filter on a meta change
  // (drive_url is in localStorage, not on the API row, so the filter has to
  // re-run when it changes). We can't put `meta` into a dependency directly —
  // it lives outside React state — so we use a tick counter that the storage
  // event handler increments. Adding it as a dep on the `unscheduled` memo
  // forces a recompute when drive_url is patched in the Sheet.
  const [metaTick, setMetaTick] = useState(0)

  // Per Hani: when the user publishes a format DURING THIS SESSION, the
  // published chip should keep showing on the post's queue card with a
  // green V — so the user gets visual confirmation that "this one's
  // done". After a refresh, the set is empty again and we revert to the
  // default "only ready" filter. Key shape: `${corePostId}:${format}`.
  const [publishedInSession, setPublishedInSession] = useState<Set<string>>(
    () => new Set(),
  )

  // Stay in sync with scheduling changes from any source (drop on grid,
  // unschedule from chip menu, "תזמנו" inside the Sheet, another tab).
  // Published events also matter for the chip state (a post can be
  // published without being scheduled in the local store — e.g. the user
  // marked an old post as published retroactively).
  // We don't recompute anything explicitly on published changes — the chip
  // re-renders on every tick because state is derived from a fresh
  // `getFormatReadiness` call inside the `map`. We just need a stale-state
  // bust, which `refreshScheduled` happens to provide.
  //
  // Phase 6: also listen for meta changes (drive_url in particular) so the
  // READY filter re-runs when the user adds a drive link inside the Sheet.
  // Without this, a post that became READY mid-session would only appear in
  // the panel after a hard reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (
        e.key === TIMING_KEYS.scheduled ||
        e.key.startsWith(TIMING_KEYS.publishedPrefix)
      ) {
        refreshScheduled()
      }
      // When a format is marked as published, latch (postId, format) into
      // the in-session set. Reading the new value from the event itself
      // means we don't need a separate fetch — it's the JSON string
      // already in localStorage.
      if (e.key.startsWith(TIMING_KEYS.publishedPrefix) && e.newValue) {
        const corePostId = e.key.slice(TIMING_KEYS.publishedPrefix.length)
        try {
          const map = JSON.parse(e.newValue) as Record<
            string,
            { publishedAt?: string }
          >
          setPublishedInSession((prev) => {
            const next = new Set(prev)
            for (const [format, mark] of Object.entries(map)) {
              if (mark?.publishedAt) next.add(`${corePostId}:${format}`)
            }
            return next
          })
        } catch {
          // Malformed JSON — ignore, the filter just keeps the previous set.
        }
      }
      if (e.key.startsWith(TIMING_KEYS.metaPrefix)) {
        setMetaTick((n) => n + 1)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [refreshScheduled])

  // Per-format queue: a post is in the panel if it has AT LEAST ONE format
  // whose `getFormatReadiness` returns "ready". This naturally:
  //  - excludes posts where every format is empty (no script + no media/drive)
  //  - excludes posts where every format is scheduled or published
  //  - INCLUDES posts where some formats are scheduled/published but at
  //    least one ready format remains unscheduled. The picker on drop will
  //    only let the user pick the still-ready ones; the others appear
  //    disabled with a "כבר מתוזמן/פורסם" hint.
  //
  // Per Hani: "אם בחר לתזמן ב-9 בערב קרוסלה... הפוסט הליבה הזה עדיין יופיע
  // כאפשרי לתזמון, רק שעכשיו פורמט הסטורי זמין לתזמון, והקרוסלה יהיה בסימן
  // תוזמן (וי ירוק)."
  //
  // metaTick is in the deps because `getFormatReadiness` reads localStorage
  // (drive URL) — when the user adds a drive link, the filter must re-run.
  const unscheduled = useMemo(() => {
    return allPosts.filter((post) => {
      const readinessInput: ReadinessPostInput = {
        id: post.corePostId,
        formats: post.formats,
        formatsWithMedia: post.formatsWithMedia,
        hasBody: post.hasBody,
      }
      return HEADER_CHIP_FORMATS.some(
        (format) => getFormatReadiness(readinessInput, format) === "ready",
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPosts, scheduledIds, metaTick])
  // `unscheduledAll` no longer used — kept as a placeholder for the empty
  // states which used to read from it.
  const unscheduledAll = unscheduled

  // Expand each post into one card per READY format. `getFormatReadiness`
  // returns "ready" only when a format has a script + media (or Drive link)
  // AND isn't already scheduled/published — so this list is exactly the
  // formats waiting to be placed on the calendar, each as its own card.
  // Same deps as `unscheduled` (readiness reads scheduled/published state
  // from storage; scheduledIds/metaTick changes bust the memo).
  const readyCards = useMemo<ReadyCard[]>(() => {
    const cards: ReadyCard[] = []
    for (const post of allPosts) {
      const readinessInput: ReadinessPostInput = {
        id: post.corePostId,
        formats: post.formats,
        formatsWithMedia: post.formatsWithMedia,
        hasBody: post.hasBody,
      }
      const hook =
        post.hookText?.trim() || post.title?.trim() || "פוסט ללא הוק"
      for (const format of HEADER_CHIP_FORMATS) {
        if (getFormatReadiness(readinessInput, format) !== "ready") continue
        cards.push({
          id: `${post.corePostId}:${format}`,
          corePostId: post.corePostId,
          format,
          hook,
          mediaUrl: post.formatMedia[format],
        })
      }
    }
    return cards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPosts, scheduledIds, metaTick])

  useEffect(() => {
    onCountChange?.(readyCards.length)
  }, [readyCards.length, onCountChange])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return readyCards
    // Search on the card's resolved hook — the user-recognisable string.
    return readyCards.filter((c) => c.hook.toLowerCase().includes(q))
  }, [readyCards, query])

  const handleDragStart = (
    e: React.DragEvent<HTMLLIElement>,
    card: ReadyCard,
  ) => {
    // The rail is per-format: a drop schedules exactly this one format, so
    // the payload is just the (post, format) tuple plus the resolved hook
    // (so the new calendar card renders it without a refetch). No picker.
    e.dataTransfer.setData(
      "application/x-ready-format",
      JSON.stringify({
        corePostId: card.corePostId,
        format: card.format,
        hook: card.hook,
      }),
    )
    e.dataTransfer.effectAllowed = "move"
    setDraggingId(card.id)
    onDragStartItem?.(card.corePostId)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    onDragEndItem?.()
  }

  // What kind of empty are we? Four cases now (Phase 6 added "none ready"):
  //   1. Loading                 → quiet skeleton-like message
  //   2. No posts at all         → "create some" CTA → /project
  //   3. All posts scheduled     → "you're done" CTA → /project (create more)
  //   4. None ready (unscheduled exist but lack media/script)
  //                              → "needs media or script" CTA → /core_posts
  // Search-no-results is handled inline below the search input, not here.
  //
  // Order matters: noPostsAtAll preempts everything else; allScheduled is
  // checked next; noneReady is the residual case (we have unscheduled posts,
  // but none of them pass the readiness bar).
  const noPostsAtAll = !loading && !error && allPosts.length === 0
  const allScheduled =
    !loading && !error && allPosts.length > 0 && unscheduledAll.length === 0
  const noneReady =
    !loading &&
    !error &&
    unscheduledAll.length > 0 &&
    unscheduled.length === 0

  return (
    <aside
      dir="rtl"
      // Per Hani: the queue rail anchors flush against the AppShell
      // topbar (h-14 = 56px) — no top gap. We use `fixed` positioning
      // because the panel sits inside `<main>` which has `pt-[72px]
      // px-6 pb-6`; relative positioning keeps the panel inside that
      // padding area, leaving a 72px+ gap above. Fixed pulls the panel
      // out of flow and pins it to viewport edges. The calendar page
      // adds matching `pe-[480px]` so its grid doesn't render under us.
      // z-30 = above content but below the topbar (z-50) so the topbar's
      // shadow + sticky behavior still wins.
      // Width sized for a TWO-up card grid (post-2026-06-30): the list
      // renders two format cards per row. 480 makes each column ≈218px
      // ((480 − 32 px-4 gutters − 12 gap) / 2) — the same width as a
      // /core_posts grid card, so the rail card and the core-post card
      // read at an identical size.
      // `transition-transform` + `-translate-x-full` slides the rail off the
      // end edge (left in RTL) when collapsed; the calendar page animates its
      // matching `pe` in lockstep so the grid widens as the rail leaves.
      // `pointer-events-none` + `aria-hidden` while collapsed so the hidden
      // rail can't be tabbed into or clicked through.
      //
      className={`fixed top-14 bottom-0 end-0 z-30 w-[480px] flex flex-col border-s border-border-neutral-default bg-white dark:bg-gray-10 overflow-hidden transition-transform duration-300 ease-in-out ${
        collapsed ? "-translate-x-full pointer-events-none" : "translate-x-0"
      }`}
      aria-label="פאנל פוסטים לתזמון"
      aria-hidden={collapsed}
    >
      <div className="px-4 py-3 border-b border-border-neutral-default flex items-center gap-2">
        <h3 className="text-text-primary-default text-p-bold flex-1">פוסטים לתזמון</h3>
        <Badge variant="outline" className="tabular-nums">
          {unscheduled.length}
        </Badge>
        {onToggleCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapse}
                aria-label="כיווץ פאנל הפוסטים"
                tabIndex={collapsed ? -1 : 0}
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>כיווץ הפאנל</TooltipContent>
          </Tooltip>
        )}
      </div>

      {unscheduled.length > 0 && (
        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-neutral-default pointer-events-none" />
            <Input
              inputSize="small"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש..."
              className="ps-8 text-xs"
              aria-label="חיפוש בפוסטים"
            />
          </div>
        </div>
      )}

      {/* List — flex-1 + overflow-y-auto so it consumes the remaining
          height of the rail and scrolls independently. */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          // Loading state — narrate + show shape. The text loader
          // (cycling 2 messages, same `GeneratingStatus` pattern from
          // /ideas + /hooks) explains WHAT is happening; the skeleton
          // boxes below it preserve the visual rhythm of the eventual
          // post list so the layout doesn't jump when the data lands.
          // `subtitle={null}` because the default copy ("תהליך זה
          // יכול לקחת מספר דקות") overstates the actual hydrate time.
          <div
            className="flex flex-col gap-4"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="text-center px-3">
              <GeneratingStatus
                messages={[
                  "בודקים פוסטים מוכנים לתזמון...",
                  "מייבאים פוסטים עם מדיה...",
                ]}
                subtitle={null}
              />
            </div>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-36 rounded-xl bg-bg-surface animate-pulse"
                  aria-hidden
                />
              ))}
            </div>
          </div>
        ) : error ? (
          <QueueErrorState message={error} />
        ) : noPostsAtAll ? (
          <EmptyNoPostsState />
        ) : allScheduled ? (
          <EmptyAllScheduledState />
        ) : noneReady ? (
          <EmptyNoneReadyState count={unscheduledAll.length} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-small text-text-neutral-default">לא נמצאו פוסטים</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {helpVisible && <QueueHelpCard onDismiss={dismissHelp} />}
            {/* Two cards per row — the rail is wide enough (w-[560px]) to
                show the new core-post card design two-up. The help card
                above stays full width as a sibling of this grid. */}
            <ul className="grid grid-cols-2 gap-3">
              {filtered.map((card, index) => {
              const isDragging = draggingId === card.id
              // Stagger the entrance animation top → bottom. 60ms per row
              // gives a light rolling feel; clamped at ~600ms total so
              // long lists don't get a slow trailing tail.
              const animationDelay = `${Math.min(index * 60, 600)}ms`
              const formatLabel = getFormatChipLabel(card.format)
              return (
                <li
                  key={card.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, card)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onItemClick?.(card.corePostId, card.format)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onItemClick?.(card.corePostId, card.format)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`גררו לתזמון: ${formatLabel} — ${card.hook}`}
                  style={{ animationDelay }}
                  className={`group animate-in fade-in slide-in-from-top-2 fill-mode-both duration-300 ease-out flex flex-col gap-3 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-4 text-right cursor-grab active:cursor-grabbing transition-all hover:bg-bg-surface-hover hover:border-gray-80 hover:ring-2 hover:ring-gray-80/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                    isDragging ? "opacity-50 cursor-grabbing" : ""
                  }`}
                >
                  {/* MEDIA — this format's own asset (video first-frame or
                      image), scaled to fill a PORTRAIT slot (aspect 4:5) so the
                      rail card mirrors the /core_posts portrait card. Carousel
                      (square 1:1) assets are shown FULLY — object-contain +
                      gray padding — instead of cropped; everything else covers.
                      A format ready only via a Drive link (no uploaded asset)
                      falls back to the format icon on a neutral gray box. */}
                  <FormatThumbnail
                    url={card.mediaUrl}
                    format={card.format}
                    className="aspect-[4/5] w-full rounded-lg"
                    iconClassName="size-8"
                    fallbackClassName="bg-gray-95"
                    fit={card.format === "carousel" ? "contain" : "cover"}
                  />

                  {/* Text block — hook + format chip, tightly spaced (gap-1.5)
                      to mirror the /core_posts portrait card. */}
                  <div className="flex flex-1 flex-col gap-1.5">
                    {/* Hook — the recognisable identity of the core post. */}
                    <p className="text-sm font-semibold text-text-primary-default line-clamp-2 leading-snug">
                      {card.hook}
                    </p>

                    {/* Format chip — pinned to the bottom (mt-auto), matching
                        the /core_posts card. A single chip because this card IS
                        one format; "ready" (yellow) because every rail card has
                        passed the schedulable bar (script + media/Drive).
                        `group-hover:border-gray-80` mirrors the /core_posts
                        card so the chip stands out on the card's yellow hover. */}
                    <div className="mt-auto flex">
                      <FormatStatusChip
                        format={card.format}
                        state="ready"
                        size="sm"
                        className="group-hover:border-gray-80"
                      />
                    </div>
                  </div>
                </li>
              )
            })}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Help card explaining the dashed-chip state. Shows above the queue list
 * until the user clicks "הבנתי"; persists dismissal in localStorage so it
 * doesn't reappear across reloads. Design mirrors the Figma node 407:2405:
 * a centered card with an example chip (the talking_head "ready" chip the
 * user actually sees in the list), a bold title, a description that
 * highlights "מכילים מדיה", and a primary CTA. The soft yellow blur in
 * the top-right is a decorative echo of the chip's "primary" accent —
 * the design used a yellow ellipse asset; the radial-style glow gets
 * the same warmth without shipping another image.
 */
function QueueHelpCard({ onDismiss }: { onDismiss: () => void }) {
  // Two-phase dismissal so the card animates out cleanly before the
  // parent unmounts it.
  //   click → `dismissing = true` → fade + slide + collapse height/padding
  //   transitionend (opacity) → `onDismiss()` → parent stops rendering this
  // We track the transition on `opacity` because every transition end
  // bubbles up; gating on a single property keeps `onDismiss` from firing
  // once per animated property.
  const [dismissing, setDismissing] = useState(false)
  const handleClick = () => setDismissing(true)
  const handleTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.propertyName !== "opacity") return
    if (dismissing) onDismiss()
  }

  return (
    <div
      dir="rtl"
      onTransitionEnd={handleTransitionEnd}
      className={`relative overflow-hidden flex flex-col items-center gap-[18px] p-4 bg-white dark:bg-gray-10 border border-border-neutral-default rounded-xl text-center transition-all duration-300 ease-out max-h-[500px] ${
        dismissing
          ? "opacity-0 -translate-y-2 max-h-0 !p-0 !border-transparent"
          : ""
      }`}
    >
      {/* Decorative yellow glow — RTL `-end-12` puts it on the visual
          right (where the original design's ellipse2 sat). Blurred and
          softly tinted so it reads as a brand accent, not a card
          background. */}
      <div
        aria-hidden
        className="absolute -top-12 -end-12 size-32 rounded-full bg-yellow-80/40 blur-2xl pointer-events-none"
      />

      <div className="relative flex flex-col items-center gap-1 text-center w-full">
        <p className="text-small-bold text-text-primary-default">
          כל כרטיס הוא פורמט מוכן לתזמון
        </p>
        <p className="text-xs-body text-text-neutral-default leading-snug">
          כל פורמט{" "}
          <span className="text-text-primary-default font-medium">
            עם מדיה
          </span>{" "}
          מופיע ככרטיס נפרד. גררו אותו ליום ושעה בלוח כדי לתזמן
          <br />
          תמיד אפשר להוסיף מדיה לפורמט בעמוד העריכה
        </p>
      </div>

      <Button
        size="sm"
        onClick={handleClick}
        aria-label="סגירת ההסבר"
        className="relative"
        disabled={dismissing}
      >
        הבנתי
      </Button>
    </div>
  )
}

export function EmptyNoPostsState() {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10 px-3">
      <div className="size-12 rounded-full bg-bg-surface flex items-center justify-center">
        <Inbox className="size-5 text-text-neutral-default" aria-hidden />
      </div>
      <div>
        <p className="text-small-bold text-text-primary-default">
          עדיין לא יצרתם פוסטי ליבה
        </p>
        <p className="text-xs-body text-text-neutral-default mt-1 leading-relaxed">
          כשתיצרו פוסטים, הם יופיעו כאן לתזמון
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="mt-1">
        <Link href="/project">צרו פוסט ליבה</Link>
      </Button>
    </div>
  )
}

/**
 * Brand-yellow confetti palette — same set the post-creation celebration
 * fires. Kept in sync with `src/components/core-post-celebration.tsx` so
 * any future palette adjustment lives in one place visually (the two
 * files don't share an import yet because both stick to plain
 * "consumer of canvas-confetti" patterns).
 */
const ALL_SCHEDULED_CONFETTI_COLORS = [
  "#FFC300", // yellow-50 (brand)
  "#FFCF33", // yellow-60
  "#FFDB66", // yellow-70
  "#FFE799", // yellow-80
  "#332700", // yellow-10 (dark accent)
]

/**
 * "All scheduled" empty state — Figma node 410:3897.
 *
 * White card, gray-90 border, soft yellow glow in the bottom-end corner,
 * brand paper-plane illustration, two-line copy, outline CTA to /project.
 * Per Hani 2026-05-14: fires the brand confetti burst on mount as a
 * delight moment ("you actually scheduled everything for the week"),
 * matching the celebration animation used after publishing a post
 * (`core-post-celebration.tsx`). The burst is anchored to the card so it
 * lands ABOVE the paper plane and rains down through the card area.
 *
 * Confetti fires once per mount. If the user navigates away and comes
 * back to a still-all-scheduled state, it fires again — that's the
 * spec; we don't gate via SessionStorage. A repeated "you're done!"
 * moment is OK because reaching this state is itself an achievement
 * the user just chose to revisit.
 */
export function EmptyAllScheduledState() {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = cardRef.current
    if (!node) return
    // Origin: horizontally centered on the card, vertically just above
    // its top edge so particles arc DOWN into the card. Math.max guards
    // against the card being scrolled near the very top of the viewport
    // (in which case `top - 30` could go negative and the confetti
    // would render off-screen above the fold).
    const rect = node.getBoundingClientRect()
    const origin = {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: Math.max(0.04, (rect.top - 12) / window.innerHeight),
    }
    confetti({
      particleCount: 90,
      spread: 80,
      startVelocity: 38,
      scalar: 0.9,
      origin,
      colors: ALL_SCHEDULED_CONFETTI_COLORS,
    })
  }, [])

  return (
    <div
      ref={cardRef}
      dir="rtl"
      className="relative overflow-hidden bg-white dark:bg-gray-10 border border-border-neutral-default rounded-xl p-4 flex flex-col items-center gap-2 text-center"
    >
      {/* Decorative yellow ellipse — soft brand glow in the bottom-end
          corner (Figma asset was a blurred yellow ellipse; recreated
          with `blur-3xl` + a tinted bg circle). Visually it sits in
          the bottom-left in RTL display (logical `end`), matching the
          source design's left-offset glow. */}
      <div
        aria-hidden
        className="absolute -bottom-12 -end-12 size-40 rounded-full bg-yellow-50/30 blur-3xl pointer-events-none"
      />

      {/* Paper-plane illustration — the "celebrate" variant (with
          sparkle accents). Sibling to `paper-plane-empty.png` used
          by EmptyNoneReadyState; the celebrate version signals
          "achievement / done" while the empty version signals "ready
          to send". Same shape language, different decoration. */}
      <img
        src="/images/paper-plane-celebrate.png"
        alt=""
        className="relative size-[57px] object-contain"
      />

      <div className="relative flex flex-col gap-1 items-center w-full">
        <p className="text-small-bold text-text-primary-default">
          יסס! כל הפוסטים מתוזמנים!
        </p>
        <p className="text-xs-body text-text-neutral-default">
          רוצים להכין עוד תוכן לשבוע?
        </p>
      </div>

      <Button
        asChild
        variant="outline"
        size="sm"
        className="relative mt-1"
      >
        <Link href="/">יצירת פוסט נוסף</Link>
      </Button>
    </div>
  )
}

/**
 * Empty state: there are unscheduled posts in the inventory but none pass
 * the READY bar (no media + no drive_url, or empty body). Matches the
 * Figma node 407:2446 — bordered card, paper-plane glyph rotated, bold
 * title, two-line description. No CTA button in the spec; the second
 * line of the description already directs the user to the core-post
 * editor as the place to add media.
 *
 * The `count` prop is kept on the signature for backward compatibility
 * with the call site but is no longer surfaced — the new copy speaks to
 * the user state ("there are no scheduling-ready posts") rather than the
 * raw inventory count.
 */
export function EmptyNoneReadyState({ count: _count }: { count: number }) {
  return (
    <div
      dir="rtl"
      className="bg-white dark:bg-gray-10 border border-border-neutral-default rounded-xl p-4 flex flex-col items-center text-center gap-2"
    >
      {/* Paper-plane illustration — Hani's brand asset. Replaces the
          earlier Lucide `Send` placeholder. Lives in /public/images so
          Next-Image isn't required (one decorative PNG, no responsive
          sizing needed). `alt=""` because the heading below carries
          the meaning; this is purely decorative. */}
      <div className="size-[55px] flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/paper-plane-empty.png"
          alt=""
          className="size-10 object-contain"
        />
      </div>
      <div className="flex flex-col gap-1 w-full">
        <p className="text-small-bold text-text-primary-default">
          עדיין אין פוסטים מוכנים לתזמון
        </p>
        <p className="text-xs-body text-text-neutral-default leading-snug">
          על מנת לתזמן פוסט הוא חייב להכיל מדיה או קישור לדרייב
          <br />
          אפשר לערוך את המדיה בעריכת כל פוסט ליבה
        </p>
      </div>
    </div>
  )
}

export function QueueErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-3">
      <p className="text-small-bold text-button-destructive-default">{message}</p>
      <p className="text-xs-body text-text-neutral-default">רעננו את הדף</p>
    </div>
  )
}
