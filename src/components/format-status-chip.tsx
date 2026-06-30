"use client"

/**
 * FormatStatusChip — single source of truth for "this (post, format) is in
 * state X" across the timing feature.
 *
 * BINARY visual model (updated 2026-06-25 — Hani: "רק שוכפל לא שוכפל"):
 *   ChipState = "not-started" | "ready" | "set"
 *
 *   The chip now answers exactly one question: was this format DUPLICATED
 *   (the user created a variant) or not? Media and scheduling status no
 *   longer affect it — scheduling lives on the calendar grid (as cards),
 *   not on this chip. So only two visuals are produced in practice:
 *   gray ("not-started" = not duplicated) and yellow ("ready" = duplicated).
 *
 *   Mapping from the 5-state internal `FormatReadiness` (kept in
 *   `timing-storage.ts` for nuance the model still tracks):
 *     empty       → not-started   (format NOT duplicated on this post)
 *     incomplete  → ready          (duplicated, no media yet)
 *     ready       → ready          (duplicated, has media)
 *     scheduled   → ready          (duplicated, on the calendar)
 *     published   → ready          (duplicated, aired)
 *
 * Visual rules (per Hani's spec):
 *   not-started → gray bg, gray text/icon, NO border (quieted to 50% opacity)
 *   ready       → yellow-90 bg, yellow-30 text/icon, NO border ("duplicated",
 *                 per Figma node 481:4847)
 *   set         → soft-green + ✓ badge. RETAINED in the palette but no longer
 *                 produced by `toChipState` (kept for `getFormatChipClasses`
 *                 callers that pass an explicit ChipState). Dead in practice.
 *
 * No per-format hue (intentional trade-off — see Hani's brief 2026-05-13):
 *   The previous Tailwind blue/purple/orange/teal palette is gone. The
 *   format identity now lives entirely in the icon glyph; the chip state
 *   is uniform across formats so "what's still on my plate" is the
 *   primary read.
 *
 * Wrappers, not props:
 *   The base component is presentational only — no onClick, no href. There
 *   are TWO thin wrappers for the two contexts that need interaction:
 *     - `FormatStatusChipScrollTo` — anchor that scrolls to a target id +
 *       moves focus there. Used in the Sheet header chips row.
 *     - `FormatStatusChipLink` — button that fires a callback. Used in
 *       /core_posts cards (click → open Sheet).
 */

import {
  Check,
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
 * — the component owns the visual language top-to-bottom (icon, label, copy).
 */
const FORMAT_LABELS: Record<string, string> = {
  story: "סטורי",
  talking_head: "דיבור למצלמה",
  carousel: "קרוסלה",
  image_post: "תמונה",
  static: "תמונה",
}

/**
 * Format → outline icon. The visual signifier of which format the chip
 * represents. `static` is an alias for `image_post`.
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
 * The chip itself no longer renders a date suffix (post-2026-05-13 spec),
 * but the helper is re-exported for surfaces (calendar tooltip, chip menu)
 * that want to render the same short form alongside chips.
 */
function formatShortHebrewDate(value: string | undefined): string | null {
  if (!value) return null
  try {
    let date: Date
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
/*  State model — 5-state internal → 3-state visual                     */
/* ------------------------------------------------------------------ */

export type ChipState = "not-started" | "ready" | "set"

/**
 * Project the 5-state internal readiness onto the 3-state visual chip.
 * Exported so call sites that want to mirror the chip's projection
 * (e.g. calendar day-cell logic) can stay aligned without re-deriving.
 */
export function toChipState(state: FormatReadiness): ChipState {
  switch (state) {
    case "empty":
      return "not-started"
    // Per Hani 2026-06-25: the chip is now BINARY — "שוכפל או לא שוכפל".
    // Everything past "not duplicated" (incomplete / ready / scheduled /
    // published) is "duplicated" and shares the yellow visual. Media AND
    // scheduling no longer change the color — scheduling status lives on the
    // calendar grid (as cards), not on this chip.
    case "incomplete":
    case "ready":
    case "scheduled":
    case "published":
      return "ready"
  }
}

/* ------------------------------------------------------------------ */
/*  Size / type tokens                                                  */
/* ------------------------------------------------------------------ */

type Size = "xs" | "sm" | "md"
export type FormatChipType = "full" | "icon"

/**
 * Base chip class — always applied regardless of state or size.
 * Gap is intentionally not set here: each size variant in
 * `sizeClassFull` owns its own gap so the icon-to-label spacing
 * stays in sync with Figma per-size (xs/sm/md).
 */
const baseChipClass =
  "inline-flex items-center justify-center rounded-full border whitespace-nowrap transition-colors tabular-nums"

/**
 * Size tokens for type=full (icon + label).
 *   xs → tightest variant (queue rows where multiple chips stack).
 *   sm → cards (/core_posts grid), schedule picker, header.
 *   md → Sheet header where the chip reads as navigation.
 *
 * type=icon overrides the horizontal padding to make a square 28×28 button.
 */
// Full chip spacing matches the Figma chip component (node 328:8515):
//   sm → py-1.5 (6px), px-2 (8px), gap-0.5 (2px). Overrides the gap-1.5
//   baseline from `baseChipClass` because the icon-to-label gap in
//   Hani's design is tight (the chip reads as one token, not two
//   visually separated pieces).
const sizeClassFull: Record<Size, string> = {
  xs: "h-5 px-1.5 text-[10px] leading-none gap-1",
  sm: "h-7 px-2 text-xs-body gap-0.5",
  md: "h-8 px-3 text-small gap-1",
}
const sizeClassIcon: Record<Size, string> = {
  xs: "size-5 p-0",
  sm: "size-7 p-0",
  md: "size-8 p-0",
}

/**
 * Icon size scales with the chip: xs gets 10px, sm 12px, md 14px.
 */
function iconSizeFor(size: Size): string {
  return size === "xs" ? "size-2.5" : size === "sm" ? "size-3" : "size-3.5"
}

/* ------------------------------------------------------------------ */
/*  State → visual treatment (3 neutral classes, no per-format hue)     */
/* ------------------------------------------------------------------ */

/**
 * Per-state class strings. Listed as full literals so Tailwind's static
 * extractor keeps every class in the bundle.
 *
 * Colors source the project's design-system tokens defined in globals.css:
 *   gray-98 (#FAFAFA), gray-50 (#808080), green-success-97 (#F0FDFA),
 *   green-success-50 (#00786F). These match Hani's Figma `chip` component
 *   variables 1:1 — do NOT use Tailwind's default `teal-*` / `gray-100+`
 *   palettes here; the project tokens deliberately diverge.
 */
const chipStateClasses: Record<ChipState, string> = {
  "not-started": "bg-gray-98 text-gray-50 border-transparent",
  // "ready" = DUPLICATED — matches Figma node 481:4847 exactly: yellow-90
  // fill (#FFF3CC) + yellow-30 text/icon (#997500), transparent border
  // (no stroke).
  "ready": "bg-yellow-90 text-yellow-30 border-transparent",
  "set": "bg-green-success-97 text-green-success-50 border-solid border-green-success-50",
}

/**
 * Optional hover variants, used by surfaces that wrap the chip in their
 * own clickable container (e.g. day-cell on /calendar). The base chip is
 * non-interactive, so this is opt-in via `getFormatChipClasses`.
 */
const chipStateHover: Record<ChipState, string> = {
  "not-started": "hover:bg-gray-95",
  "ready": "hover:bg-yellow-80",
  "set": "hover:bg-green-success-97/80",
}

/**
 * Public class lookup for day-cell chips and any surface that wants the
 * same visual treatment without rendering a full `FormatStatusChip` (e.g.
 * a chip that needs its own checkbox + dropdown layout).
 *
 * The `format` parameter is preserved for backwards compatibility but no
 * longer affects the result — colors are uniform across formats per the
 * 2026-05-13 spec. We accept either a `FormatReadiness` (5-state) or a
 * `ChipState` (3-state) and project accordingly.
 */
export function getFormatChipClasses(
  _format: FormatId,
  state: FormatReadiness | ChipState,
): { container: string; hover: string } {
  const chipState: ChipState = isChipState(state) ? state : toChipState(state)
  return {
    container: chipStateClasses[chipState],
    hover: chipStateHover[chipState],
  }
}

function isChipState(s: string): s is ChipState {
  return s === "not-started" || s === "ready" || s === "set"
}

/**
 * Back-compat shim — returns a constant string now that colors are
 * uniform. Kept so existing call sites that import it still type-check;
 * safe to delete once those imports are migrated.
 */
export function getFormatColorFamilyName(_format: FormatId): "gray" {
  return "gray"
}

/* ------------------------------------------------------------------ */
/*  Aria + visible labels                                               */
/* ------------------------------------------------------------------ */

/**
 * Spoken-form label. The 5-state distinction (empty vs incomplete,
 * scheduled vs published) is preserved here so screen readers still get
 * the nuance the visual chip flattens.
 */
function buildAriaLabel(format: FormatId, state: FormatReadiness): string {
  const fmt = getFormatLabel(format)
  switch (state) {
    case "empty":
      return `${fmt}: לא הוכן`
    case "incomplete":
      return `${fmt}: צריך מדיה`
    case "ready":
      return `${fmt}: מוכן`
    case "scheduled":
      return `${fmt}: מתוזמן`
    case "published":
      return `${fmt}: פורסם`
  }
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
   * `sm` for in-card pills (/core_posts, queue-panel), `md` for the
   * navigation-style chips row in the Sheet header. Defaults to `sm`.
   */
  size?: Size
  /**
   * Chip type — `full` (icon + label) or `icon` (compact 28×28 circle,
   * label hidden). Default `full`.
   */
  type?: FormatChipType
  /**
   * Pure positioning override — keep this to layout concerns only (margins,
   * grid placement). Visual treatment lives inside the component.
   */
  className?: string
  /**
   * Back-compat no-ops. The post-2026-05-13 chip doesn't render a date or
   * a scheduled-corner badge, but these props are kept so existing call
   * sites still type-check.
   */
  date?: string
  showScheduledBadge?: boolean
  /**
   * When set + type=icon, suppresses the top-right ✓ corner badge while
   * keeping the green palette (`set` state colors). Used by the calendar
   * SlotCard to render a "scheduled elsewhere for this post" cue — same
   * green background as the slot-anchored format, no checkmark because
   * the ✓ is reserved for "scheduled HERE".
   */
  hideCornerBadge?: boolean
  /**
   * When set + type=icon, renders the top-right ✓ corner badge in a muted
   * gray palette instead of emerald — same shape and position, weaker
   * affordance. Per Hani 2026-05-13: used by the calendar SlotCard to
   * mark "scheduled at ANOTHER slot for this post" so the ✓ STILL conveys
   * "this format is on the calendar" but doesn't compete with the
   * green-✓ "scheduled HERE" anchor sitting next to it. Pairs with a
   * dashed border on the chip (the "weaker set" body treatment).
   *
   * Ignored when `hideCornerBadge` is also set (hide wins — no badge).
   */
  cornerBadgeMuted?: boolean
}

/**
 * Pure presentational chip. NEVER renders an interactive element — no
 * onClick, no href, no role. Wrap in `FormatStatusChipScrollTo` or
 * `FormatStatusChipLink` for the two interactive contexts we care about.
 */
export function FormatStatusChip({
  format,
  state,
  size = "sm",
  type = "full",
  className,
  hideCornerBadge = false,
  cornerBadgeMuted = false,
}: FormatStatusChipProps) {
  const FormatIcon = getFormatIcon(format)
  const chipState = toChipState(state)
  const ariaLabel = buildAriaLabel(format, state)
  const isFull = type === "full"
  const isSet = chipState === "set"
  const iconSize = iconSizeFor(size)

  // Post-2026-05-13 (Hani, Figma node 328:8515): the format icon is now
  // visible in EVERY state — including `set`. The ✓ corner badge
  // signals "done" on top of the format icon instead of replacing it,
  // so format identity stays legible across all chip variants.
  //
  // `hideCornerBadge` keeps the chip's green palette but suppresses the
  // ✓ — used to mark "scheduled at ANOTHER slot for this post" on the
  // calendar (✓ stays reserved for "scheduled HERE"). `cornerBadgeMuted`
  // is the softer counterpart — shows ✓ in green-success-70 instead of
  // emerald, signaling "on the calendar elsewhere" without competing
  // with the bold green anchor that sits next to it.
  const showCornerCheckBadge = isSet && !hideCornerBadge

  // "Weaker set" — same green palette as `set`, but with a DASHED
  // border replacing the solid one. Used by the calendar SlotCard to
  // mark a format that's scheduled at ANOTHER slot for this post.
  // Two variants share this body treatment:
  //   - `hideCornerBadge` (legacy): no ✓ at all
  //   - `cornerBadgeMuted` (post-2026-05-13): ✓ rendered in gray
  // Solid border + green ✓ stays reserved for "scheduled HERE".
  const isWeakerSet =
    chipState === "set" && (hideCornerBadge || cornerBadgeMuted)
  const stateClass = isWeakerSet
    ? "bg-green-success-97 text-green-success-50 border-dashed border-green-success-50"
    : chipStateClasses[chipState]

  // "Not duplicated at all" (`empty`) is the only gray state now —
  // duplicated formats are yellow ("ready") and scheduled ones green
  // ("set"). Dimming the gray chip to 50% opacity makes "this format
  // isn't even on the post" read as the quietest state, well below the
  // duplicated-yellow it sits next to.
  const isUnusedFormat = state === "empty"
  const opacityClass = isUnusedFormat ? "opacity-50" : ""

  return (
    <span
      className={[
        baseChipClass,
        // `relative` anchors the corner badge for icon+set; harmless on
        // other variants. Pair with the chip's existing `rounded-full` —
        // we keep overflow visible so the badge can overhang the circle.
        "relative",
        isFull ? sizeClassFull[size] : sizeClassIcon[size],
        stateClass,
        opacityClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
      data-state={chipState}
      data-readiness={state}
      data-format={format}
    >
      <FormatIcon className={`${iconSize} shrink-0`} aria-hidden />
      {isFull && <span className="leading-none">{getFormatLabel(format)}</span>}
      {showCornerCheckBadge && (
        // Corner ✓ badge. 12×12 disc with a 6px white check inside,
        // positioned -5px / -5px to overhang the chip's top-right edge
        // (sizes + offsets match Figma node 328:8515 1:1). `ring-2
        // ring-white` gives the badge a crisp halo so it reads as a
        // separate element even on a tinted parent surface.
        //
        // Uses PHYSICAL `right`, not logical `end`: the Figma chip
        // anchors the badge to the physical top-right corner so the
        // visual position is identical in LTR and RTL contexts. With
        // logical properties the badge would flip to the visual top-
        // LEFT in RTL — which is wrong; the Hebrew chips on Hani's
        // /core_posts and /calendar surfaces have the badge at the
        // visual top-right (same as the design source).
        //
        // `cornerBadgeMuted` swaps emerald → green-success-70
        // (#A4BBB6, a desaturated teal in the same family as the
        // chip body) for the weaker "scheduled elsewhere" variant.
        <span
          aria-hidden
          className={`absolute -top-[5px] -right-[5px] inline-flex items-center justify-center size-3 rounded-full ring-2 ring-white ${
            cornerBadgeMuted ? "bg-green-success-70" : "bg-emerald-500"
          }`}
        >
          <Check className="size-1.5 text-white" strokeWidth={3} />
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

export function FormatStatusChipScrollTo({
  targetId,
  className,
  ...chipProps
}: FormatStatusChipScrollToProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (typeof document === "undefined") return
    const target = document.getElementById(targetId)
    if (!target) return
    e.preventDefault()
    target.scrollIntoView({ behavior: "smooth", block: "start" })
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
    history.replaceState(null, "", `#${targetId}`)
  }

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
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

export function FormatStatusChipLink({
  onClick,
  className,
  chipClassName,
  format,
  state,
  size,
  type,
  date,
  showScheduledBadge,
  ...buttonProps
}: FormatStatusChipLinkProps & {
  /**
   * Optional className forwarded to the INNER `FormatStatusChip` span
   * (the part that actually paints bg/border/text). Use this when the
   * surrounding surface needs to tint the chip's background on its own
   * hover/focus — e.g. /core_posts cards apply
   * `group-hover:bg-bg-surface-primary-default-80` so the chip echoes
   * the card's yellow hover state, matching the edit-arrow button.
   *
   * Separate from `className` (which targets the button wrapper) so
   * focus rings + click affordances stay on the button while the chip
   * paint is overridable independently.
   */
  chipClassName?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
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
        size={size}
        type={type}
        date={date}
        showScheduledBadge={showScheduledBadge}
        className={chipClassName}
      />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Export helpers                                                      */
/* ------------------------------------------------------------------ */

export { formatShortHebrewDate as formatChipDate }
export { getFormatIcon as getFormatChipIcon, getFormatLabel as getFormatChipLabel }
