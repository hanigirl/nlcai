"use client"

/**
 * The calendar preview's network switch — and the connected-networks marker
 * above the board.
 *
 * A post now goes to every connected network that fits its format (Hani,
 * 2026-11-05), so the preview answers two questions it never had to: "how
 * does it look THERE?" and "is it going there at all?".
 *
 * Hani picked direction A (2026-11-05): tabs over the phone frame, one network
 * at a time. The status box and an "הפוסט עולה ל-X" checkbox follow the
 * selected tab. (Direction B, one row per network, was dropped.)
 */

import { Check, MoreHorizontal, ThumbsUp, MessageSquare, Repeat2, Send } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { NetworkLogo } from "@/components/network-logos"
import {
  DEFAULT_YOUTUBE_PRIVACY,
  NETWORK_LABEL,
  YOUTUBE_PRIVACY_OPTIONS,
  isYouTubePrivacy,
  toNetwork,
} from "@/lib/social/networks"
import { Select } from "@/components/ui/select"
import type { SocialPlatform } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"
import {
  FormatMedia,
  SlideDots,
  type FormatPreviewData,
  type PreviewContentState,
  type PreviewNetwork,
  type PublishStatus,
} from "./shared"

// --- status words ------------------------------------------------------------

type Tone = "success" | "danger" | "neutral"

/** The few words a tab or a row has room for, per network. */
export function networkStatusShort(n: PreviewNetwork): { label: string; tone: Tone } {
  // A network she never connected is a fact, not a fault: grey, not red.
  if (n.connection === "none") return { label: "לא מחובר", tone: "neutral" }
  if (n.connection === "expired") return { label: "החיבור פג", tone: "danger" }
  if (!n.included) return { label: "לא עולה לכאן", tone: "neutral" }
  return statusShort(n.publish)
}

function statusShort(p: PublishStatus): { label: string; tone: Tone } {
  switch (p.kind) {
    case "scheduled":
      return { label: "תוזמן", tone: "success" }
    case "published":
      return { label: "פורסם", tone: "success" }
    case "failed":
      return { label: "לא תוזמן", tone: "danger" }
    case "not_connected":
      return { label: "לא מחובר", tone: "danger" }
    case "pending":
      return { label: "בתהליך", tone: "neutral" }
    case "sent":
      return { label: "יצא לפרסום", tone: "neutral" }
    case "draft":
    case "unscheduled":
    default:
      return { label: "יעלה עם התזמון", tone: "neutral" }
  }
}

/**
 * A network's glyph with a corner mark — the shape Hani asked for above the
 * calendar ("the network's icon with a green checkmark"), reused on the tabs.
 *
 *   ok      — green check
 *   danger  — red "!"
 *   off     — no mark, glyph greyed (not connected / not going there)
 */
export function NetworkGlyph({
  platform,
  mark,
  size = "md",
}: {
  platform: SocialPlatform
  mark: "ok" | "danger" | "off" | "none"
  size?: "sm" | "md"
}) {
  const box = size === "sm" ? "size-7" : "size-8"
  // The mark sits on the circle's edge, not on the logo.
  const badge = size === "sm" ? "-bottom-1 -end-1 size-3" : "-bottom-0.5 -end-0.5 size-3.5"
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full", box, mark === "off" ? "bg-bg-surface" : "bg-white dark:bg-gray-10 border border-border-neutral-default")}>
      <NetworkLogo platform={platform} off={mark === "off"} className={size === "sm" ? "size-4" : "size-[18px]"} />
      {mark === "ok" && (
        <span className={cn("absolute flex items-center justify-center rounded-full bg-bg-surface-success-default ring-2 ring-white dark:ring-gray-10", badge)}>
          <Check className={cn("text-white", size === "sm" ? "size-2" : "size-2.5")} strokeWidth={3} aria-hidden />
        </span>
      )}
      {mark === "danger" && (
        <span className={cn("absolute flex items-center justify-center rounded-full bg-button-destructive-default ring-2 ring-white dark:ring-gray-10", badge)}>
          <span className="text-[9px] font-bold leading-none text-white" aria-hidden>!</span>
        </span>
      )}
    </span>
  )
}

function markFor(n: PreviewNetwork): "ok" | "danger" | "off" {
  const { tone } = networkStatusShort(n)
  if (!n.included || n.connection === "none") return "off"
  return tone === "danger" ? "danger" : tone === "success" ? "ok" : "off"
}

// --- tabs over the frame ---------------------------------------------------------

export function NetworkTabs({
  networks,
  selected,
  onSelect,
}: {
  networks: PreviewNetwork[]
  selected: SocialPlatform
  onSelect: (p: SocialPlatform) => void
}) {
  if (networks.length < 2) return null
  return (
    <div
      role="tablist"
      aria-label="רשת לתצוגה"
      className="flex w-full max-w-[300px] gap-1 rounded-xl border border-border-neutral-default bg-white p-1 dark:bg-gray-10"
    >
      {networks.map((n) => {
        const active = n.platform === selected
        const s = networkStatusShort(n)
        return (
          <button
            key={n.platform}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${NETWORK_LABEL[n.platform]} · ${s.label}`}
            onClick={() => onSelect(n.platform)}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
              active ? "bg-gray-95 dark:bg-gray-20" : "hover:bg-gray-95 dark:hover:bg-gray-20",
            )}
          >
            <NetworkGlyph platform={n.platform} mark={markFor(n)} size="sm" />
            <span className={cn("truncate text-[11px] leading-tight", active ? "font-semibold text-text-primary-default" : "text-text-neutral-default")}>
              {NETWORK_LABEL[n.platform]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** "עולה ל-YouTube" — the per-post opt-out, as a checkbox row. */
export function IncludeNetworkRow({
  network,
  disabled,
  onToggle,
}: {
  network: PreviewNetwork
  disabled?: boolean
  onToggle: (include: boolean) => void
}) {
  const id = `include-${network.platform}`
  return (
    <label htmlFor={id} className={cn("flex items-center gap-2 text-small text-text-primary-default", disabled ? "opacity-60" : "cursor-pointer")}>
      <Checkbox
        id={id}
        checked={network.included}
        disabled={disabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      הפוסט עולה {toNetwork(network.platform)}
    </label>
  )
}

/**
 * YouTube privacy for this post — ציבורי / לא רשום / פרטי (Hani, 2026-11-05).
 * The app's own select, in the preview's section style.
 */
export function YouTubePrivacyField({
  value,
  disabled,
  onChange,
}: {
  value: "public" | "unlisted" | "private" | undefined
  disabled?: boolean
  onChange: (v: "public" | "unlisted" | "private") => void
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="pv-yt-privacy">
      <h4 id="pv-yt-privacy" className="text-small-bold text-text-primary-default">
        פרטיות ב-YouTube
      </h4>
      <Select
        selectSize="small"
        variant="homepage"
        aria-labelledby="pv-yt-privacy"
        value={value ?? DEFAULT_YOUTUBE_PRIVACY}
        disabled={disabled}
        onChange={(e) => isYouTubePrivacy(e.target.value) && onChange(e.target.value)}
      >
        {YOUTUBE_PRIVACY_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </section>
  )
}

// --- frames --------------------------------------------------------------------

const FRAME =
  "w-[300px] shrink-0 overflow-hidden rounded-[28px] border-[6px] border-gray-10 bg-white shadow-lg dark:bg-gray-10"

/**
 * YouTube: a vertical clip lands as a Short. Title (the hook) and channel over
 * the video, the way it's met in the Shorts feed.
 */
export function YouTubeFrame({
  data,
  content,
  handle,
  title,
}: {
  data: FormatPreviewData
  content: PreviewContentState
  handle: string | null
  title: string
}) {
  const overlay =
    content === "ready" ? (
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/30 via-transparent to-black/60 p-3">
        <span className="text-small-bold text-white">Shorts</span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-white/90 text-[11px] font-medium text-text-primary-default" aria-hidden>
              {(handle ?? "Y").slice(0, 1).toUpperCase()}
            </span>
            <bdi className="text-xs-body font-semibold text-white">{handle ?? "הערוץ שלכם"}</bdi>
          </div>
          <p className="line-clamp-2 text-small-bold text-white">{title}</p>
        </div>
      </div>
    ) : null
  return (
    <div className={FRAME} aria-label="תצוגה כפי שתיראה ב-YouTube">
      <FormatMedia data={data} content={content} index={0} onIndexChange={() => {}} overlay={overlay} />
    </div>
  )
}

/**
 * LinkedIn: the caption sits ABOVE the media, clamped to three lines with
 * "עוד", then the media, then the reaction row.
 */
export function LinkedInFrame({
  data,
  content,
  handle,
  slide,
  onSlide,
}: {
  data: FormatPreviewData
  content: PreviewContentState
  handle: string | null
  slide: number
  onSlide: (i: number) => void
}) {
  return (
    <div className={FRAME} aria-label="תצוגה כפי שתיראה ב-LinkedIn">
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-gray-95 text-xs-body font-medium text-text-primary-default dark:bg-gray-20" aria-hidden>
          {(handle ?? "L").slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <bdi className="truncate text-small-bold text-text-primary-default">{handle ?? "הפרופיל שלכם"}</bdi>
          <span className="text-[11px] text-text-neutral-default">עכשיו</span>
        </div>
        <MoreHorizontal className="size-4 text-text-neutral-default" aria-hidden />
      </div>
      <div className="px-3 py-2">
        {content === "loading" ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <p className="line-clamp-3 whitespace-pre-wrap text-xs-body text-text-primary-default">{data.caption}</p>
        )}
      </div>
      <FormatMedia data={data} content={content} index={slide} onIndexChange={onSlide} />
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <SlideDots total={content === "ready" ? data.slides.length : 0} index={slide} />
        <div className="flex items-center justify-between text-text-neutral-default" aria-hidden>
          <ThumbsUp className="size-4" />
          <MessageSquare className="size-4" />
          <Repeat2 className="size-4" />
          <Send className="size-4" />
        </div>
      </div>
    </div>
  )
}

// --- above the calendar: which networks are connected --------------------------

export type ConnectedNetwork = {
  platform: SocialPlatform
  state: "connected" | "expired" | "none" | "loading"
  handle?: string | null
}

/**
 * The networks' glyphs, each with a green check when connected (Hani's
 * suggestion). Not connected: the glyph in grey with no mark — present, so
 * she sees the network exists, quiet, because nothing is wrong with a network
 * she never chose. Lapsed: a red "!", because posts on it will not go out.
 * Clicking one opens that network's connect modal.
 */
export function ConnectedNetworksIndicator({
  networks,
  onOpen,
  className,
}: {
  networks: ConnectedNetwork[]
  onOpen: (p: SocialPlatform) => void
  className?: string
}) {
  if (networks.some((n) => n.state === "loading")) {
    return <span aria-hidden className={cn("inline-flex h-8 w-28 animate-pulse rounded-full bg-gray-95 dark:bg-gray-20", className)} />
  }
  return (
    <div role="group" aria-label="רשתות מחוברות" className={cn("flex items-center gap-1.5", className)}>
      {networks.map((n) => {
        const label =
          n.state === "connected"
            ? `${NETWORK_LABEL[n.platform]} · מחובר${n.handle ? ` בתור ${n.handle.replace(/^@/, "")}` : ""}`
            : n.state === "expired"
              ? `${NETWORK_LABEL[n.platform]} · החיבור פג`
              : `${NETWORK_LABEL[n.platform]} · לא מחובר`
        return (
          <Tooltip key={n.platform}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpen(n.platform)}
                aria-haspopup="dialog"
                aria-label={`${label}. פתיחת הגדרות החיבור`}
                className="rounded-full transition-colors hover:bg-gray-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 dark:hover:bg-gray-20"
              >
                <NetworkGlyph
                  platform={n.platform}
                  mark={n.state === "connected" ? "ok" : n.state === "expired" ? "danger" : "off"}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
