"use client"

/**
 * The calendar preview's network switch — and the connected-networks marker
 * above the board.
 *
 * A post now goes to every connected network that fits its format (Hani,
 * 2026-11-05), so the preview has to answer two questions it never had to:
 * "how does it look THERE?" and "is it going there at all?". Two layouts
 * compete for that, gated by `?variant=a|b` on /calendar:
 *
 *   A — NetworkTabs: one network at a time. Tabs over the phone frame; the
 *       status box and an "עולה ל-X" checkbox follow the selected tab.
 *       Focus: look at one destination properly.
 *   B — NetworkList: every network at once. The status box becomes a list —
 *       one row per network with its own status and checkbox; picking a row
 *       swaps the frame. Overview: see all destinations, then dive in.
 *
 * Both reuse the same pieces below (glyph, status words, frames), so the
 * review compares placement and hierarchy, not two drifting copies.
 */

import { AlertCircle, Check, MoreHorizontal, ThumbsUp, MessageSquare, Repeat2, Send } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { NETWORK_ICON } from "@/components/instagram-connect"
import { NETWORK_LABEL, toNetwork } from "@/lib/social/networks"
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

export type NetworkSwitchVariant = "a" | "b"

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

const TONE_TEXT: Record<Tone, string> = {
  success: "text-green-20 dark:text-green-80",
  danger: "text-button-destructive-default",
  neutral: "text-text-neutral-default",
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
  const Icon = NETWORK_ICON[platform]
  const box = size === "sm" ? "size-7" : "size-8"
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full", box, mark === "off" ? "bg-bg-surface" : "bg-white dark:bg-gray-10 border border-border-neutral-default")}>
      <Icon
        aria-hidden
        className={cn(size === "sm" ? "size-3.5" : "size-4", mark === "off" ? "text-gray-70 dark:text-gray-40" : "text-text-primary-default")}
      />
      {mark === "ok" && (
        <span className="absolute -bottom-0.5 -end-0.5 flex size-3.5 items-center justify-center rounded-full bg-bg-surface-success-default ring-2 ring-white dark:ring-gray-10">
          <Check className="size-2.5 text-white" strokeWidth={3} aria-hidden />
        </span>
      )}
      {mark === "danger" && (
        <span className="absolute -bottom-0.5 -end-0.5 flex size-3.5 items-center justify-center rounded-full bg-button-destructive-default ring-2 ring-white dark:ring-gray-10">
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

// --- variant A: tabs over the frame --------------------------------------------

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

// --- variant B: every network, one row each ------------------------------------

export function NetworkList({
  networks,
  selected,
  onSelect,
  onToggle,
  readOnly,
  onConnect,
  onRetry,
}: {
  networks: PreviewNetwork[]
  selected: SocialPlatform
  onSelect: (p: SocialPlatform) => void
  onToggle: (p: SocialPlatform, include: boolean) => void
  readOnly?: boolean
  onConnect: (p: SocialPlatform) => void
  /** A failed network's "ניסיון חוזר" — re-sends the slot. */
  onRetry?: () => void
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="pv-networks">
      <h4 id="pv-networks" className="text-small-bold text-text-primary-default">
        לאן עולה
      </h4>
      <ul className="flex flex-col overflow-hidden rounded-xl border border-border-neutral-default">
        {networks.map((n, i) => {
          const s = networkStatusShort(n)
          const active = n.platform === selected
          const reason = n.included && n.publish.kind === "failed" ? n.publish.reason : null
          const needsConnect = n.connection !== "connected"
          return (
            <li
              key={n.platform}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5",
                i > 0 && "border-t border-border-neutral-default",
                active && "bg-gray-95 dark:bg-gray-20",
              )}
            >
              <Checkbox
                aria-label={`הפוסט עולה ${toNetwork(n.platform)}`}
                checked={n.included && !needsConnect}
                disabled={readOnly || needsConnect}
                onCheckedChange={(v) => onToggle(n.platform, v === true)}
                className="mt-2"
              />
              <button
                type="button"
                onClick={() => onSelect(n.platform)}
                aria-pressed={active}
                aria-label={`תצוגה ${n.platform === "instagram" ? "באינסטגרם" : `ב-${NETWORK_LABEL[n.platform]}`}`}
                className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              >
                <NetworkGlyph platform={n.platform} mark={markFor(n)} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="text-small-bold text-text-primary-default">{NETWORK_LABEL[n.platform]}</span>
                    {n.handle && n.connection === "connected" && (
                      <bdi className="truncate text-xs-body text-text-neutral-default">
                        {n.platform === "instagram" ? `@${n.handle.replace(/^@/, "")}` : n.handle}
                      </bdi>
                    )}
                  </span>
                  <span className={cn("flex items-center gap-1 text-xs-body", TONE_TEXT[s.tone])}>
                    {s.tone === "danger" && <AlertCircle className="size-3 shrink-0" aria-hidden />}
                    {s.tone === "success" && <Check className="size-3 shrink-0" aria-hidden />}
                    {s.label}
                  </span>
                  {reason && <span className="text-xs-body text-text-neutral-default">{reason}</span>}
                </span>
              </button>
              {!needsConnect && reason && !readOnly && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-1.5 shrink-0 rounded text-xs-body font-medium text-text-primary-default underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                >
                  ניסיון חוזר
                </button>
              )}
              {needsConnect && !readOnly && (
                <button
                  type="button"
                  onClick={() => onConnect(n.platform)}
                  className="mt-1.5 shrink-0 rounded text-xs-body font-medium text-text-primary-default underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                >
                  {n.connection === "expired" ? "חיבור מחדש" : "חיבור"}
                </button>
              )}
            </li>
          )
        })}
      </ul>
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
