"use client"

/**
 * CorePostSheet — the unified Hub for a single core post.
 *
 * One Sheet covers the three contexts the UJM identifies:
 *   1. Discovery / Preparation (`/core_posts` → click a card)
 *   2. Scheduling review (`/calendar` → click a scheduled chip)
 *   3. Day-of-publish (`/calendar` → today's chip)
 *
 * IA principle (lessons.md → "ישות אחת = surface אחד"): a core post is one
 * entity. Surfacing it through three different routes/dialogs would create
 * inconsistency the moment any of them drifted. So this Sheet is the single
 * surface; the only thing that changes between contexts is the footer CTA.
 *
 * Tabs refactor (2026-05-06):
 *   The body used to render four FormatSections stacked vertically with a
 *   navigation chips row above them. The chip row was a *navigation duplicate*
 *   of the four sections — clicking a chip just scrolled to its section, so
 *   the user could "see all four" by either glancing at the chips OR scrolling
 *   the body. Lessons.md's "אינטראקציה אחת = פתרון UI אחד" + Hick's Law both
 *   say: if two affordances answer the same question (which format, what
 *   state), keep one. We replaced both with a `<Tabs>`: TabsList is the
 *   at-a-glance summary AND the navigation; TabsContent is the focused panel
 *   for the active format. Scroll length collapsed by ~75% (one panel
 *   instead of four), and the user is no longer asked to track four parallel
 *   formats in working memory at once.
 *
 * Why side="left"?  Hebrew is RTL. The sidebar nav lives on the right (the
 * RTL "start"); we don't want to occlude it. Sliding from the left = the
 * Sheet is read as "an overlay that opens *into* the canvas", not "a drawer
 * that ate my nav".
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmModal } from "@/components/confirm-modal"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { createClient } from "@/lib/supabase/client"
import { isOwner } from "@/lib/owner"
import {
  TIMING_KEYS,
  getCorePostMeta,
  getFormatReadiness,
  getPublishedMap,
  getScheduledByPostId,
  markPublished,
  removeFromTiming,
  setCorePostMeta,
  setFormatMeta,
  unmarkPublished,
  type CorePostMeta,
  type FormatId,
  type FormatReadiness,
  type PublishedMap,
  type ReadinessPostInput,
} from "@/lib/timing-storage"
import {
  FormatStatusChip,
  FormatStatusChipLink,
  getFormatChipLabel,
} from "@/components/format-status-chip"

export type CorePostSheetData = {
  id: string
  title: string | null
  /**
   * Post-level body. Kept as a fallback for formats that don't have an entry
   * in `formatBodies` (legacy posts, formats inherited from the global
   * script). Phase 3a wired per-format scripts; new callers should always
   * pass `formatBodies` and treat `body` as the source of truth ONLY for the
   * "no per-format script exists" case.
   */
  body: string
  hookText: string | null
  /** Format ids the post has been duplicated into (has a format_variants row). */
  formats: string[]
  /**
   * Subset of `formats` whose variants have at least one non-cover media
   * asset. Drives per-format readiness in the Sheet. Pages that don't yet
   * carry this field can pass `[]` — readiness will fall back to the
   * body-presence heuristic.
   */
  formatsWithMedia?: string[]
  /**
   * Per-format script bodies — the API's `formatPosts: Record<format, body>`.
   * Phase 3a uses this as the authoritative source for what each format's
   * panel displays in its script block. When a format isn't a key here, the
   * panel falls back to the post-level `body`.
   */
  formatBodies?: Record<FormatId, string>
  /**
   * Per-format primary media URL. Optional because today's API surfaces only
   * a single `primaryMediaUrl` at the post level + a `formatsWithMedia` set
   * (which formats own at least one asset, but not which URL belongs to
   * which). When the API exposes per-format media, callers should populate
   * this — the Sheet will prefer it over `primaryMediaUrl` for any format
   * that has an entry.
   */
  formatMedia?: Partial<Record<FormatId, string>>
  createdAt: string
  /** First media URL we know about, if any (for the preview thumbnail). */
  primaryMediaUrl?: string | null
  /**
   * Cover image URL — currently only generated for `talking_head` (the
   * reel-cover pipeline that auto-runs when the user uploads a video).
   * Optional because not every post has a cover, and because legacy callers
   * may not pass it. The Sheet's media slot reads this for the cover tile;
   * if it's missing the slot falls back to the empty CTA state.
   */
  coverUrl?: string | null
  /** Avatar URL if the user uploaded one — appended below the media block. */
  avatarUrl?: string | null
}

type Product = { id: string; name: string }

export type CorePostSheetProps = {
  /** Controlled open state. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The post to render. `null` while loading or when nothing is selected. */
  post: CorePostSheetData | null
  /**
   * Optional format to scroll to when the Sheet opens. Pages that opened the
   * Sheet from a per-format affordance (e.g. the calendar's day-cell chip
   * that knows which format was clicked) should pass that format here so the
   * user lands on the relevant tab instead of the default.
   */
  initialFormat?: FormatId
  /** Called after a successful delete (so the parent can drop the row). */
  onDeleted?: (id: string) => void
  /**
   * Called after the user clicks "תזמנו בלוח שנה" inside the Sheet (only
   * relevant when the post is NOT already scheduled). Defaults to navigating
   * to /calendar — pages can override to keep the user in context (e.g. the
   * calendar itself just closes the Sheet).
   */
  onScheduleClick?: () => void
}

/**
 * The four formats whose tabs we always render — in this canonical order.
 * Showing a tab per format (even when the post hasn't been duplicated into
 * that format) is intentional: the empty-state panel surfaces the gap, which
 * is the user's "what's left to do" cue. Same logic that drives /core_posts
 * cards.
 */
export const HEADER_CHIP_FORMATS: FormatId[] = [
  "story",
  "talking_head",
  "carousel",
  "image_post",
]

/* ------------------------------------------------------------------ */
/*  Default tab selection                                               */
/* ------------------------------------------------------------------ */

/**
 * Pick which tab should be active when the Sheet opens.
 *
 * Priority (highest first):
 *   1. `initialFormat` from the caller (calendar chip / picker drill-in).
 *   2. The closest upcoming scheduled format (helps the day-of-publish
 *      review case land on the right format without a click).
 *   3. The first format that's in `ready` or `published` state.
 *   4. The first format in HEADER_CHIP_FORMATS.
 */
function pickInitialTab(
  initialFormat: FormatId | undefined,
  scheduledRows: Array<{ format: FormatId; date: string }>,
  readinessByFormat: Record<FormatId, FormatReadiness>,
): FormatId {
  if (initialFormat && HEADER_CHIP_FORMATS.includes(initialFormat)) {
    return initialFormat
  }

  if (scheduledRows.length > 0) {
    // Sort by date ascending — the closest upcoming first. We compare by
    // date string because YYYY-MM-DD sorts lexicographically the same as
    // chronologically.
    const sorted = [...scheduledRows].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    )
    const next = sorted.find((r) => HEADER_CHIP_FORMATS.includes(r.format))
    if (next) return next.format
  }

  const firstReady = HEADER_CHIP_FORMATS.find(
    (f) =>
      readinessByFormat[f] === "ready" || readinessByFormat[f] === "published",
  )
  if (firstReady) return firstReady

  return HEADER_CHIP_FORMATS[0]
}

/* ------------------------------------------------------------------ */
/*  Copy-to-clipboard floating icon                                    */
/* ------------------------------------------------------------------ */

/**
 * Small floating icon button that copies a string to the clipboard. Per
 * Hani: every text surface in the Sheet should expose a copy affordance
 * without changing the underlying layout. We render it `position: absolute`
 * inside any `relative` parent — so it floats over the corner of the text
 * block. After copy: swap the icon to a checkmark for ~1.5s as feedback.
 */
function CopyIconButton({
  text,
  ariaLabel,
  className,
}: {
  text: string
  ariaLabel?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error("clipboard write failed", err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "הועתק" : (ariaLabel ?? "העתיקו טקסט")}
      className={[
        "absolute top-2 left-2 inline-flex items-center justify-center",
        "size-7 rounded-md bg-white/90 dark:bg-gray-10/90 backdrop-blur-sm",
        "border border-border-neutral-default",
        "text-text-neutral-default hover:text-text-primary-default",
        "hover:bg-bg-surface transition-colors",
        "opacity-70 hover:opacity-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 focus-visible:opacity-100",
        "z-10",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  )
}

/**
 * Inline (in-input) copy button. Lighter visual than `CopyIconButton` —
 * no border / no backdrop — designed to sit inside a form field next to
 * other action icons (e.g. the Drive open-link button). Same copy +
 * confirmation behavior.
 */
function InlineCopyButton({
  value,
  ariaLabel,
  disabled,
  className,
}: {
  value: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const isEmpty = value.length === 0

  const handleCopy = async () => {
    if (isEmpty || disabled) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error("clipboard write failed", err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={isEmpty || disabled}
      aria-label={copied ? "הועתק" : (ariaLabel ?? "העתיקו טקסט")}
      className={[
        "inline-flex items-center justify-center size-7 rounded-md",
        "text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  )
}

/**
 * Compact post-level trigger word field. Lives in the master script header
 * row next to the product dropdown. Same auto-save pattern as the per-format
 * input (commit on blur / Enter); local mirror so keystrokes are immediate
 * while writes are committed only when needed.
 */
function PostTriggerWordField({
  value,
  onSave,
}: {
  value: string
  onSave: (word: string) => void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])

  const commit = () => {
    if (local.trim() === (value ?? "").trim()) return
    onSave(local.trim())
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="post-trigger-word">מילת טריגר</Label>
      <Input
        id="post-trigger-word"
        dir="rtl"
        inputSize="small"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
        placeholder="טריגר"
        className="text-right min-w-[72px] max-w-[96px]"
        aria-label="מילת טריגר לפוסט"
      />
    </div>
  )
}

export function CorePostSheet({
  open,
  onOpenChange,
  post,
  initialFormat,
  onDeleted,
  onScheduleClick,
}: CorePostSheetProps) {
  const router = useRouter()

  // Local meta — the post-level slice. The per-format slices live inside
  // `meta.byFormat` and are read via `getFormatMeta(postId, format)` so
  // legacy fallbacks are honored in one place.
  const [meta, setMetaLocal] = useState<CorePostMeta>({})

  // Products list for the Select. Loaded lazily once per Sheet open so we
  // don't fire a query on every page that mounts the Sheet.
  const [products, setProducts] = useState<Product[] | null>(null)
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)

  // Schedule + published — read once on open and refresh on storage events.
  const [scheduledRows, setScheduledRows] = useState<
    Array<{ format: FormatId; date: string; time?: string | null }>
  >([])
  const [publishedMap, setPublishedMap] = useState<PublishedMap>({})

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Owner gate. /calendar is owner-only, so the "תזמון בלוח" footer
  // CTA in the Sheet's format-detail view shouldn't show for everyone
  // else — it would just bounce them home. Defaults to false so a slow
  // auth fetch never flashes the CTA to non-owners.
  const [ownerView, setOwnerView] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isOwner(user?.email)) setOwnerView(true)
    })
  }, [])

  // Active tab — controlled so we can react to `initialFormat` after the
  // Sheet hydrates AND let the user freely switch tabs after that.
  const [activeTab, setActiveTab] = useState<FormatId>(HEADER_CHIP_FORMATS[0])

  // Two-screen Sheet: null = master overview (script + chips); set =
  // we've drilled into a specific format's detail view. Click on a chip
  // sets this; the back arrow in the format-view header clears it.
  const [selectedFormat, setSelectedFormat] = useState<FormatId | null>(null)
  // The format the detail panel is *currently rendering*. Latched on
  // forward navigation (synchronously, alongside `selectedFormat`) so the
  // detail panel never slides in empty. Stays put on back nav so the
  // slide-out animation keeps showing the last format's content instead
  // of flashing.
  const [renderFormat, setRenderFormat] = useState<FormatId | null>(null)
  const navigateToFormat = (format: FormatId) => {
    setRenderFormat(format)
    setSelectedFormat(format)
  }
  const navigateBack = () => {
    setSelectedFormat(null)
    // intentionally NOT clearing renderFormat — let the slide-out finish
    // with the last content visible.
  }

  // Track whether we've already chosen the initial tab for this open session.
  // Without this guard, every storage event (publishing a format, etc.) would
  // re-run pickInitialTab and yank the user back to the "default" tab.
  const initialTabPicked = useRef(false)

  const postId = post?.id ?? null

  /**
   * Whether ANY format of this post is currently scheduled. The footer's CTA
   * + helper text used to key off a single (primaryFormat) scheduled row;
   * with per-format panels that's no longer meaningful. The footer now
   * speaks at the post level: "this post has at least one format on the
   * calendar — go edit it" vs. "nothing on the calendar yet — go schedule".
   */
  const anyFormatScheduled = scheduledRows.length > 0

  // --- hydrate from storage on open / postId change ------------------------
  useEffect(() => {
    if (!open || !postId) {
      initialTabPicked.current = false
      // Reset to master view when Sheet closes / postId switches.
      setSelectedFormat(null)
      return
    }
    setMetaLocal(getCorePostMeta(postId))
    const rows = getScheduledByPostId(postId).map((r) => ({
      format: r.format,
      date: r.scheduledDate,
      time: r.scheduledTime,
    }))
    setScheduledRows(rows)
    setPublishedMap(getPublishedMap(postId))
  }, [open, postId])

  // Stay in sync with storage updates from any source (calendar grid, chip
  // menu, this same Sheet on another tab).
  useEffect(() => {
    if (!open || !postId) return
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (e.key === TIMING_KEYS.scheduled) {
        const rows = getScheduledByPostId(postId).map((r) => ({
          format: r.format,
          date: r.scheduledDate,
          time: r.scheduledTime,
        }))
        setScheduledRows(rows)
      }
      if (e.key === TIMING_KEYS.publishedPrefix + postId) {
        setPublishedMap(getPublishedMap(postId))
      }
      if (e.key === TIMING_KEYS.metaPrefix + postId) {
        setMetaLocal(getCorePostMeta(postId))
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [open, postId])

  // --- products fetch on open --------------------------------------------
  useEffect(() => {
    if (!open) return
    if (products !== null || productsLoading) return
    setProductsLoading(true)
    setProductsError(null)
    const supabase = createClient()
    supabase.auth
      .getUser()
      .then(async ({ data: { user } }) => {
        if (!user) {
          setProducts([])
          setProductsLoading(false)
          return
        }
        const { data, error } = await supabase
          .from("products")
          .select("id, name")
          .eq("user_id", user.id)
        if (error) {
          setProductsError("שגיאה בטעינת מוצרים")
        } else {
          setProducts((data as Product[]) ?? [])
        }
        setProductsLoading(false)
      })
      .catch(() => {
        setProductsError("שגיאה בטעינת מוצרים")
        setProductsLoading(false)
      })
  }, [open, products, productsLoading])

  // --- derived: per-format readiness map ----------------------------------
  // One projection used by everything below (TabsTrigger chips, TabsContent
  // panels) so chip and panel can never disagree on "is this format ready?".
  const readinessByFormat = useMemo(() => {
    if (!post) {
      return Object.fromEntries(
        HEADER_CHIP_FORMATS.map((f) => [f, "empty" as FormatReadiness]),
      ) as Record<FormatId, FormatReadiness>
    }

    const hasBodyByFormat = post.formatBodies
      ? (Object.fromEntries(
          Object.entries(post.formatBodies).map(([fmt, b]) => [
            fmt,
            !!b?.trim(),
          ]),
        ) as Partial<Record<FormatId, boolean>>)
      : undefined
    const readinessInput: ReadinessPostInput = {
      id: post.id,
      formats: post.formats,
      formatsWithMedia: post.formatsWithMedia,
      hasBody: !!post.body?.trim(),
      hasBodyByFormat,
    }
    const map: Record<string, FormatReadiness> = {}
    for (const format of HEADER_CHIP_FORMATS) {
      map[format] = getFormatReadiness(readinessInput, format)
    }
    return map as Record<FormatId, FormatReadiness>
    // We intentionally include `scheduledRows`, `publishedMap` and `meta`
    // here — `getFormatReadiness` reads from storage internally, so when
    // those change (or when the user types a drive URL into meta) we want
    // this projection to recompute. Without `meta` here, typing a drive
    // link in the panel wouldn't flip readiness from empty → ready until
    // the next external storage event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, scheduledRows, publishedMap, meta])

  // --- pick the active tab once per open session --------------------------
  useEffect(() => {
    if (!open || !post) return
    if (initialTabPicked.current) return
    const next = pickInitialTab(initialFormat, scheduledRows, readinessByFormat)
    setActiveTab(next)
    initialTabPicked.current = true
  }, [open, post, initialFormat, scheduledRows, readinessByFormat])

  // --- meta write helpers --------------------------------------------------
  const patchMeta = (patch: Partial<CorePostMeta>) => {
    setMetaLocal((prev) => {
      const next = { ...prev, ...patch }
      if (postId) setCorePostMeta(postId, patch)
      return next
    })
  }

  // --- derived UI strings --------------------------------------------------
  const dateChip = useMemo(() => {
    if (!post?.createdAt) return ""
    return new Date(post.createdAt).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    })
  }, [post?.createdAt])

  /**
   * "Long" copy of a scheduled date for the confirm-delete dialog. We only
   * surface it when at least one format is scheduled — otherwise the dialog
   * skips the calendar warning entirely.
   */
  const firstScheduledLabel = useMemo(() => {
    const first = scheduledRows[0]
    if (!first) return null
    try {
      const [y, m, d] = first.date.split("-").map((s) => parseInt(s, 10))
      const date = new Date(y, m - 1, d)
      const dateStr = date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
      return first.time ? `${dateStr} בשעה ${first.time}` : dateStr
    } catch {
      return first.date
    }
  }, [scheduledRows])

  // --- handlers ------------------------------------------------------------
  const handleOpenFull = () => {
    if (!postId) return
    onOpenChange(false)
    // If the user is on the format detail screen, pass that format so
    // /project lands on the same context. Otherwise just open the post.
    const url = selectedFormat
      ? `/project?post_id=${postId}&format=${selectedFormat}`
      : `/project?post_id=${postId}`
    router.push(url)
  }

  const handleGoToCalendar = () => {
    if (onScheduleClick) {
      onScheduleClick()
      return
    }
    onOpenChange(false)
    // The schedule CTA only exists in format detail (Screen 2), so we
    // always have `selectedFormat` here. Pass it as context to /calendar.
    if (selectedFormat) {
      router.push(`/calendar?post_id=${postId}&format=${selectedFormat}`)
    } else {
      router.push("/calendar")
    }
  }

  const handleEditSchedule = () => {
    onOpenChange(false)
    router.push("/calendar")
  }

  const handleToggleFormatPublished = (format: FormatId) => {
    if (!postId) return
    const isPublished = !!publishedMap[format]?.publishedAt
    if (isPublished) {
      unmarkPublished(postId, format)
      setPublishedMap((prev) => {
        const next = { ...prev }
        delete next[format]
        return next
      })
    } else {
      markPublished(postId, format)
      setPublishedMap((prev) => ({
        ...prev,
        [format]: { publishedAt: new Date().toISOString() },
      }))
    }
  }

  const handleCreateScriptForFormat = (format: FormatId) => {
    if (!postId) return
    onOpenChange(false)
    router.push(`/project?post_id=${postId}&format=${format}`)
  }

  const handleConfirmDelete = async () => {
    if (!postId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/core-posts/${postId}`, { method: "DELETE" })
      if (!res.ok) {
        console.warn("[core-post-sheet] DELETE returned", res.status)
      }
      removeFromTiming(postId)
      onDeleted?.(postId)
      onOpenChange(false)
    } catch (err) {
      console.error("[core-post-sheet] delete failed", err)
    } finally {
      setDeleting(false)
    }
  }

  const titleText = post?.hookText?.trim() || post?.title?.trim() || "פוסט ליבה"

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          dir="rtl"
          showCloseButton={false}
          className="w-full sm:max-w-[680px] p-0 flex flex-col"
          // Prevent auto-focus on the close button (or any header icon) so
          // its tooltip doesn't fire on Sheet open. Per Hani: tooltips
          // should appear on hover, not from initial focus.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Sticky header — title (right in RTL) + icon-only actions
              (left in RTL). Per Hani: actions sit on the visual LEFT,
              with 8px-radius hover background and tooltips. */}
          <header className="sticky top-0 z-10 bg-white dark:bg-gray-10 border-b border-border-neutral-default px-6 py-4 flex flex-col gap-3">
            {/* Top row — depends on Sheet mode.
                Master: [title (right)] [icons (left)]
                Format detail: [back-link + format chip (right)] [icons (left)]
                                with the title moving down to its own row. */}
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {selectedFormat !== null && post ? (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={navigateBack}
                      className="inline-flex items-center gap-1 text-small text-text-primary-default hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-lg px-2 py-1 transition-colors"
                      aria-label="חזרה לסקריפט"
                    >
                      <ChevronRight className="size-4" aria-hidden />
                      חזרה
                    </button>
                    <FormatStatusChip
                      format={selectedFormat}
                      state={readinessByFormat[selectedFormat]}
                      date={
                        readinessByFormat[selectedFormat] === "scheduled"
                          ? scheduledRows.find(
                              (r) => r.format === selectedFormat,
                            )?.date
                          : readinessByFormat[selectedFormat] === "published"
                            ? publishedMap[selectedFormat]?.publishedAt
                            : undefined
                      }
                      size="sm"
                      className="pointer-events-none"
                    />
                  </div>
                ) : (
                  <>
                    <SheetTitle className="text-lg font-bold text-text-primary-default line-clamp-3 text-right leading-snug">
                      {titleText}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                      פרטים מלאים לפוסט ליבה — סקריפט, מדיה, ופרטים לתזמון.
                    </SheetDescription>
                    {dateChip && (
                      <p className="text-xs-body text-text-neutral-default mt-1.5 text-right">
                        {dateChip}
                      </p>
                    )}
                  </>
                )}
              </div>
              {/* Actions — DOM-last so they render on the visual LEFT in
                  RTL flex. Only shown in the master view; in the detail
                  view the only way out is the back button (per Hani: "to
                  exit, the user goes back first"). Tooltips open instantly
                  on hover; the SheetContent's `onOpenAutoFocus` prevents
                  initial focus from triggering them on Sheet open. */}
              {selectedFormat === null && (
                <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={handleOpenFull}
                          aria-label="פתיחה בעמוד הפוסט"
                          className="rounded-lg"
                        >
                          <ExternalLink className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        פתיחה בעמוד הפוסט
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SheetClose asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="סגירה"
                            className="rounded-lg"
                          >
                            <X className="size-4" />
                          </Button>
                        </SheetClose>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">סגירה</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              )}
            </div>
            {/* Title row — only rendered in format detail (because the
                top row used the title slot for the back+chip combo). */}
            {selectedFormat !== null && (
              <div>
                <SheetTitle className="text-lg font-bold text-text-primary-default line-clamp-3 text-right leading-snug">
                  {titleText}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  פרטים מלאים לפוסט ליבה — סקריפט, מדיה, ופרטים לתזמון.
                </SheetDescription>
                {dateChip && (
                  <p className="text-xs-body text-text-neutral-default mt-1.5 text-right">
                    {dateChip}
                  </p>
                )}
              </div>
            )}
          </header>

          {/* Body — two screens (master + format detail) animated as a
              horizontal slide. RTL convention: forward navigation slides
              the new screen in from the LEFT and the old screen out to
              the RIGHT (both panels translate rightward together). The
              detail panel uses `renderFormat` (latched on forward nav)
              so its content stays visible during slide-out. */}
          <div
            dir="rtl"
            className="flex-1 relative overflow-hidden"
          >
            {!post && (
              <div className="absolute inset-0 flex items-center justify-center py-12">
                <Loader2 className="size-5 animate-spin text-yellow-50" />
              </div>
            )}

            {/* Master view */}
            <div
              dir="rtl"
              aria-hidden={selectedFormat !== null}
              className={[
                "absolute inset-0 overflow-y-auto px-6 py-5 flex flex-col gap-7 text-right",
                "transition-transform duration-300 ease-out will-change-transform",
                selectedFormat === null ? "translate-x-0" : "translate-x-full",
              ].join(" ")}
            >
            {post && (
              <>
                {/* --- Master script ---
                    Always visible above the format tabs. This is the core
                    post script — the shared idea before format adaptation.
                    Per Hani: "תמיד מול העיניים" — first thing the user sees
                    on Sheet open. Linked product (post-level metadata) sits
                    on the same row as the heading. Each tab below shows how
                    that idea was adapted per format. */}
                {post.body?.trim() && (
                  <section aria-labelledby="master-script-heading">
                    <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
                      <h3
                        id="master-script-heading"
                        className="text-base font-bold text-text-primary-default"
                      >
                        הסקריפט
                      </h3>
                      <div className="flex items-center gap-4 shrink-0">
                        {/* Product (RTL: appears on the right of this group) */}
                        <div className="flex items-center gap-2">
                          <Label htmlFor="product-id">מוצר</Label>
                          <Select
                            id="product-id"
                            selectSize="small"
                            value={meta.productId ?? ""}
                            onChange={(e) =>
                              patchMeta({ productId: e.target.value || null })
                            }
                            disabled={productsLoading}
                            className="min-w-[140px]"
                          >
                            <option value="">ללא מוצר</option>
                            {productsError && (
                              <option value="" disabled>
                                שגיאה בטעינת מוצרים
                              </option>
                            )}
                            {!productsError &&
                              products &&
                              products.length === 0 && (
                                <option value="" disabled>
                                  לא הוספתם עדיין מוצרים
                                </option>
                              )}
                            {!productsError &&
                              products &&
                              products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </Select>
                        </div>
                        {/* Trigger word (RTL: appears on the left of this group) */}
                        <PostTriggerWordField
                          value={meta.triggerWord ?? ""}
                          onSave={(word) =>
                            patchMeta({ triggerWord: word || undefined })
                          }
                        />
                      </div>
                    </div>
                    <div className="relative bg-bg-surface border border-border-neutral-default rounded-md px-4 py-3 text-right">
                      <CopyIconButton
                        text={post.body}
                        ariaLabel="העתיקו את הסקריפט המרכזי"
                      />
                      <p className="text-small text-text-primary-default whitespace-pre-wrap leading-relaxed pl-9">
                        {post.body}
                      </p>
                    </div>
                  </section>
                )}

                {/* --- Formats — chips that navigate to the format edit page ---
                    Per Hani: the side panel splits into two screens. Screen 1
                    (this Sheet) shows the master script + format chips.
                    Clicking a chip navigates to /project?post_id=X&format=Y
                    (the format edit screen). The Sheet itself never shows
                    per-format detail; that lives on its own page. */}
                <section aria-labelledby="formats-heading">
                  <h3
                    id="formats-heading"
                    className="text-base font-bold text-text-primary-default mb-3"
                  >
                    פורמטים
                  </h3>

                  <div
                    dir="rtl"
                    className="flex flex-wrap gap-2"
                    role="list"
                  >
                    {HEADER_CHIP_FORMATS.map((format) => {
                      const state = readinessByFormat[format]
                      const scheduledRow = scheduledRows.find(
                        (r) => r.format === format,
                      )
                      const publishedAt = publishedMap[format]?.publishedAt
                      const dateValue =
                        state === "scheduled"
                          ? scheduledRow?.date
                          : state === "published"
                            ? publishedAt
                            : undefined

                      return (
                        <div role="listitem" key={format}>
                          <FormatStatusChipLink
                            format={format}
                            state={state}
                            date={dateValue ?? undefined}
                            size="md"
                            onClick={() => navigateToFormat(format)}
                          />
                        </div>
                      )
                    })}
                  </div>
                </section>

              </>
            )}
            </div>

            {/* Detail view — animated panel. Always mounted (so the slide
                animation works in both directions); rendered with
                `renderFormat` (latched on forward nav) so the content
                stays visible during slide-out. */}
            <div
              dir="rtl"
              aria-hidden={selectedFormat === null}
              className={[
                "absolute inset-0 overflow-y-auto px-6 py-5 flex flex-col gap-5 text-right",
                "transition-transform duration-300 ease-out will-change-transform",
                selectedFormat === null ? "-translate-x-full" : "translate-x-0",
              ].join(" ")}
            >
            {post && renderFormat !== null && (() => {
              const format = renderFormat
              const state = readinessByFormat[format]
              const scheduledRow = scheduledRows.find(
                (r) => r.format === format,
              )
              const publishedAt = publishedMap[format]?.publishedAt
              const perFormatBody = post.formatBodies?.[format]
              const sectionBody =
                perFormatBody !== undefined ? perFormatBody : post.body
              const formatHasMedia =
                post.formatsWithMedia?.includes(format) ?? false
              const perFormatMedia = post.formatMedia?.[format]
              const mediaUrl =
                perFormatMedia ??
                (formatHasMedia ? (post.primaryMediaUrl ?? null) : null)
              // Cover lives at the post level today (only `talking_head` ever
              // generates one via the reel-cover pipeline). Surface it ONLY
              // for the talking_head detail panel — other formats don't have
              // a "cover" concept, and showing the talking_head cover under
              // a story / carousel detail panel would mislead the user.
              const formatCoverUrl =
                format === "talking_head" ? (post.coverUrl ?? null) : null
              const slice = meta.byFormat?.[format] ?? {}
              const formatMeta = {
                driveUrl: slice.driveUrl ?? meta.driveUrl,
                triggerWord: slice.triggerWord ?? meta.triggerWord,
              }
              const formatLabel = getFormatChipLabel(format)

              return (
                <section
                  aria-labelledby="format-detail-heading"
                  className="flex flex-col gap-5"
                >
                  <h3
                    id="format-detail-heading"
                    className="text-base font-bold text-text-primary-default"
                  >
                    {formatLabel}
                  </h3>

                  <FormatPanel
                    format={format}
                    state={state}
                    body={sectionBody}
                    mediaUrl={mediaUrl}
                    coverUrl={formatCoverUrl}
                    driveUrl={formatMeta.driveUrl}
                    scheduledDate={scheduledRow?.date}
                    scheduledTime={scheduledRow?.time ?? null}
                    publishedAt={publishedAt ?? undefined}
                    onSaveDriveUrl={(url) => {
                      if (!postId) return
                      setFormatMeta(postId, format, {
                        driveUrl: url || undefined,
                      })
                    }}
                    onCreateScript={() =>
                      handleCreateScriptForFormat(format)
                    }
                    onTogglePublished={() =>
                      handleToggleFormatPublished(format)
                    }
                    onEditScript={handleOpenFull}
                    onGoToCalendar={handleGoToCalendar}
                  />
                </section>
              )
            })()}
            </div>
          </div>

          {/* Screen 2 footer — schedule CTA. Only visible in format detail
              AND only to the owner (the /calendar surface is owner-gated).
              Disabled unless the format is `ready` (script + media-or-drive). */}
          {post && selectedFormat !== null && ownerView && (
            <footer className="sticky bottom-0 bg-white dark:bg-gray-10 border-t border-border-neutral-default px-6 py-4 flex items-center justify-between gap-3">
              <span className="text-xs-body text-text-neutral-default">
                אפשר לתזמן פורמט רק במידה ויש לו מדיה או קישור לדרייב וסקריפט
              </span>
              <Button
                onClick={handleGoToCalendar}
                disabled={readinessByFormat[selectedFormat] !== "ready"}
                className="gap-1.5"
              >
                <CalendarPlus className="size-4" />
                תזמון בלוח
              </Button>
            </footer>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmModal
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!deleting) setConfirmDelete(o)
        }}
        title="בטוח למחוק את הפוסט?"
        description={
          firstScheduledLabel
            ? `הפוסט מתוזמן ל-${firstScheduledLabel} — הוא יוסר גם מלוח השנה.`
            : "הפעולה לא ניתנת לביטול."
        }
        confirmLabel="כן, למחוק"
        cancelLabel="לא, אל תמחקו"
        confirmVariant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Tabs list                                                           */
/* ------------------------------------------------------------------ */

/**
 * The four-tab navigation row. We use the `line` variant of TabsList so the
 * triggers don't sit inside a contrasting "pill" container — that would
 * compete visually with the per-format colored chip we render INSIDE each
 * trigger. The active state is communicated by the underline + the chip's
 * own state colors (the FormatStatusChip already changes background per
 * `(format, state)`), so we don't need an additional active-bg treatment.
 */
function FormatTabsList({
  activeTab,
  readinessByFormat,
  scheduledRows,
  publishedMap,
}: {
  activeTab: FormatId
  readinessByFormat: Record<FormatId, FormatReadiness>
  scheduledRows: Array<{ format: FormatId; date: string; time?: string | null }>
  publishedMap: PublishedMap
}) {
  return (
    <TabsList
      variant="line"
      dir="rtl"
      className="w-full justify-start h-auto flex-wrap gap-2 p-0"
      aria-label="פורמטים בפוסט"
    >
      {HEADER_CHIP_FORMATS.map((format) => {
        const state = readinessByFormat[format]
        const label = getFormatChipLabel(format)

        // Date for the inline chip (only relevant for scheduled / published).
        const dateValue =
          state === "scheduled"
            ? scheduledRows.find((r) => r.format === format)?.date
            : state === "published"
              ? publishedMap[format]?.publishedAt
              : undefined

        // Aria label rendered on the trigger itself — Hani's ask: chip only,
        // no duplicate text label. The chip's icon + color + state-text
        // already convey the format identity visually; screen readers get
        // the full state via this label since the chip is aria-hidden.
        const triggerAria =
          state === "scheduled" && dateValue
            ? `${label}, מתוזמן`
            : state === "published" && dateValue
              ? `${label}, פורסם`
              : state === "ready"
                ? `${label}, מוכן`
                : `${label}, ריק`

        return (
          <TabsTrigger
            key={format}
            value={format}
            aria-label={triggerAria}
            // Override the default trigger styling — the chip itself is the
            // surface; the active state is the underline (line variant).
            className="!flex-none px-1.5 py-2 data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent"
          >
            <span aria-hidden="true" className="contents">
              <FormatStatusChip
                format={format}
                state={state}
                date={dateValue ?? undefined}
                size="sm"
                className="pointer-events-none"
              />
            </span>
          </TabsTrigger>
        )
      })}
    </TabsList>
  )
}

/* ------------------------------------------------------------------ */
/*  Per-format panel                                                    */
/* ------------------------------------------------------------------ */

/**
 * Threshold above which the script body collapses to a preview + "see more".
 * Tuned to ~3 lines at the Sheet's body width.
 */
const SCRIPT_PREVIEW_THRESHOLD = 200

/**
 * One TabsContent body — the full view of a single (post, format) pair.
 *
 * Sub-blocks, top to bottom:
 *   1. Script        — preview + "ערכו" drill-in (or empty CTA)
 *   2. Media         — thumbnail / drive button / "open in /project" CTA
 *   3. Drive link    — per-format input + open button
 *   4. Trigger word  — per-format input
 *   5. Schedule line — date + "סמנו כפורסם" (or "לא מתוזמן עדיין" hint)
 */
function FormatPanel({
  format,
  state,
  body,
  mediaUrl,
  coverUrl,
  driveUrl,
  scheduledDate,
  scheduledTime,
  publishedAt,
  onSaveDriveUrl,
  onCreateScript,
  onTogglePublished,
  onEditScript,
  onGoToCalendar,
}: {
  format: FormatId
  state: FormatReadiness
  body: string | null
  mediaUrl: string | null
  coverUrl: string | null
  driveUrl: string | undefined
  scheduledDate?: string
  scheduledTime?: string | null
  publishedAt?: string
  onSaveDriveUrl: (url: string) => void
  onCreateScript: () => void
  onTogglePublished: () => void
  onEditScript: () => void
  onGoToCalendar: () => void
}) {
  const label = getFormatChipLabel(format)
  const isEmpty = state === "empty"

  return (
    <div className="flex flex-col gap-5">
      <ScriptBlock
        format={format}
        state={state}
        body={body}
        onCreateScript={onCreateScript}
        onEditScript={onEditScript}
      />

      <MediaBlock
        format={format}
        state={state}
        mediaUrl={mediaUrl}
        coverUrl={coverUrl}
        driveUrl={driveUrl}
        onEditScript={onEditScript}
      />

      {/* "או" divider — separates the two ways to attach media:
          uploaded video/cover (above) OR a Drive link (below). */}
      <div
        role="separator"
        aria-label="או"
        className="flex items-center gap-3 text-xs-body text-text-neutral-default"
      >
        <span className="flex-1 h-px bg-border-neutral-default" aria-hidden />
        <span>או</span>
        <span className="flex-1 h-px bg-border-neutral-default" aria-hidden />
      </div>

      <DriveLinkBlock
        format={format}
        disabled={false}
        value={driveUrl ?? ""}
        onSave={onSaveDriveUrl}
      />

      {(state === "scheduled" || state === "published") && (
        <section className="flex flex-col gap-1.5">
          <span className="text-xs-body text-text-neutral-default">תזמון</span>
          <ScheduleStatusBlock
            format={format}
            formatLabel={label}
            state={state}
            scheduledDate={scheduledDate}
            scheduledTime={scheduledTime}
            publishedAt={publishedAt}
            onTogglePublished={onTogglePublished}
            onGoToCalendar={onGoToCalendar}
          />
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Panel sub-blocks                                                    */
/* ------------------------------------------------------------------ */

function ScriptBlock({
  format,
  state,
  body,
  onCreateScript,
  onEditScript,
}: {
  format: FormatId
  state: FormatReadiness
  body: string | null
  onCreateScript: () => void
  onEditScript: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const label = getFormatChipLabel(format)
  const trimmedBody = body?.trim() ?? ""
  const hasBody = trimmedBody.length > 0
  const isLong = trimmedBody.length > SCRIPT_PREVIEW_THRESHOLD
  const visibleBody =
    isLong && !expanded
      ? `${trimmedBody.slice(0, SCRIPT_PREVIEW_THRESHOLD).trimEnd()}…`
      : trimmedBody

  if (state === "empty") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs-body text-text-neutral-default">סקריפט</span>
        <div className="rounded-xl bg-bg-surface px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-small text-text-neutral-default">
            טרם נוצר סקריפט ל{label}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onCreateScript}
            className="shrink-0"
          >
            צרו {label}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs-body text-text-neutral-default">סקריפט</span>
        {hasBody && (
          <button
            type="button"
            onClick={onEditScript}
            className="inline-flex items-center gap-1 text-xs-body text-text-primary-default hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-md px-1.5 py-0.5 transition-colors"
            aria-label={`ערכו את הסקריפט ל${label}`}
          >
            <Pencil className="size-3" aria-hidden />
            עריכה
          </button>
        )}
      </div>
      {hasBody ? (
        <div className="relative rounded-xl bg-bg-surface px-4 py-3 text-text-primary-default text-small leading-relaxed whitespace-pre-wrap text-right">
          <CopyIconButton
            text={trimmedBody}
            ariaLabel={`העתיקו את הסקריפט ל${label}`}
          />
          <div className="pl-9">
            {visibleBody}
            {isLong && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="block mt-2 text-xs-body text-text-neutral-default hover:text-text-primary-default underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-md"
              >
                {expanded ? "הציגו פחות" : "ראו עוד"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs-body text-text-neutral-default">
          עדיין אין סקריפט ל{label}
        </p>
      )}
    </div>
  )
}

function MediaBlock({
  format,
  state,
  mediaUrl,
  coverUrl,
  driveUrl,
  onEditScript,
}: {
  format: FormatId
  state: FormatReadiness
  mediaUrl: string | null
  coverUrl: string | null
  driveUrl: string | undefined
  onEditScript: () => void
}) {
  const label = getFormatChipLabel(format)
  // `mediaUrl` is the uploaded video/image asset; `coverUrl` is the
  // separate cover image (today only `talking_head` produces one — the
  // parent FormatPanel passes null for other formats so the cover slot
  // renders the empty CTA).
  const videoUrl = mediaUrl
  void state
  void driveUrl

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs-body text-text-neutral-default">מדיה</span>
        <button
          type="button"
          onClick={onEditScript}
          className="inline-flex items-center gap-1 text-xs-body text-text-primary-default hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-md px-1.5 py-0.5 transition-colors"
          aria-label={`ערכו את המדיה ל${label}`}
        >
          <Pencil className="size-3" aria-hidden />
          עריכה
        </button>
      </div>
      {/* Half-half grid: video (right in RTL) + cover (left in RTL).
          Each slot shows a preview when populated, or an empty state with
          its own action button when not. Per Hani: cover is not critical
          for scheduling. */}
      <div className="grid grid-cols-2 gap-2">
        <MediaSlot
          kind="video"
          url={videoUrl}
          label={label}
          onAction={onEditScript}
        />
        <MediaSlot
          kind="cover"
          url={coverUrl}
          label={label}
          onAction={onEditScript}
        />
      </div>
    </div>
  )
}

/**
 * Single media slot — video or cover. Square aspect, rounded card with
 * either a preview or an empty state. Empty state has a dashed border, a
 * neutral icon, and a small outline button driving the action (upload
 * media for video, edit cover for cover).
 */
function MediaSlot({
  kind,
  url,
  label,
  onAction,
}: {
  kind: "video" | "cover"
  url: string | null
  label: string
  onAction: () => void
}) {
  const buttonLabel = kind === "video" ? "העלאת מדיה" : "עריכת קאבר"
  const emptyAria =
    kind === "video"
      ? `העלאת מדיה ל${label}`
      : `עריכת קאבר ל${label}`

  if (url) {
    return (
      <div className="aspect-square rounded-xl overflow-hidden bg-bg-surface border border-border-neutral-default">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={kind === "video" ? `מדיה של ${label}` : `קאבר של ${label}`}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className="aspect-square rounded-xl bg-bg-surface border border-dashed border-border-neutral-default flex flex-col items-center justify-center gap-2 px-3 text-center">
      <ImageIcon
        className="size-5 text-text-neutral-default"
        aria-hidden
      />
      <Button
        variant="outline"
        size="sm"
        onClick={onAction}
        aria-label={emptyAria}
        className="gap-1.5"
      >
        <Pencil className="size-3.5" aria-hidden />
        {buttonLabel}
      </Button>
    </div>
  )
}

/**
 * Per-format drive URL input. Auto-saves on blur (so the user can paste +
 * tab away without hunting for a save button) AND on Enter. The "open"
 * affordance is the trailing icon button — disabled when the input is empty.
 *
 * `disabled` cuts in for the empty state: there's no point asking the user
 * to point a drive folder at a format that doesn't exist yet.
 */
function DriveLinkBlock({
  format,
  disabled,
  value,
  onSave,
}: {
  format: FormatId
  disabled: boolean
  value: string
  onSave: (url: string) => void
}) {
  const label = getFormatChipLabel(format)
  const inputId = `drive-url-${format}`
  // Local mirror so the user's keystrokes show immediately; we commit to
  // storage on blur / Enter.
  const [local, setLocal] = useState(value)
  // Re-sync when the upstream value changes (e.g. another tab edited it).
  useEffect(() => {
    setLocal(value)
  }, [value])

  const commit = () => {
    if (local.trim() === (value ?? "").trim()) return
    onSave(local.trim())
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={inputId}
        className="text-xs-body text-text-neutral-default font-normal"
      >
        קישור לדרייב
      </Label>
      <div className="relative">
        <Input
          id={inputId}
          dir="rtl"
          inputSize="small"
          type="url"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur()
            }
          }}
          placeholder="https://drive.google.com/..."
          className="pe-18 text-right"
          disabled={disabled}
          aria-label={`קישור לדרייב ל${label}`}
        />
        <InlineCopyButton
          value={local.trim()}
          ariaLabel={`העתיקו את הקישור של ${label}`}
          disabled={disabled}
          className="absolute end-10 top-1/2 -translate-y-1/2"
        />
        <button
          type="button"
          onClick={() => {
            const url = local.trim()
            if (url) window.open(url, "_blank", "noopener,noreferrer")
          }}
          disabled={disabled || !local.trim()}
          aria-label={`פתחו את הקישור של ${label} בכרטיסייה חדשה`}
          className="absolute end-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Link2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/**
 * Per-format schedule status. Three branches:
 *   - empty     → not rendered at all (parent decides; we early-return)
 *   - ready     → micro-text "לא מתוזמן עדיין" + a soft CTA to /calendar
 *   - scheduled → date + time + "סמנו כפורסם" checkbox
 *   - published → date + time + checked checkbox
 */
function ScheduleStatusBlock({
  format,
  formatLabel,
  state,
  scheduledDate,
  scheduledTime,
  publishedAt,
  onTogglePublished,
  onGoToCalendar,
}: {
  format: FormatId
  formatLabel: string
  state: FormatReadiness
  scheduledDate?: string
  scheduledTime?: string | null
  publishedAt?: string
  onTogglePublished: () => void
  onGoToCalendar: () => void
}) {
  if (state === "empty") return null

  if (state === "ready") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-bg-surface px-4 py-3">
        <span className="text-small text-text-neutral-default">
          לא מתוזמן עדיין
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onGoToCalendar}
          className="gap-1.5"
        >
          <CalendarPlus className="size-3.5" aria-hidden />
          תזמון בלוח
        </Button>
      </div>
    )
  }

  // scheduled / published
  const dateLabel = (() => {
    const source = state === "published" ? publishedAt : scheduledDate
    if (!source) return null
    try {
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source)
      let date: Date
      if (ymd) {
        date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
      } else {
        date = new Date(source)
      }
      if (Number.isNaN(date.getTime())) return null
      const dateStr = date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "long",
      })
      return state === "scheduled" && scheduledTime
        ? `${dateStr} בשעה ${scheduledTime}`
        : dateStr
    } catch {
      return null
    }
  })()

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-bg-surface px-4 py-3">
      {dateLabel && (
        <p className="text-small text-text-primary-default tabular-nums">
          {state === "published" ? "פורסם ב-" : "מתוזמן ל-"}
          {dateLabel}
        </p>
      )}
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={`published-${format}`}
          checked={state === "published"}
          onCheckedChange={onTogglePublished}
          className="mt-0.5"
          aria-label={`סמנו את ${formatLabel} כפורסם`}
        />
        <Label
          htmlFor={`published-${format}`}
          className="text-small text-text-primary-default cursor-pointer"
        >
          {state === "published"
            ? `${formatLabel} סומן כפורסם`
            : `סמנו את ${formatLabel} כפורסם`}
        </Label>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Media preview                                                       */
/* ------------------------------------------------------------------ */

function MediaPreview({ url, label }: { url: string; label: string }) {
  const isVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(url)
  return (
    <div className="rounded-xl overflow-hidden border border-border-neutral-default bg-bg-surface aspect-video">
      {isVideo ? (
        <video
          src={url}
          className="w-full h-full object-cover"
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`מדיה ל${label}`}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Misc exports                                                        */
/* ------------------------------------------------------------------ */

/**
 * Tiny convenience export for callers that already have raw API data and
 * want to render a "currently published" pill somewhere outside the Sheet.
 */
export function PublishedBadge({ at }: { at: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-surface px-2 py-0.5 text-xs-body text-yellow-30">
      <CheckCircle2 className="size-3" aria-hidden />
      פורסם {new Date(at).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}
    </span>
  )
}
