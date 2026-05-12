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

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { FileText, Inbox, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  TIMING_KEYS,
  getFormatReadiness,
  getScheduledPosts,
  type FormatId,
  type ReadinessPostInput,
} from "@/lib/timing-storage"
import { FormatStatusChip } from "@/components/format-status-chip"
import { HEADER_CHIP_FORMATS } from "@/components/core-post-sheet"


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
  /** Called when an item is clicked — parent opens the Sheet. */
  onItemClick?: (corePostId: string) => void
}

export function QueuePanel({
  onCountChange,
  onDragStartItem,
  onDragEndItem,
  onItemClick,
}: QueuePanelProps) {
  const [allPosts, setAllPosts] = useState<PanelItem[]>([])
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)

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

  useEffect(() => {
    onCountChange?.(unscheduled.length)
  }, [unscheduled.length, onCountChange])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return unscheduled
    return unscheduled.filter((it) => {
      // Search across hook_text first (the actual user-recognizable string)
      // and fall back to title (AI-generated) so an idea/keyword match still
      // surfaces a result.
      const haystack = `${it.hookText ?? ""} ${it.title ?? ""}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [unscheduled, query])

  const handleDragStart = (
    e: React.DragEvent<HTMLLIElement>,
    item: PanelItem,
  ) => {
    e.dataTransfer.setData("text/x-core-post-id", item.corePostId)
    // Phase 3b: also pass the per-post readiness inputs (formats / media /
    // body) on the drag payload so the calendar's drop handler can derive
    // per-format readiness without an extra fetch. This keeps the panel as
    // the single source of "what does each post have", and lets the picker
    // open instantly on drop with no network round-trip.
    e.dataTransfer.setData(
      "application/x-core-post-readiness",
      JSON.stringify({
        corePostId: item.corePostId,
        formats: item.formats,
        formatsWithMedia: item.formatsWithMedia,
        hasBody: item.hasBody,
        displayText: item.hookText ?? item.title ?? null,
      }),
    )
    e.dataTransfer.effectAllowed = "move"
    setDraggingId(item.corePostId)
    onDragStartItem?.(item.corePostId)
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
      // adds matching `pe-[320px]` so its grid doesn't render under us.
      // z-30 = above content but below the topbar (z-50) so the topbar's
      // shadow + sticky behavior still wins.
      className="fixed top-14 bottom-0 end-0 z-30 w-[400px] flex flex-col border-s border-border-neutral-default bg-white dark:bg-gray-10 overflow-hidden"
      aria-label="פאנל פוסטים לתזמון"
    >
      <div className="px-4 py-3 border-b border-border-neutral-default flex items-center gap-2">
        <h3 className="text-text-primary-default text-p-bold flex-1">פוסטים לתזמון</h3>
        <Badge variant="outline" className="tabular-nums">
          {unscheduled.length}
        </Badge>
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
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-bg-surface animate-pulse"
                aria-hidden
              />
            ))}
            <span className="sr-only">טוען פוסטים...</span>
          </div>
        ) : error ? (
          <ErrorState message={error} />
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
          <ul className="flex flex-col gap-2">
            {filtered.map((item) => {
              const isDragging = draggingId === item.corePostId
              const displayText =
                item.hookText?.trim() ||
                item.title?.trim() ||
                "פוסט ללא הוק"
              // Queue cards show formats that are still actionable
              // (state === "ready"), AND formats the user just published
              // during this session — those keep showing with a green V
              // so the user gets visual confirmation. Scheduled formats
              // (still on the calendar but not yet aired) and empty
              // formats remain hidden.
              const readinessInput: ReadinessPostInput = {
                id: item.corePostId,
                formats: item.formats,
                formatsWithMedia: item.formatsWithMedia,
                hasBody: item.hasBody,
              }
              const formatStates = HEADER_CHIP_FORMATS.map((format) => ({
                format,
                state: getFormatReadiness(readinessInput, format),
              })).filter(({ format, state }) => {
                if (state === "ready") return true
                if (
                  state === "published" &&
                  publishedInSession.has(`${item.corePostId}:${format}`)
                ) {
                  return true
                }
                return false
              })
              return (
                <li
                  key={item.corePostId}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onItemClick?.(item.corePostId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onItemClick?.(item.corePostId)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`גררו לתזמון: ${displayText}`}
                  className={`group rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2.5 text-right cursor-grab active:cursor-grabbing transition-all hover:border-yellow-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                    isDragging ? "opacity-50 cursor-grabbing" : ""
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    <p className="text-small text-text-primary-default line-clamp-3 leading-snug">
                      {displayText}
                    </p>
                    {formatStates.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {formatStates.map(({ format, state }) => (
                          <FormatStatusChip
                            key={format}
                            format={format}
                            state={state}
                            size="xs"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function EmptyNoPostsState() {
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

function EmptyAllScheduledState() {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10 px-3">
      <div className="size-12 rounded-full bg-bg-surface-primary-default flex items-center justify-center">
        <Inbox className="size-5 text-text-primary-default" aria-hidden />
      </div>
      <div>
        <p className="text-small-bold text-text-primary-default">
          כל הפוסטים מתוזמנים
        </p>
        <p className="text-xs-body text-text-neutral-default mt-1 leading-relaxed">
          רוצים להוסיף עוד תוכן לשבוע?
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="mt-1">
        <Link href="/project">צרו פוסט נוסף</Link>
      </Button>
    </div>
  )
}

/**
 * Phase 6: residual empty-state when there ARE unscheduled posts in the
 * inventory but none of them pass the READY bar (no media + no drive_url, or
 * empty body). The CTA points to /core_posts where the user can open each
 * post's Sheet and finish the missing piece — that's the surface that owns
 * "what's left to prepare" for the post inventory at large.
 *
 * `count` is the size of the unscheduled-but-not-ready list; we surface it
 * so the user knows scale ("1 post" vs "12 posts") without having to navigate
 * to find out.
 */
function EmptyNoneReadyState({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10 px-3">
      <div className="size-12 rounded-full bg-bg-surface flex items-center justify-center">
        <FileText className="size-5 text-text-neutral-default" aria-hidden />
      </div>
      <div>
        <p className="text-small-bold text-text-primary-default">
          {count === 1
            ? "פוסט אחד מחכה למדיה או סקריפט"
            : `${count} פוסטים מחכים למדיה או סקריפט`}
        </p>
        <p className="text-xs-body text-text-neutral-default mt-1 leading-relaxed">
          כדי לתזמן פוסט, צריך סקריפט והעלאת מדיה לפחות לפורמט אחד —
          או קישור לדרייב במקום מדיה
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="mt-1">
        <Link href="/core_posts">פתחו פוסט להשלמה</Link>
      </Button>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-3">
      <p className="text-small-bold text-button-destructive-default">{message}</p>
      <p className="text-xs-body text-text-neutral-default">רעננו את הדף</p>
    </div>
  )
}
