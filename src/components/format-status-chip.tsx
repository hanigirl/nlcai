"use client"

// PHASE-3 INTERIM: Using Tailwind color classes per Hani's instruction
// while waiting for custom format-color palette. To migrate later:
// replace FORMAT_COLOR_CLASSES with semantic tokens from globals.css.

/**
 * FormatStatusChip — single source of truth for "this (post, format) is in
 * state X" across the timing feature.
 *
 * Why one component for three surfaces?
 *   Before this, three places drew the same idea three different ways:
 *
 *     1. /core_posts cards used `FormatCompletionChip` with a 3-state model
 *        (missing | duplicated | ready).
 *     2. core-post-sheet header used `FormatChip` — a passive name+icon pill
 *        with no state at all.
 *     3. queue-panel rows used a tiny inline pill (label only).
 *
 *   The lessons.md "ישות אחת = surface אחד" rule applies fractally: a
 *   "format readiness" is one concept and should look like one chip, no
 *   matter where it's drawn. When the user sees the same shape in three
 *   places, they learn the visual language once and reuse it. When each
 *   surface invents its own visual, the user has to re-learn each time.
 *
 * Per-format readiness model (2026-05-06):
 *   FormatReadiness = "empty" | "ready" | "scheduled" | "published"
 *   Defined in `timing-storage.ts`. The mapping is enforced here and only
 *   here — callers pass `state` (already-derived) so this stays a pure
 *   presentational component.
 *
 * Wrappers, not props:
 *   The base component is presentational only — no onClick, no href. There
 *   are TWO thin wrappers for the two contexts that need interaction:
 *     - `FormatStatusChipScrollTo` — anchor that scrolls to a target id +
 *       moves focus there. Used in the Sheet header chips row.
 *     - `FormatStatusChipLink` — button that fires a callback. Used in
 *       /core_posts cards (click → open Sheet).
 *   This separation keeps the visual contract identical across surfaces
 *   while letting each context choose the right semantic element.
 */

import {
  Check,
  FileText,
  Image as ImageIcon,
  Images,
  Layers,
  Type as TypeIcon,
  Video,
  type LucideIcon,
} from "lucide-react"
import type { ComponentPropsWithoutRef, MouseEvent } from "react"
import type { FormatId, FormatReadiness } from "@/lib/timing-storage"

/* ------------------------------------------------------------------ */
/*  Format → label / icon                                              */
/* ------------------------------------------------------------------ */

/**
 * Hebrew labels for format ids. Kept in this file so callers don't pass them
 * — the component owns the visual language top-to-bottom (icon, label,
 * status-overlay icon, copy).
 */
const FORMAT_LABELS: Record<string, string> = {
  story: "סטורי",
  talking_head: "דיבור למצלמה",
  carousel: "קרוסלה",
  image_post: "תמונה",
  static: "תמונה",
}

/**
 * Format → outline icon. Used as the primary signifier on the chip.
 * `static` is treated as a synonym for `image_post` because the brief
 * mentions both — the deeper component contract still keys on FormatId.
 */
const FORMAT_ICONS: Record<string, LucideIcon> = {
  story: Layers,
  talking_head: Video,
  carousel: Images,
  image_post: ImageIcon,
  static: ImageIcon,
}

function getFormatIcon(format: string): LucideIcon {
  return FORMAT_ICONS[format] ?? TypeIcon
}

function getFormatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format
}

/* ------------------------------------------------------------------ */
/*  Date helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Format an ISO timestamp or a YYYY-MM-DD date as Hebrew short DD/MM.
 * Returns null if parsing fails — callers can render the chip without a date
 * suffix instead of showing garbage.
 *
 * We accept both shapes because:
 *   - `getScheduledByPostAndFormat().scheduledDate` is YYYY-MM-DD (a calendar
 *     day, no timezone).
 *   - `getPublishedMark().publishedAt` is an ISO timestamp.
 */
function formatShortHebrewDate(value: string | undefined): string | null {
  if (!value) return null
  try {
    let date: Date
    // YYYY-MM-DD shape — parse as local date so a "May 6th" input doesn't
    // get pulled into the previous calendar day in negative-UTC timezones.
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (ymd) {
      const [, y, m, d] = ymd
      date = new Date(Number(y), Number(m) - 1, Number(d))
    } else {
      date = new Date(value)
    }
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  State → visual treatment                                            */
/* ------------------------------------------------------------------ */

type Size = "xs" | "sm" | "md"

/**
 * Class strings for each (state, size) combination. Inlined as constants
 * rather than computed at render time so:
 *   1. Tailwind's static extractor finds every class string at build time
 *      (template literals with state interpolation can be lossy).
 *   2. State changes don't trigger any class recomputation — the chip just
 *      swaps the precomputed string.
 *
 * Sizes are tuned to:
 *   - xs = tightest variant. Used in dense lists where multiple chips
 *     stack per row (e.g. queue-panel cards showing all ready formats).
 *   - sm = pills inside cards (/core_posts grid).
 *   - md = sticky chips row in the Sheet header where they need to read as
 *     navigation, not decoration.
 */
const baseChipClass =
  "inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap transition-colors tabular-nums"

const sizeClass: Record<Size, string> = {
  xs: "h-5 px-2 text-[10px] leading-none gap-1",
  sm: "h-7 px-2.5 text-xs-body",
  md: "h-8 px-3 text-small",
}

/* ------------------------------------------------------------------ */
/*  Per-format color identity (PHASE-3 INTERIM)                         */
/* ------------------------------------------------------------------ */

/**
 * Format → color family. Each format gets a distinct hue so the user can
 * tell formats apart at a glance, regardless of state. Hani approved the
 * Tailwind palette as INTERIM until a custom format-color palette lands;
 * see the file header comment for migration notes.
 *
 *   talking_head → blue   (ריל)
 *   carousel     → purple (קרוסלה)
 *   image_post   → orange (תמונה)
 *   static       → orange (alias for image_post)
 *   story        → teal   (סטורי — turquoise, distinct from talking_head blue)
 *
 * Unknown formats fall back to gray (kept neutral so a stray format id
 * doesn't poison the visual language).
 */
type FormatColorFamily = "blue" | "purple" | "orange" | "teal" | "gray"

const FORMAT_COLOR_FAMILY: Record<string, FormatColorFamily> = {
  talking_head: "blue",
  carousel: "purple",
  image_post: "orange",
  static: "orange",
  story: "teal",
}

function getFormatColorFamily(
  format: string,
  state?: FormatReadiness,
): FormatColorFamily {
  // Empty (never duplicated) is the only state that flattens to gray —
  // it's the "not yet" signal across formats. Incomplete (duplicated +
  // script, no media) keeps the per-format hue so the user can tell
  // which format was started, just with a softer treatment via the
  // dashed border + lighter shade in FORMAT_COLOR_CLASSES.
  if (state === "empty") return "gray"
  return FORMAT_COLOR_FAMILY[format] ?? "gray"
}

/**
 * Static (state × family) class lookup. Tailwind's JIT cannot resolve
 * `bg-${color}-100` at build time — we MUST list every literal string here
 * for the extractor to keep them in the bundle. Adding a new format =
 * adding a new family row; adding a new state = adding a new column.
 *
 * Mapping by state (per Hani's brief):
 *   empty     → {c}-50  bg, dashed {c}-200 border, {c}-600 text
 *   ready     → {c}-100 bg,        {c}-300 border, {c}-800 text
 *   scheduled → IDENTICAL to published (Hani: only the badge glyph differs)
 *   published → {c}-50  bg,        {c}-400 border, {c}-700 text
 *
 * Border-dashed is set on `empty` only; all other states use a solid
 * border. We keep the border *width* identical across states (1px) so
 * chips don't shift size when their state changes (avoiding layout jitter
 * inside flex/grid rows).
 */
const FORMAT_COLOR_CLASSES: Record<
  FormatColorFamily,
  Record<FormatReadiness, string>
> = {
  blue: {
    empty: "bg-blue-50 text-blue-600 border-dashed border-blue-200",
    incomplete: "bg-blue-50 text-blue-700 border-dashed border-blue-300",
    ready: "bg-blue-100 text-blue-800 border-blue-300",
    scheduled: "bg-blue-50 text-blue-700 border-blue-400",
    published: "bg-blue-50 text-blue-700 border-blue-400",
  },
  purple: {
    empty: "bg-purple-50 text-purple-600 border-dashed border-purple-200",
    incomplete: "bg-purple-50 text-purple-700 border-dashed border-purple-300",
    ready: "bg-purple-100 text-purple-800 border-purple-300",
    scheduled: "bg-purple-50 text-purple-700 border-purple-400",
    published: "bg-purple-50 text-purple-700 border-purple-400",
  },
  orange: {
    empty: "bg-orange-50 text-orange-600 border-dashed border-orange-200",
    incomplete: "bg-orange-50 text-orange-700 border-dashed border-orange-300",
    ready: "bg-orange-100 text-orange-800 border-orange-300",
    scheduled: "bg-orange-50 text-orange-700 border-orange-400",
    published: "bg-orange-50 text-orange-700 border-orange-400",
  },
  teal: {
    empty: "bg-teal-50 text-teal-600 border-dashed border-teal-200",
    incomplete: "bg-teal-50 text-teal-700 border-dashed border-teal-300",
    ready: "bg-teal-100 text-teal-800 border-teal-300",
    scheduled: "bg-teal-50 text-teal-700 border-teal-400",
    published: "bg-teal-50 text-teal-700 border-teal-400",
  },
  gray: {
    // Empty state uses design-system tokens (light surface) per Hani —
    // pre-color-rollout look. Tailwind grays were too dark/ugly.
    empty:
      "bg-bg-surface text-text-neutral-default border-dashed border-border-neutral-default",
    incomplete:
      "bg-gray-50 text-gray-700 border-dashed border-gray-300",
    ready: "bg-gray-100 text-gray-800 border-gray-300",
    scheduled: "bg-gray-50 text-gray-700 border-gray-400",
    published: "bg-gray-50 text-gray-700 border-gray-400",
  },
}

/**
 * Public: same matrix as classes, but for ad-hoc consumers (e.g. the
 * calendar day-cell chip) that need just a background color hint without
 * pulling the full chip component. Returns the FAMILY name; the consumer
 * picks its own shade. Kept colocated so there's still one source of truth.
 */
export function getFormatColorFamilyName(format: FormatId): FormatColorFamily {
  return getFormatColorFamily(format)
}

/**
 * Static class lookup for the calendar day-cell chip and any other surface
 * that wants the same per-format hue but doesn't render a full FormatStatusChip
 * (e.g. it has its own checkbox + dropdown layout).
 *
 * Returns the bg/border/text trio for `(format, state)`. The hover variant
 * is included so day-cell chips highlight on hover with a slightly deeper
 * shade in their own color family — matching the legacy `hover:bg-yellow-90`
 * pattern but format-aware.
 *
 * IMPORTANT: classes are listed as full literals so Tailwind's static
 * extractor keeps them in the bundle.
 */
const FORMAT_HOVER_BG: Record<FormatColorFamily, string> = {
  blue: "hover:bg-blue-100",
  purple: "hover:bg-purple-100",
  orange: "hover:bg-orange-100",
  teal: "hover:bg-teal-100",
  gray: "hover:bg-gray-100",
}

export function getFormatChipClasses(
  format: FormatId,
  state: FormatReadiness,
): { container: string; hover: string } {
  const family = getFormatColorFamily(format, state)
  return {
    container: FORMAT_COLOR_CLASSES[family][state],
    hover: FORMAT_HOVER_BG[family],
  }
}

/**
 * Status overlay icon — sits next to the format icon inside the chip.
 * Currently null for every state; the corner badge is the sole signal.
 */
const stateOverlayIcon: Record<FormatReadiness, LucideIcon | null> = {
  empty: null,
  incomplete: null,
  ready: null,
  scheduled: null,
  published: null,
}

/**
 * Custom clock-hands SVG (no outer circle). Lucide's `Clock` ships with a
 * built-in circle that — inside the badge's own circle — reads as a
 * double ring. Hani's call: keep only the hands. Hour hand short and up,
 * minute hand pointing to roughly 4 o'clock.
 */
function ClockHandsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <line x1="12" y1="12" x2="12" y2="7" />
      <line x1="12" y1="12" x2="15.5" y2="14" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Aria label                                                          */
/* ------------------------------------------------------------------ */

/**
 * Spoken-form label — what a screen reader will announce. We always
 * concatenate format + state + (date) so the chip is comprehensible without
 * sight, even when it's pure-decoration in the page tree.
 */
function buildAriaLabel(
  format: FormatId,
  state: FormatReadiness,
  shortDate: string | null,
): string {
  const fmt = getFormatLabel(format)
  switch (state) {
    case "empty":
      return `${fmt}: לא הוכן`
    case "incomplete":
      return `${fmt}: צריך מדיה`
    case "ready":
      return `${fmt}: מוכן`
    case "scheduled":
      return shortDate ? `${fmt}: מתוזמן ל-${shortDate}` : `${fmt}: מתוזמן`
    case "published":
      return shortDate ? `${fmt}: פורסם ב-${shortDate}` : `${fmt}: פורסם`
  }
}

/* ------------------------------------------------------------------ */
/*  Visible label (in-chip text)                                        */
/* ------------------------------------------------------------------ */

/**
 * The text shown inside the chip. Differs from aria-label intentionally:
 * the visible label is short for scannability, the aria-label is full for
 * comprehension. They share a date format so the spoken date matches what's
 * on screen.
 *
 *   empty     → just the format name      "ריל"
 *   ready     → just the format name      "ריל"  (color = state signal)
 *   scheduled → just the format name      "ריל"  (Clock overlay = state signal)
 *   published → just the format name      "ריל"  (green V corner badge = state signal)
 */
function buildVisibleLabel(
  format: FormatId,
  _state: FormatReadiness,
  _shortDate: string | null,
): string {
  return getFormatLabel(format)
}

/* ------------------------------------------------------------------ */
/*  Base presentational component                                       */
/* ------------------------------------------------------------------ */

export type FormatStatusChipProps = {
  /** Format id — drives label + icon. Unknown ids fall back to a generic text icon. */
  format: FormatId
  /** Derived readiness state — caller is responsible for projection. */
  state: FormatReadiness
  /**
   * ISO timestamp (`publishedAt`) OR YYYY-MM-DD (`scheduledDate`). Only
   * rendered when state is `scheduled` or `published`. Ignored otherwise.
   */
  date?: string
  /**
   * `sm` for in-card pills (/core_posts, queue-panel), `md` for the
   * navigation-style chips row in the Sheet header. Defaults to `sm`.
   */
  size?: Size
  /**
   * Pure positioning override — keep this to layout concerns only (margins,
   * grid placement). Visual treatment lives inside the component.
   */
  className?: string
  /**
   * When true AND state is `scheduled` or `published`, render a small green
   * check badge in the top-left corner of the chip — the at-a-glance "this
   * format is on the calendar" signal for /core_posts cards.
   *
   * Off by default. Only enabled by /core_posts cards via
   * `FormatStatusChipLink`. Sheet header, queue panel, schedule picker, and
   * calendar day-cell consumers leave this off — they each carry the
   * scheduled signal in their own surface-appropriate way (header chip
   * scrolls, calendar uses opacity + position, queue panel shows a
   * single chip).
   */
  showScheduledBadge?: boolean
}

/**
 * Pure presentational chip. NEVER renders an interactive element — no
 * onClick, no href, no role. Wrap in `FormatStatusChipScrollTo` or
 * `FormatStatusChipLink` for the two interactive contexts we care about.
 *
 * The aria-label exists even on the base render because callers may drop
 * this inside a non-button container (e.g. inside a `<li>` whose handler
 * is on the li itself). The label is read on focus IF a wrapper makes it
 * focusable; on a non-interactive base render, screen readers will still
 * surface it during element navigation.
 */
export function FormatStatusChip({
  format,
  state,
  date,
  size = "sm",
  className,
  showScheduledBadge = false,
}: FormatStatusChipProps) {
  const FormatIcon = getFormatIcon(format)
  const OverlayIcon = stateOverlayIcon[state]
  const shortDate = formatShortHebrewDate(date)
  const visibleLabel = buildVisibleLabel(format, state, shortDate)
  const ariaLabel = buildAriaLabel(format, state, shortDate)

  // Per-format color identity (PHASE-3 INTERIM, see file header).
  // Empty state uses gray regardless of format — Hani's call: this gives two
  // axes of differentiation (filled vs empty AND between formats).
  const colorClasses =
    FORMAT_COLOR_CLASSES[getFormatColorFamily(format, state)][state]

  // Icon size scales with the chip: xs gets 10px, sm 12px, md 14px.
  const iconSize =
    size === "xs" ? "size-2.5" : size === "sm" ? "size-3" : "size-3.5"

  // Per Hani: corner badge marks "on the calendar."
  //   scheduled → orange disc + clock hands   (calendared, not yet aired)
  //   published → green disc + V (Check)      (calendared AND aired)
  // Same disc shape; color + icon disambiguate future vs. past. Always
  // shown across surfaces for consistency; `showScheduledBadge` is kept
  // on the prop as a no-op so existing call sites don't break.
  const showBadge = state === "scheduled" || state === "published"

  // The chip itself is `inline-flex` and the badge sits absolute on top, so
  // we need a wrapper with `relative` to anchor the badge. We KEEP the chip
  // as the existing span (no markup change) and add `relative` to it
  // directly — avoids an extra element when the badge is off, AND lets the
  // badge sit `absolute top-0 left-0` regardless of dir, which is what we
  // want (visual top-left in both LTR and RTL — see brief).
  return (
    <span
      className={[
        baseChipClass,
        sizeClass[size],
        colorClasses,
        showBadge ? "relative" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
      data-state={state}
      data-format={format}
    >
      <FormatIcon className={`${iconSize} shrink-0`} aria-hidden />
      {OverlayIcon && (
        <OverlayIcon className={`${iconSize} shrink-0`} aria-hidden />
      )}
      <span className="leading-none">{visibleLabel}</span>
      {showBadge && (
        // 14×14 disc anchored to the chip's visual top-left corner. We use
        // `left-0`/`top-0` (NOT logical `start-0`) because the brief pins it
        // visually to the LEFT regardless of document direction. The state
        // itself is conveyed by the chip's aria-label; the badge is purely
        // visual reinforcement, hence aria-hidden.
        //
        // Per Hani: gray badge for "waiting" (scheduled, not yet aired);
        // green badge for "done" (published). Same disc shape + white
        // icon — only the disc color and inner glyph change.
        <span
          aria-hidden="true"
          className={[
            "absolute -top-1 -left-1 inline-flex items-center justify-center",
            "size-3.5 rounded-full ring-2 ring-white shadow-sm",
            state === "scheduled" ? "bg-gray-400" : "bg-emerald-500",
          ].join(" ")}
        >
          {state === "scheduled" ? (
            <ClockHandsIcon className="size-2.5 text-white" />
          ) : (
            <Check className="size-2.5 text-white" strokeWidth={3} />
          )}
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Wrapper 1: <a> with smooth scroll + focus management                */
/* ------------------------------------------------------------------ */

export type FormatStatusChipScrollToProps = FormatStatusChipProps & {
  /**
   * `id` of the section the chip should jump to. The component renders
   * `href="#{targetId}"` so the URL hash updates (browser-native back/forward
   * nav still works), AND intercepts the click to do a smooth scroll +
   * programmatic focus move so screen-reader users land on the section
   * heading instead of just visually scrolling past it.
   */
  targetId: string
}

/**
 * Anchor wrapper for the Sheet header chips row.
 *
 * Why an `<a>` and not a `<button>`?  Because this IS navigation within
 * the Sheet (anchor-style jump to a section), and the URL hash is the
 * canonical representation. Native `<a href="#id">` gives us:
 *   - keyboard activation (Enter)
 *   - context menu "open in new tab" (harmless here, but principled)
 *   - screen reader announcement of "link"
 *
 * We intercept the click only to do smooth scrolling and focus management;
 * the default anchor behavior is the fallback.
 */
export function FormatStatusChipScrollTo({
  targetId,
  className,
  ...chipProps
}: FormatStatusChipScrollToProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (typeof document === "undefined") return
    const target = document.getElementById(targetId)
    if (!target) return // Native hash navigation will handle the (failed) jump.
    e.preventDefault()
    target.scrollIntoView({ behavior: "smooth", block: "start" })
    // Move focus so screen readers announce the section. The target may not
    // be focusable by default — we add tabIndex=-1 only if it isn't already
    // focusable, then remove on blur to keep the tab order clean.
    const wasFocusable = target.hasAttribute("tabindex")
    if (!wasFocusable) target.setAttribute("tabindex", "-1")
    target.focus({ preventScroll: true })
    if (!wasFocusable) {
      const cleanup = () => {
        target.removeAttribute("tabindex")
        target.removeEventListener("blur", cleanup)
      }
      target.addEventListener("blur", cleanup)
    }
    // Update the hash without adding a history entry — replaces so the
    // back button still escapes the Sheet rather than walking through chips.
    history.replaceState(null, "", `#${targetId}`)
  }

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      // The chip's own focus-visible ring is a yellow-50 ring; we apply it
      // to the anchor so keyboard users see the focused chip clearly.
      className={[
        "rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 focus-visible:ring-offset-1",
        "hover:opacity-90",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <FormatStatusChip {...chipProps} />
    </a>
  )
}

/* ------------------------------------------------------------------ */
/*  Wrapper 2: <button> for action contexts                             */
/* ------------------------------------------------------------------ */

export type FormatStatusChipLinkProps = FormatStatusChipProps &
  Omit<ComponentPropsWithoutRef<"button">, "className" | "children"> & {
    onClick: () => void
  }

/**
 * Button wrapper for /core_posts cards.
 *
 * Why a `<button>` and not an `<a>`?  Because clicking does NOT navigate —
 * it opens a Sheet in place. Calling this an `<a>` would lie to assistive
 * tech and break right-click "open in new tab" expectations.
 */
export function FormatStatusChipLink({
  onClick,
  className,
  format,
  state,
  date,
  size,
  showScheduledBadge,
  ...buttonProps
}: FormatStatusChipLinkProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Cards in /core_posts are themselves clickable, so chip clicks
        // need to stop bubbling — otherwise the click fires twice (once on
        // the chip, once on the card behind it).
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        // Same reason: prevent the parent card's keydown from also firing.
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation()
        }
      }}
      className={[
        "rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 focus-visible:ring-offset-1",
        "hover:opacity-90 cursor-pointer",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...buttonProps}
    >
      <FormatStatusChip
        format={format}
        state={state}
        date={date}
        size={size}
        showScheduledBadge={showScheduledBadge}
      />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Export helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Re-export the date formatter so callers (e.g. the calendar grid) can
 * render the same DD/MM short form alongside chips without re-implementing
 * the locale logic.
 */
export { formatShortHebrewDate as formatChipDate }

/**
 * Re-export the format → label / icon helpers. Some surfaces (Sheet body,
 * calendar tooltip) want the same icon glyph next to a header that isn't
 * itself a chip — keeping a single source for the mapping prevents drift.
 */
export { getFormatIcon as getFormatChipIcon, getFormatLabel as getFormatChipLabel }
