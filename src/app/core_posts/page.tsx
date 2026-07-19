"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Copy,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Trash2,
} from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
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
  /** Per-format first media URL (format → url). Lets the card tell whether
   *  the displayed `primary_media_url` came from the (square) carousel format,
   *  which is shown `contain` instead of cropped. */
  format_media?: Record<string, string>
  created_at: string
  /** Bumped on every edit (body / hook / format scripts / media / cover /
   *  pill colour). Drives the "recently edited first" sort + grouping. */
  updated_at: string
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

  // Inline delete confirmation — the card's trash button used to deep-link
  // into the Sheet (which owned a confirm modal). Hani's call: that flow
  // had too many steps for an intentional destructive action, and felt
  // like the button did nothing when the Sheet animation lagged. We now
  // own a small AlertDialog here, scoped to a single post.
  const [pendingDelete, setPendingDelete] = useState<SavedPost | null>(null)
  const [deleting, setDeleting] = useState(false)
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
  /**
   * Per-format media URL cache. Hydrated from the detail endpoint's new
   * `formatMedia` map so each format's tab shows ITS OWN uploaded asset
   * instead of falling back to the single post-level `primary_media_url`
   * (which is the first non-cover URL across any format — typically the
   * talking_head video — and bled into every other tab before this).
   */
  const [formatMediaById, setFormatMediaById] = useState<
    Record<string, Record<string, string>>
  >({})

  // Extracted so we can refetch on demand — e.g. after the Sheet closes,
  // so any edit made inside it (body / hook / format scripts / media /
  // cover / pill colour) immediately re-sorts the list by updated_at.
  // Without this the list stayed frozen at the mount-time order even
  // though the API was returning the right one.
  const refetchPosts = useCallback(() => {
    return fetch("/api/core-posts", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.posts) setPosts(data.posts)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refetchPosts().finally(() => setLoading(false))
  }, [refetchPosts])

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
        const fm = data?.post?.formatMedia as
          | Record<string, string>
          | undefined
        if (fp) {
          setFormatBodiesById((prev) => ({ ...prev, [activePost.id]: fp }))
        }
        // Always seed the cover cache (even with null) so we don't refetch
        // on a re-open when the post legitimately has no cover.
        setCoverUrlById((prev) => ({
          ...prev,
          [activePost.id]: cover ?? null,
        }))
        // Seed the per-format media cache. Empty object (no media yet on
        // any format) is still cached so we don't refetch on re-open.
        setFormatMediaById((prev) => ({
          ...prev,
          [activePost.id]: fm ?? {},
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
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  // Group by Jerusalem-tz day so each day becomes its own section, matching
  // /hooks. Section header carries the date label ("היום · DD.MM.YY" for
  // today, plain "DD.MM.YY" otherwise); cards inside don't show the date.
  // Day buckets follow `updated_at` (Google-Docs-style "recently edited
  // first") — a post edited today shows under "היום" even if it was
  // created earlier, and inside the day it sits in edit-recency order.
  const groupedByDate: { dayKey: string; label: string; items: SavedPost[] }[] = (() => {
    const groups = new Map<string, SavedPost[]>()
    for (const post of filtered) {
      const key = getDayKey(post.updated_at)
      const existing = groups.get(key)
      if (existing) existing.push(post)
      else groups.set(key, [post])
    }
    return Array.from(groups, ([dayKey, items]) => ({
      dayKey,
      label: formatPostDate(items[0].updated_at),
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
        formatMedia: formatMediaById[activePost.id] as
          | Partial<Record<FormatId, string>>
          | undefined,
        createdAt: activePost.created_at,
        primaryMediaUrl: activePost.primary_media_url ?? null,
        coverUrl: coverUrlById[activePost.id] ?? null,
      }
    : null

  return (
    <AppShell>
      <div className="max-w-[1440px] mx-auto" dir="rtl">
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

        {/* "New: calendar scheduling" banner — sits below the filter row
            so it groups with the post-list controls, not the page header.
            Hidden when there are no posts (the empty-state speaks for
            itself; the banner would be announcing a feature for posts
            that don't exist yet). */}
        {!loading && posts.length > 0 && <CalendarFeatureBanner />}

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
                {/* Cards sized to match the calendar queue-rail card (~218px):
                    auto-fill columns at a ~210px min so each card lands near
                    the rail width and the row packs as many as fit, instead of
                    a fixed 5-up that rendered them oversized. */}
                <div className={viewMode === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4" : "flex flex-col gap-2"}>
                  {items.map((post) => (
                    <CorePostCard
                      key={post.id}
                      post={post}
                      onClick={() => handleOpen(post)}
                      onDelete={() => {
                        // Trash button on the card → inline confirm.
                        // Was previously a deep-link into the Sheet which
                        // felt sluggish + ambiguous; the confirm dialog
                        // below now owns the destructive flow directly.
                        setPendingDelete(post)
                      }}
                      onDuplicate={async () => {
                        // Duplicate flow — copies the full content shape of
                        // the source post so the new card lands in the
                        // same filter buckets:
                        //   1. Fetch the source's `formatPosts` (per-format
                        //      scripts live in `format_variants`, NOT in
                        //      the list endpoint that drove the card list).
                        //   2. POST the copy with body + hook + the copied
                        //      formatPosts + a pre-baked "עותק של: …"
                        //      title (server skips AI-title generation).
                        //
                        // The server creates one `format_variants` row per
                        // format in `formatPosts`, so the duplicate's
                        // `formats` array matches the original and
                        // shows up under the same format filters
                        // (talking_head / story / carousel / image_post).
                        //
                        // Media is intentionally NOT cloned — the copy
                        // lands in the "duplicated, no media yet" state,
                        // which is the natural starting point for the
                        // user to swap in fresh assets.
                        const origTitle =
                          post.title?.trim() ||
                          post.hook_text?.trim() ||
                          "פוסט"
                        const duplicateTitle = `עותק של: ${origTitle}`
                        try {
                          let formatPosts:
                            | Record<string, string>
                            | undefined
                          try {
                            const detailRes = await fetch(
                              `/api/core-posts/${post.id}`,
                            )
                            if (detailRes.ok) {
                              const data = await detailRes.json()
                              const fp = data?.post?.formatPosts
                              if (fp && typeof fp === "object") {
                                formatPosts = fp as Record<string, string>
                              }
                            }
                          } catch (err) {
                            // Detail fetch is best-effort — without it
                            // the copy still gets created, just without
                            // the per-format script variants. Log so a
                            // silent "filter lost my dup" bug surfaces.
                            console.warn(
                              "[core_posts] duplicate: failed to fetch source formatPosts",
                              err,
                            )
                          }
                          const res = await fetch("/api/core-posts", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              body: post.body ?? "",
                              hookText: post.hook_text ?? "",
                              userResponse: "",
                              title: duplicateTitle,
                              formatPosts,
                            }),
                          })
                          if (!res.ok) throw new Error(`status ${res.status}`)
                          toast.success("הפוסט שוכפל")
                          refetchPosts()
                        } catch (err) {
                          console.error("[core_posts] duplicate failed", err)
                          toast.error("השכפול נכשל, נסו שוב")
                        }
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
        onOpenChange={(open) => {
          setSheetOpen(open)
          // Sheet closing → any autosave from inside it has committed by
          // now. Refetch so updated_at-driven order reflects the edit
          // (the API is the source of truth — local state would have to
          // mirror every edit type, which gets brittle fast).
          if (!open) refetchPosts()
        }}
        post={sheetData}
        onDeleted={handleDeleted}
      />

      {/*
        Inline delete-confirm. Copy is verbatim from Hani's brief — the
        body sentence loudly states the irreversibility ("תאבד את כל
        הנתונים ששמרת") because the action is destructive and we can't
        undo it. Action labels stay plural-imperative ("כן למחוק" / "לא
        למחוק") because they ADDRESS the user — distinct from tooltip
        nouns ([[feedback_tooltip_nouns]]).
      */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>בטוח למחוק את הפוסט?</DialogTitle>
            <DialogDescription>
              מחיקה של הפוסט תאבד את כל הנתונים ששמרת.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row-reverse gap-2 w-full sm:justify-start">
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={async () => {
                if (!pendingDelete) return
                setDeleting(true)
                try {
                  const res = await fetch(
                    `/api/core-posts/${pendingDelete.id}`,
                    { method: "DELETE" },
                  )
                  if (!res.ok) throw new Error(`status ${res.status}`)
                  handleDeleted(pendingDelete.id)
                  toast.success("הפוסט נמחק")
                  setPendingDelete(null)
                } catch (err) {
                  console.error("[core_posts] delete failed", err)
                  toast.error("המחיקה נכשלה, נסו שוב")
                } finally {
                  setDeleting(false)
                }
              }}
              className="flex-1"
            >
              {deleting ? "מוחק..." : "כן למחוק"}
            </Button>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
              className="flex-1"
            >
              לא למחוק
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onDuplicate,
}: {
  post: SavedPost
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
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

  // First media the user attached to any of this post's formats (non-cover,
  // video preferred) — surfaced as the card's banner per the 2026-06-30
  // design. `null` → the media slot renders a neutral "no media yet"
  // placeholder instead.
  const mediaUrl = post.primary_media_url?.trim() || null

  // Is the displayed media the (square) carousel asset? Carousels are shown
  // FULLY inside the portrait slot (object-contain + padding) so the 1:1
  // frame isn't cropped — reels/stories/portrait images stay object-cover.
  const mediaIsCarousel =
    !!mediaUrl &&
    Object.entries(post.format_media ?? {}).some(
      ([fmt, url]) => fmt === "carousel" && url === mediaUrl,
    )

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
      className="group relative gap-3 rounded-[12px] border-border-neutral-default bg-white dark:bg-gray-10 p-4 text-right transition-all hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30 shadow-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
    >
      {/* MEDIA — first asset the user attached to any of this post's formats
          (video first-frame or image), scaled to fill a PORTRAIT slot
          (aspect 4:5) so reels / stories / portrait images display naturally
          and the whole card reads as portrait. Carousel assets (square 1:1)
          are shown FULLY — object-contain + gray padding — instead of cropped
          (see `mediaIsCarousel`). No media yet → a neutral gray placeholder
          with an icon + Hebrew "עדיין לא נוספה מדיה". */}
      <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden rounded-lg bg-gray-95">
        {mediaUrl ? (
          <CorePostCardMedia url={mediaUrl} contain={mediaIsCarousel} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-text-neutral-default">
            <ImageIcon className="size-7" aria-hidden />
            <span className="text-small">עדיין לא נוספה מדיה</span>
          </div>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col gap-1.5 p-0">
        {/*
          Title — the hook is the post's most recognisable identity.
          Duplicate detection: posts created via the "שיכפול" flow carry a DB
          `title` stamped "עותק של: …" (the server skips AI-title generation
          for those). We surface that marker as a visible prefix so the
          duplicate is recognisable in the list (both posts share hook_text).
        */}
        {(() => {
          const baseLabel =
            post.hook_text?.trim() ||
            post.title?.trim() ||
            lines[0] ||
            "פוסט ללא כותרת"
          const isDuplicate = post.title?.startsWith("עותק של:")
          const displayLabel = isDuplicate
            ? `עותק של: ${baseLabel}`
            : baseLabel
          return (
            <p className="text-sm font-semibold text-text-primary-default line-clamp-1">
              {displayLabel}
            </p>
          )
        })()}

        {/* Body — preview of the continuation when there's a script. A
            hook-only draft (empty body) shows a centered "started but not
            written" placeholder so the card reads as in-progress, not broken. */}
        {bodyPreview ? (
          <p className="text-sm text-text-primary-default line-clamp-2 leading-relaxed">
            {bodyPreview}
          </p>
        ) : (
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

        {/* FORMAT CHIPS — bottom of the card per the design. `mt-auto` pins
            them to the baseline so cards stretched to a shared grid-row height
            keep chips aligned. Each chip is its own button
            (FormatStatusChipLink): SR announces 4 distinct actions, and it
            stops click propagation so it doesn't double-fire with the card's
            onClick. Neutral chips echo the card's yellow hover; "set" chips
            keep their green identity. */}
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {CARD_CHIP_FORMATS.map((format) => {
            const state = getFormatReadiness(readinessInput, format)
            // Date source matches the Sheet's logic — same helpers, same
            // precedence (published > scheduled).
            const dateValue =
              state === "published"
                ? getPublishedMark(post.id, format)?.publishedAt
                : state === "scheduled"
                  ? getScheduledByPostAndFormat(post.id, format)?.scheduledDate
                  : undefined
            const isSetState =
              state === "scheduled" || state === "published"
            const hoverTintClass = isSetState
              ? undefined
              : state === "ready"
                ? "group-hover:bg-yellow-90 group-hover:text-yellow-30 group-hover:border-yellow-30"
                : "group-hover:bg-yellow-90 group-hover:text-yellow-30"
            return (
              <FormatStatusChipLink
                key={format}
                format={format}
                state={state}
                date={dateValue ?? undefined}
                size="sm"
                showScheduledBadge
                onClick={onClick}
                aria-label={`פתחו פוסט — ${format} — ${state}`}
                chipClassName={hoverTintClass}
              />
            )
          })}
        </div>
      </CardContent>

      {/* HOVER ACTIONS — delete + duplicate, top-end corner (left in RTL),
          revealed on hover/focus and overlaying the media banner's top edge.
          Solid backgrounds keep them legible over any image. The whole card
          (and every chip) opens the Sheet on click, so there's no separate
          always-visible edit arrow — the design omits it.

          The buttons carry the chip's hover palette (yellow-90 bg + yellow-30
          fg); direct icon hover flips to the semantic affordance (red for
          delete, surface-hover for duplicate). Tooltips use noun-form labels
          ("מחיקה", "שיכפול") per the project tone convention. */}
      <div className="absolute top-3 end-3 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              aria-label="מחיקה"
              className="size-7 rounded-md bg-yellow-90 text-yellow-30 hover:bg-red-95 hover:text-red-60 inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-button-destructive-default"
            >
              <Trash2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>מחיקה</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDuplicate()
              }}
              aria-label="שיכפול"
              className="size-7 rounded-md bg-yellow-90 text-yellow-30 hover:bg-bg-surface-hover hover:text-text-primary-default inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              <Copy className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>שיכפול</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  )
}

/**
 * Card banner media — the first asset attached to any of the post's formats.
 * Mirrors FormatThumbnail's video/image detection so a talking_head mp4
 * paints its first frame as a still poster instead of a broken <img>. On a
 * load error it falls back to the same neutral icon the "no media" placeholder
 * uses, so the portrait slot never collapses or shows a broken image.
 *
 * `contain` switches object-cover → object-contain: used for carousel (square)
 * assets so the 1:1 frame shows fully inside the portrait slot with gray
 * padding, instead of being cropped like a reel/story.
 */
function CorePostCardMedia({
  url,
  contain = false,
}: {
  url: string
  contain?: boolean
}) {
  const [errored, setErrored] = useState(false)
  const isVideo =
    /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url) || /\/video\//i.test(url)
  // cover = fill + crop overflow (portrait reels/stories/images); contain =
  // fit whole frame + pad (square carousels). Both keep aspect ratio.
  const fitClass = contain ? "object-contain" : "object-cover"

  if (errored) {
    return (
      <div className="flex size-full items-center justify-center text-text-neutral-default">
        <ImageIcon className="size-7" aria-hidden />
      </div>
    )
  }
  return isVideo ? (
    <video
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      onError={() => setErrored(true)}
      className={`block h-full w-full ${fitClass} pointer-events-none`}
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
      className={`block h-full w-full ${fitClass}`}
    />
  )
}

/**
 * "New: calendar scheduling" announcement banner.
 *
 * Implementation: a full-width PNG provides every visual element
 * (gradient background, dashed motion line, sparkles, calendar
 * illustration). The artwork has no baked text — the right side is
 * intentionally empty so we overlay just the two live lines (title +
 * badge, description) on top. Per Hani 2026-05-14: "שמה לך תמונת
 * png רק תשים עליה את שתי שורות הטקסט".
 *
 * Always-on for now — no dismiss control in the spec. When this feature
 * stops being "new" we can either remove the banner outright or swap it
 * for the same "5 views then auto-hide" pattern QueueHelpCard uses.
 */
function CalendarFeatureBanner() {
  return (
    <div
      dir="rtl"
      className="relative mb-6 flex min-h-[90px] items-center overflow-hidden rounded-xl border border-border-neutral-default bg-gradient-to-r from-white from-[31%] to-[#fffcf0] to-[85%]"
    >
      {/* Calendar illustration — pinned to the visual right edge,
          vertically centered. Carries the calendar card + sparkles. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/banner-calendar.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-[20px] my-auto h-[68px] w-auto select-none"
      />

      {/* Text — right-aligned (RTL start). `ps-[150px]` insets from the
          right so the title + badge clear the calendar illustration. */}
      <div className="flex w-full flex-col gap-1 ps-[150px] pe-[40px]">
        <div className="flex items-center justify-start gap-2">
          <p className="text-small-bold text-text-primary-default whitespace-nowrap">
            תזמון פורמטים של תוכן בלוח שנה
          </p>
          <span className="bg-yellow-60 text-text-primary-default px-2 py-0.5 text-small-bold rounded-full leading-none">
            חדש!
          </span>
        </div>
        <p className="text-xs-body text-text-neutral-default text-right">
          כדי לתזמן חייבת להיות מדיה משוייכת לפורמט.
        </p>
      </div>
    </div>
  )
}
