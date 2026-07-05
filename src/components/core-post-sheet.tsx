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
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Sparkles,
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
  /**
   * Hide the header "תזמון פוסט" / "מתוזמן ל-…" CTA entirely. Used when
   * the Sheet is opened from a surface where scheduling is already the
   * ambient context (e.g. the /calendar QueuePanel — the user is on the
   * scheduling board, surfacing the schedule CTA again would loop).
   */
  hideScheduleButton?: boolean
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
  className = "",
}: {
  value: string
  onSave: (word: string) => void
  /** Layout classes for the field wrapper (e.g. `flex-1` when sharing a row). */
  className?: string
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
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
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
        className="text-right w-full"
        aria-label="מילת טריגר לפוסט"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AI Iteration Panel — בועת שיחה צפה                                */
/* ------------------------------------------------------------------ */

/** Quick-action chips that appear at the top of the AI iteration panel. */
const AI_CHIPS = [
  { id: "lighter", label: "יותר קליל" },
  { id: "shorter", label: "קצר יותר" },
  { id: "specific", label: "יותר ספציפי" },
  { id: "tone", label: "שנה טון" },
] as const

type AiPanelState = "default" | "generating" | "error"

/**
 * The floating AI iteration panel that pops up from the bottom-left of the
 * Sheet body. It exposes quick-action chips + a free-text field. On submit,
 * it enters `generating` state and calls back with the prompt so the parent
 * can drive the actual AI request.
 *
 * The parent is responsible for the API call; this component owns only the
 * input UX + state machine (default → generating → default/error).
 */
function AiIterationPanel({
  onSubmit,
  onClose,
}: {
  /**
   * Called when the user submits a prompt (chip or free text). The returned
   * Promise resolves with the new body string on success, or rejects on
   * failure. The panel handles the generating / error state machine.
   */
  onSubmit: (prompt: string) => Promise<string>
  onClose: () => void
}) {
  const [panelState, setPanelState] = useState<AiPanelState>("default")
  const [inputValue, setInputValue] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when the panel mounts.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const isLocked = panelState === "generating"

  const submit = async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed || isLocked) return
    setPanelState("generating")
    setErrorMsg(null)
    try {
      await onSubmit(trimmed)
      setInputValue("")
      setPanelState("default")
    } catch {
      setErrorMsg("משהו השתבש, נסי שוב")
      setPanelState("error")
    }
  }

  const handleChip = (label: string) => {
    void submit(label)
  }

  const handleSend = () => {
    void submit(inputValue)
  }

  const handleRetry = () => {
    setPanelState("default")
    setErrorMsg(null)
  }

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="דיוק עם AI"
      className={[
        "absolute bottom-0 left-0 right-0 z-20",
        "bg-white dark:bg-gray-10",
        "border border-border-neutral-default rounded-t-2xl",
        "shadow-[0_-4px_24px_rgba(0,0,0,0.10)]",
        "flex flex-col gap-3 p-4",
        "transition-transform duration-300 ease-out",
      ].join(" ")}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-yellow-50" aria-hidden />
          <span className="text-small font-semibold text-text-primary-default">
            דייקו עם AI
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירת פאנל AI"
          className="inline-flex items-center justify-center size-6 rounded-md text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Quick-action chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="פעולות מהירות">
        {AI_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            disabled={isLocked}
            onClick={() => handleChip(chip.label)}
            className={[
              "inline-flex items-center px-3 py-1 rounded-full border text-xs-body transition-colors",
              "border-border-neutral-default bg-bg-surface text-text-primary-default",
              "hover:border-yellow-50 hover:text-yellow-30 hover:bg-yellow-50/5",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
            ].join(" ")}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Generating indicator */}
      {panelState === "generating" && (
        <div className="flex items-center gap-2 text-small text-text-neutral-default">
          <Loader2 className="size-3.5 animate-spin text-yellow-50 shrink-0" aria-hidden />
          <span>מדייקת את הפוסט שלך</span>
          {/* Animated dots */}
          <span className="inline-flex gap-0.5" aria-hidden>
            <span className="w-1 h-1 rounded-full bg-text-neutral-default animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-text-neutral-default animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-text-neutral-default animate-bounce [animation-delay:300ms]" />
          </span>
        </div>
      )}

      {/* Free-text input row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Input
            ref={inputRef}
            dir="rtl"
            inputSize="small"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="בקשי שינוי… למשל: קצר יותר, יותר אישי"
            disabled={isLocked}
            className="text-right w-full"
            aria-label="הזיני בקשת שינוי לפוסט"
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={isLocked || !inputValue.trim()}
          aria-label="שליחת בקשה"
          className={[
            "inline-flex items-center justify-center size-8 rounded-lg shrink-0",
            "bg-yellow-50 text-gray-10",
            "hover:bg-yellow-30 transition-colors",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
          ].join(" ")}
        >
          <Send className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Error state */}
      {panelState === "error" && errorMsg && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50/10 border border-red-200 dark:border-red-800 px-3 py-2">
          <span className="text-xs-body text-red-600 dark:text-red-400">
            {errorMsg}
          </span>
          <button
            type="button"
            onClick={handleRetry}
            className="text-xs-body text-text-primary-default underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-sm shrink-0"
          >
            נסי שוב
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The floating trigger button that opens/closes the AI iteration panel.
 * When closed: a round primary button with a chat-bubble + sparkle icon.
 * When open: the same button shows an X (close affordance is also in the
 * panel itself, but the icon toggles for clarity).
 */
function AiFloatingTrigger({
  isOpen,
  onClick,
}: {
  isOpen: boolean
  onClick: () => void
}) {
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={isOpen ? "סגירת פאנל דיוק AI" : "פתחי פאנל דיוק AI"}
            aria-expanded={isOpen}
            className={[
              "inline-flex items-center justify-center size-10 rounded-full shadow-md",
              "transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 focus-visible:ring-offset-2",
              isOpen
                ? "bg-gray-10 text-white dark:bg-white dark:text-gray-10 border border-border-neutral-default"
                : "bg-yellow-50 text-white hover:bg-yellow-30",
            ].join(" ")}
          >
            {isOpen ? (
              <X className="size-4" aria-hidden />
            ) : (
              <span className="relative inline-flex items-center justify-center" aria-hidden>
                <MessageCircle className="size-4" />
                <Sparkles className="size-2.5 absolute -top-1 -right-1 text-yellow-30" />
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isOpen ? "סגירה" : "דייקי עם AI"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Skeleton shimmer overlay for the script block while AI is generating.
 * Displayed as an absolute overlay over the script text so the user sees
 * the "working" state without losing track of the block's position.
 */
function ScriptSkeletonShimmer() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 rounded-xl overflow-hidden z-10 pointer-events-none"
    >
      <div className="h-full w-full bg-gradient-to-l from-bg-surface via-white/80 dark:via-gray-10/80 to-bg-surface animate-pulse" />
      <div className="absolute inset-0 flex flex-col gap-2.5 px-4 py-3">
        {[100, 85, 90, 70, 55].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded bg-border-neutral-default/60 animate-pulse"
            style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
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
  hideScheduleButton = false,
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

  // --- AI iteration panel state -------------------------------------------
  // `aiPanelOpen` drives the floating panel visibility. The panel lives
  // inside the scrolling body layer; absolute positioning pins it to the
  // bottom of the overflow container.
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  // Per-body override map — when the AI rewrites a body, we store the
  // result here keyed by "master" or by format id. The script blocks read
  // from here before falling back to the post prop.
  const [aiBodyOverrides, setAiBodyOverrides] = useState<
    Record<string, string>
  >({})
  // Whether the master body is currently being shimmer-loading (AI in flight).
  const [aiGeneratingKey, setAiGeneratingKey] = useState<string | null>(null)

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

  /**
   * Short date label for the header "תזמון פוסט" button when ANY format is
   * already scheduled — flips the CTA from "schedule this" to "מתוזמן ל-DD
   * בחודש" so the user reads the current state at a glance. We pick the
   * EARLIEST scheduled row so the user sees the next thing on the calendar
   * (not whatever happens to be index 0).
   */
  const nextScheduledShort = useMemo(() => {
    if (scheduledRows.length === 0) return null
    const sorted = [...scheduledRows].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    )
    const earliest = sorted[0]
    try {
      const [y, m, d] = earliest.date.split("-").map((s) => parseInt(s, 10))
      const date = new Date(y, m - 1, d)
      // Short Hebrew form ("12 במאי") — enough to identify the slot in
      // a small button label without dragging year or time in.
      return date.toLocaleDateString("he-IL", {
        day: "numeric",
        month: "long",
      })
    } catch {
      return earliest.date
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

  // --- AI iteration handler -----------------------------------------------
  /**
   * Determine the "active body key" — which text block the AI should
   * operate on. In the master view (selectedFormat === null), it's the
   * post-level body ("master"). In format detail, it's the format id.
   */
  const activeBodyKey = selectedFormat ?? "master"

  /**
   * The body text currently visible in the active view, respecting AI
   * overrides. Used both to display text and to feed the AI as context.
   */
  const resolveBody = (key: string): string => {
    if (aiBodyOverrides[key] !== undefined) return aiBodyOverrides[key]
    if (key === "master") return post?.body ?? ""
    return post?.formatBodies?.[key as FormatId] ?? post?.body ?? ""
  }

  const handleAiSubmit = async (prompt: string): Promise<string> => {
    const currentBody = resolveBody(activeBodyKey)
    setAiGeneratingKey(activeBodyKey)
    try {
      // TODO: replace with real API call to AI iteration endpoint
      // e.g. POST /api/ai/iterate-post { postId, format: activeBodyKey, prompt, currentBody }
      const res = await fetch("/api/ai/iterate-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          format: activeBodyKey,
          prompt,
          currentBody,
        }),
      })
      if (!res.ok) throw new Error(`iterate-post ${res.status}`)
      const json = (await res.json()) as { body?: string; result?: string }
      const newBody = json.body ?? json.result ?? currentBody
      setAiBodyOverrides((prev) => ({ ...prev, [activeBodyKey]: newBody }))
      setAiGeneratingKey(null)
      return newBody
    } catch (err) {
      setAiGeneratingKey(null)
      throw err
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
              {/* Close — sits on the visual LEFT (RTL). Master only; the
                  detail view exits via its back button. The schedule + edit
                  actions live in the fixed footer at the bottom of the panel
                  (floats above the script). */}
              {selectedFormat === null && (
                <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SheetClose asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="סגירה"
                          className="rounded-lg shrink-0"
                        >
                          <X className="size-4" />
                        </Button>
                      </SheetClose>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">סגירה</TooltipContent>
                  </Tooltip>
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
                "absolute inset-0 overflow-y-auto px-6 pt-2 pb-5 flex flex-col gap-5 text-right",
                "transition-transform duration-300 ease-out will-change-transform",
                selectedFormat === null ? "translate-x-0" : "translate-x-full",
              ].join(" ")}
            >
            {post && (
              <>
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
                      // Per Hani: only formats that have media are
                      // navigable from this row — the chip becomes
                      // a non-interactive `FormatStatusChip` for the
                      // others. The detail view requires a media
                      // asset to be useful (it's the editor for the
                      // format's script + media), so navigating to a
                      // medialess format would land the user on a
                      // surface with nothing to do but upload.
                      const hasMedia =
                        post?.formatsWithMedia?.includes(format) ?? false

                      return (
                        <div role="listitem" key={format}>
                          {hasMedia ? (
                            <FormatStatusChipLink
                              format={format}
                              state={state}
                              date={dateValue ?? undefined}
                              size="md"
                              onClick={() => navigateToFormat(format)}
                            />
                          ) : (
                            <FormatStatusChip
                              format={format}
                              state={state}
                              date={dateValue ?? undefined}
                              size="md"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>

                {/* divider */}
                <div className="border-t border-border-neutral-default" />

                {/* --- Post settings (הגדרות הפוסט) ---
                    Product + trigger word. Moved out of the script heading
                    into their own labelled section between the formats and the
                    script, per the scheduler wireframe (node 541:1852). */}
                <section aria-labelledby="settings-heading">
                  <h3
                    id="settings-heading"
                    className="text-base font-bold text-text-primary-default mb-3"
                  >
                    הגדרות הפוסט
                  </h3>
                  <div className="flex gap-2">
                    {/* Product — shares the row with the trigger field; both
                        flex-1 so they split the container width with an 8px gap. */}
                    <div className="flex flex-1 min-w-0 flex-col gap-1.5">
                      <Label htmlFor="product-id">מוצר</Label>
                      <Select
                        id="product-id"
                        selectSize="small"
                        value={meta.productId ?? ""}
                        onChange={(e) =>
                          patchMeta({ productId: e.target.value || null })
                        }
                        disabled={productsLoading}
                        className="w-full"
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
                    {/* Trigger word — sits next to the product field (8px gap),
                        filling the remaining width. */}
                    <PostTriggerWordField
                      className="flex-1 min-w-0"
                      value={meta.triggerWord ?? ""}
                      onSave={(word) =>
                        patchMeta({ triggerWord: word || undefined })
                      }
                    />
                  </div>
                </section>

                {/* divider */}
                <div className="border-t border-border-neutral-default" />

                {/* --- Master script ---
                    The core post script — the shared idea before format
                    adaptation. Sits last in the panel (Hani 2026-06-25). */}
                {post.body?.trim() && (
                  <section aria-labelledby="master-script-heading">
                    <h3
                      id="master-script-heading"
                      className="text-base font-bold text-text-primary-default mb-3"
                    >
                      הסקריפט
                    </h3>
                    <div className="relative bg-bg-surface border border-border-neutral-default rounded-md px-4 py-3 text-right">
                      {/* Skeleton shimmer when AI is generating for master */}
                      {aiGeneratingKey === "master" && <ScriptSkeletonShimmer />}
                      <CopyIconButton
                        text={aiBodyOverrides["master"] ?? post.body}
                        ariaLabel="העתיקו את הסקריפט המרכזי"
                      />
                      <p className="text-small text-text-primary-default whitespace-pre-wrap leading-relaxed pl-9">
                        {aiBodyOverrides["master"] ?? post.body}
                      </p>
                    </div>
                  </section>
                )}

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
                aiBodyOverrides[format] ??
                (perFormatBody !== undefined ? perFormatBody : post.body)
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
                    isAiGenerating={aiGeneratingKey === format}
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

            {/* AI floating trigger — bottom-left of the body container.
                Only shown when a post is loaded and we're not in a
                loading state. Positioned absolute over the scrolling
                body so it doesn't push content. */}
            {post && (
              <div className="absolute bottom-4 left-4 z-30 flex flex-col items-end gap-0">
                {/* AI iteration panel — expands upward from the trigger */}
                {aiPanelOpen && (
                  <div className="mb-2 w-[min(320px,calc(100vw-2rem))]">