"use client"

import { useState, useEffect } from "react"
import {
  FileText,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Trash2,
} from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatPostDate, getDayKey } from "@/lib/format-date"
import { CorePostSheet, type CorePostSheetData } from "@/components/core-post-sheet"
import { FormatStatusChipLink } from "@/components/format-status-chip"
import {
  TIMING_KEYS,
  getFormatReadiness,
  getPublishedMark,
  getScheduledByPostAndFormat,
  type FormatId,
  type ReadinessPostInput,
} from "@/lib/timing-storage"

/**
 * Canonical order of formats shown on each /core_posts card. Fixed so the
 * grid reads as a scannable matrix (column 1 always = Story, etc.) rather
 * than "whatever order this post happened to duplicate them in", which
 * would turn the visual into noise when scanning many cards.
 *
 * This list is the single declaration of "the four formats we care about
 * on the card surface" — same set as `HEADER_CHIP_FORMATS` in
 * `core-post-sheet.tsx`. Drift here would mean a card and its Sheet
 * disagree on which formats exist for a post.
 */
const CARD_CHIP_FORMATS: FormatId[] = [
  "story",
  "talking_head",
  "carousel",
  "image_post",
]

interface SavedPost {
  id: string
  title: string | null
  body: string
  hook_text: string | null
  formats: string[]
  /** Subset of formats[] that also have at least one media asset attached. */
  formats_with_media?: string[]
  /** First non-cover media URL found across this post's formats. */
  primary_media_url?: string | null
  created_at: string
}

export default function CorePostsPage() {
  const [posts, setPosts] = useState<SavedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [formatFilter, setFormatFilter] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  // Sheet state — clicking a card opens it instead of navigating away.
  // The Sheet IS the hub (UJM "Sheet כ-Hub") — navigation via "פתחו במסך מלא"
  // is the escape hatch, not the default.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activePost, setActivePost] = useState<SavedPost | null>(null)
  /**
   * Phase 3a: per-format scripts (`formatPosts`) are NOT in the list endpoint —
   * /api/core-posts returns just enough to render cards. When the user opens
   * the Sheet for a card, we fetch `/api/core-posts/[id]` to get the
   * per-format script map and surface it as `formatBodies` so each
   * FormatSection shows the right script. Until that fetch resolves the
   * Sheet falls back to the post-level `body` (the legacy approximation).
   *
   * Keyed by post id so a quick re-open of the same card is instantaneous,
   * and so a stale entry from a previous open doesn't bleed into a fresh one.
   */
  const [formatBodiesById, setFormatBodiesById] = useState<
    Record<string, Record<string, string>>
  >({})
  /**
   * Same lazy-fetch pattern for the post-level cover URL. The list endpoint
   * doesn't carry `coverUrl` (it would mean a second join for every card),
   * so we hydrate from the detail endpoint when the Sheet opens. Without
   * this, the Sheet's cover slot would always render empty for posts opened
   * from /core_posts — even when the talking_head pipeline already saved a
   * cover.
   */
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string | null>>({})

  useEffect(() => {
    fetch("/api/core-posts")
      .then((res) => res.json())
      .then((data) => {
        if (data.posts) setPosts(data.posts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Lazily fetch per-format scripts when a card opens. Cheap (single GET)
  // and gated on cache miss so opening the same card twice doesn't refetch.
  // Same fetch also pulls `coverUrl` so the Sheet's cover slot hydrates
  // from a single round-trip rather than a second targeted endpoint.
  useEffect(() => {
    if (!activePost) return
    // Cache hit on EITHER cache means we already fetched detail for this
    // post — we cache both maps in lockstep below so a single check is fine.
    if (formatBodiesById[activePost.id]) return
    let cancelled = false
    fetch(`/api/core-posts/${activePost.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const fp = data?.post?.formatPosts as
          | Record<string, string>
          | undefined
        const cover = data?.post?.coverUrl as string | null | undefined
        if (fp) {
          setFormatBodiesById((prev) => ({ ...prev, [activePost.id]: fp }))
        }
        // Always seed the cover cache (even with null) so we don't refetch
        // on a re-open when the post legitimately has no cover.
        setCoverUrlById((prev) => ({
          ...prev,
          [activePost.id]: cover ?? null,
        }))
      })
      .catch((err) => {
        console.warn("[core_posts] failed to fetch format bodies", err)
      })
    return () => {
      cancelled = true
    }
  }, [activePost, formatBodiesById])

  const q = searchQuery.trim().toLowerCase()
  const filtered = posts
    .filter((p) => {
      if (formatFilter && !p.formats.includes(formatFilter)) return false
      if (q) {
        const haystack = `${p.title || ""} ${p.body} ${p.hook_text || ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Group by Jerusalem-tz day so each day becomes its own section, matching
  // /hooks. Section header carries the date label ("היום · DD.MM.YY" for
  // today, plain "DD.MM.YY" otherwise); cards inside don't show the date.
  const groupedByDate: { dayKey: string; label: string; items: SavedPost[] }[] = (() => {
    const groups = new Map<string, SavedPost[]>()
    for (const post of filtered) {
      const key = getDayKey(post.created_at)
      const existing = groups.get(key)
      if (existing) existing.push(post)
      else groups.set(key, [post])
    }
    return Array.from(groups, ([dayKey, items]) => ({
      dayKey,
      label: formatPostDate(items[0].created_at),
      items,
    }))
  })()

  const handleOpen = (post: SavedPost) => {
    setActivePost(post)
    setSheetOpen(true)
  }

  const handleDeleted = (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  // Adapt SavedPost → CorePostSheetData. Camel case + only the fields the
  // Sheet needs, so the contract between page and Sheet stays narrow.
  // Phase 3a: include `formatBodies` once the lazy fetch above resolves;
  // before then the Sheet falls back to `body` (the existing approximation).
  const sheetData: CorePostSheetData | null = activePost
    ? {
        id: activePost.id,
        title: activePost.title,
        body: activePost.body,
        hookText: activePost.hook_text,
        formats: activePost.formats,
        formatsWithMedia: activePost.formats_with_media ?? [],
        formatBodies: formatBodiesById[activePost.id],
        createdAt: activePost.created_at,
        primaryMediaUrl: activePost.primary_media_url ?? null,
        coverUrl: coverUrlById[activePost.id] ?? null,
      }
    : null

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <img src="/images/letter-min.png" alt="" className="w-[48px] h-[48px]" />
            <h2 className="text-text-primary-default">פוסטי ליבה</h2>
          </div>
        </div>

        {/* Filter bar + view switcher */}
        {!loading && posts.length > 0 && (
          <div className="flex items-center gap-2 mb-6">
            {[
              { id: "", label: "הכל" },
              { id: "talking_head", label: "דיבור למצלמה" },
              { id: "carousel", label: "קרוסלה" },
              { id: "story", label: "סטורי" },
              { id: "image_post", label: "תמונה" },
            ].map((tab) => (
              <span
                key={tab.id}
                onClick={() => setFormatFilter(tab.id)}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-small transition-colors ${
                  formatFilter === tab.id
                    ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                    : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
                }`}
              >
                {tab.label}
              </span>
            ))}

            <div className="flex-1" />

            {/* Search */}
            <div className="relative w-[200px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-neutral-default pointer-events-none" />
              <Input
                inputSize="small"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש פוסטים..."
                className="ps-8 text-xs"
              />
            </div>

            <div className="flex items-center bg-bg-surface dark:bg-white/5 rounded-lg h-[34px] px-1.5 gap-1">
              <button
                onClick={() => setViewMode("grid")}
                aria-label="תצוגת רשת"
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === "grid"
                    ? "bg-white dark:bg-white/10 shadow-sm text-text-primary-default"
                    : "text-text-neutral-default hover:text-text-primary-default"
                }`}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                aria-label="תצוגת רשימה"
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === "list"
                    ? "bg-white dark:bg-white/10 shadow-sm text-text-primary-default"
                    : "text-text-neutral-default hover:text-text-primary-default"
                }`}
              >
                <List className="size-4" />
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16">
            <Loader2 className="size-5 animate-spin text-yellow-50" />
            <span className="text-small text-text-neutral-default">טוען פוסטים...</span>
          </div>
        )}

        {!loading && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-2xl bg-bg-surface p-6">
              <FileText className="size-10 text-text-neutral-default mx-auto mb-3" />
              <p className="text-p text-text-neutral-default">עדיין אין פוסטי ליבה</p>
              <p className="text-small text-text-primary-disabled mt-1">
                צור פוסט ליבה חדש מהעמוד הראשי
              </p>
            </div>
          </div>
        )}

        {!loading && posts.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <FileText className="size-10 text-text-neutral-default" />
            <p className="text-p text-text-neutral-default">{q ? "לא נמצאו פוסטים" : "אין פוסטים בפורמט הזה"}</p>
          </div>
        )}

        {/* Sections per day — header carries the date label; cards don't
            show the date. Cards open the CorePostSheet preview rather than
            navigating to /project (Sheet pattern from the timing flow). */}
        {!loading && groupedByDate.length > 0 && (
          <div className="flex flex-col gap-8">
            {groupedByDate.map(({ dayKey, label, items }) => (
              <section key={dayKey}>
                <p className="text-small text-text-neutral-default mb-4">{label}</p>
                <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" : "flex flex-col gap-2"}>
                  {items.map((post) => (
                    <CorePostCard
                      key={post.id}
                      post={post}
                      onClick={() => handleOpen(post)}
                      onDelete={() => {
                        // Trash button on the card → open the Sheet which
                        // owns the confirm modal. Acts like a deep-link
                        // "open Sheet focused on delete".
                        setActivePost(post)
                        setSheetOpen(true)
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <CorePostSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        post={sheetData}
        onDeleted={handleDeleted}
      />
    </AppShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Core Post Card — default + hover states                            */
/* ------------------------------------------------------------------ */

function CorePostCard({
  post,
  onClick,
  onDelete,
}: {
  post: SavedPost
  onClick: () => void
  onDelete: () => void
}) {
  const lines = post.body.split("\n").filter(Boolean)
  // The body returned by the AI starts with the hook line, but we also render
  // the hook as the card title — showing both produced the hook twice. Strip
  // the hook from the start of the body for the preview only (the DB body
  // itself is unchanged), so the card reads as "title → continuation" instead
  // of "title → title-again → continuation".
  const hookText = (post.hook_text ?? "").trim()
  const previewLines =
    hookText && lines.length > 0 && lines[0].trim() === hookText
      ? lines.slice(1)
      : lines
  const bodyPreview = previewLines.join("\n")

  // Per-format readiness — re-derived on every render. Cheap (synchronous
  // localStorage reads) and ensures the chip matches the Sheet header
  // when the user opens the post. We bump a `tick` on storage events so
  // a scheduled/published change in another surface (calendar drop,
  // chip-menu unschedule, Sheet checkbox) re-renders the card.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (
        e.key === TIMING_KEYS.scheduled ||
        e.key.startsWith(TIMING_KEYS.publishedPrefix)
      ) {
        setTick((t) => t + 1)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const readinessInput: ReadinessPostInput = {
    id: post.id,
    formats: post.formats,
    formatsWithMedia: post.formats_with_media,
    hasBody: !!post.body?.trim(),
  }
  // `tick` is read into a ref-free scope just to trigger a recompute. The
  // expression is evaluated for its side effect (the dependency).
  void tick

  return (
    <Card
      dir="rtl"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className="group relative h-[200px] gap-4 rounded-[16px] border-border-neutral-default bg-white dark:bg-gray-10 p-4 py-4 text-right transition-all hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30 shadow-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
    >
      {/* Trash on hover — top-start (right in RTL). Sized to match other
          card-corner controls; opacity-0 → opacity-100 on group hover so it
          stays out of the way until needed. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        aria-label="מחקו את הפוסט"
        className="absolute top-3 start-3 size-7 rounded-md bg-white/80 dark:bg-gray-10/80 hover:bg-red-95 text-text-neutral-default hover:text-red-60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-button-destructive-default"
      >
        <Trash2 className="size-3.5" />
      </button>

      <CardContent className="flex flex-1 flex-col gap-2 p-0">
        {/* Title — the hook is the most recognisable hook of the post. */}
        <p className="text-sm font-semibold text-text-primary-default line-clamp-1">
          {post.hook_text ?? post.title ?? lines[0] ?? "פוסט ללא כותרת"}
        </p>

        {/* Body — preview of the continuation when there's a script. When
            the user only generated a hook (draft with empty body), surface a
            centered placeholder so the card reads as "started but not yet
            written" instead of looking incomplete or broken. */}
        {bodyPreview ? (
          <p className="text-sm text-text-primary-default line-clamp-3 leading-relaxed">
            {bodyPreview}
          </p>
        ) : (
          // Empty-body draft state: the section mascot (paper airplane =
          // letter-min.png) in grayscale + muted text. Grayscale keeps the
          // illustration recognisably "ours" while signalling "not yet
          // active". The flex column slots into the same vertical room as
          // a 3-line body preview so the fixed-height card stays balanced.
          <div className="flex flex-col items-center justify-center gap-1.5 py-1">
            <img
              src="/images/letter-min.png"
              alt=""
              className="w-7 h-7 grayscale opacity-50"
            />
            <p className="text-sm text-text-neutral-default text-center leading-relaxed">
              יש אחלה הוק! אבל עדיין אין סקריפט
              <br />
              המשיכו ליצור את הפוסט הזה
            </p>
          </div>
        )}

        {/* Per-format status chips — the card's "what's done" row,
            pinned to the bottom via mt-auto pt-3 so the chips always
            sit at the same vertical position regardless of body
            preview length. Each chip shows full readiness
            (empty | ready | scheduled | published) — the card is
            therefore a true at-a-glance status, including dates for
            scheduled/published formats, so the user doesn't need to
            open the Sheet to see "is this on the calendar yet?".

            Each chip is its own button (FormatStatusChipLink) so screen
            readers announce 4 distinct actions per card. We stop click
            propagation in the chip wrapper so it doesn't double-fire
            with the card's outer onClick. */}
        <div className="flex flex-wrap gap-1.5 mt-auto pt-3">
          {CARD_CHIP_FORMATS.map((format) => {
            const state = getFormatReadiness(readinessInput, format)
            // Date source matches the Sheet's logic exactly — same helpers,
            // same precedence (published > scheduled). A drift here would
            // make a card disagree with its own Sheet, which is the worst
            // failure mode for an at-a-glance surface.
            const dateValue =
              state === "published"
                ? getPublishedMark(post.id, format)?.publishedAt
                : state === "scheduled"
                  ? getScheduledByPostAndFormat(post.id, format)?.scheduledDate
                  : undefined
            return (
              <FormatStatusChipLink
                key={format}
                format={format}
                state={state}
                date={dateValue ?? undefined}
                size="sm"
                // /core_posts cards are the only surface that opts into
                // the green V badge — it's the "this format is on the
                // calendar" at-a-glance signal. Other surfaces convey
                // scheduled/published in their own way (Sheet header
                // chips scroll, calendar uses opacity+position).
                showScheduledBadge
                onClick={onClick}
                aria-label={`פתחו פוסט — ${format} — ${state}`}
              />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
