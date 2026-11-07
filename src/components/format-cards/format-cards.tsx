"use client"

/**
 * Format cards on the project canvas — design review `?cards=a|b`
 * (Notion: "שכפול לפורמטים כותב ברקע את הסקריפט…", Hani, 2026-11-07).
 *
 * After "שכפל!" every format gets ONE card in a row. The card no longer holds
 * the whole script: it shows a loader while the script is written, then the
 * start of the script with an ellipsis, then the media itself once it exists
 * (a carousel / story gets ‹ › between slides). Clicking a card opens the left
 * panel, which now holds the script and the way to media.
 *
 *   A — "החלון": the card IS the post's media window, in the format's own
 *       shape (story 9:16, carousel 4:5). The script fills the empty window
 *       until media replaces it in place. Panel: two screens (script → create).
 *   B — "הכרטיס": every card is the same size, with the canvas's usual header
 *       bar and a status line, like a step in a workflow. Panel: one scroll —
 *       "צור מדיה" opens the ways to make media under the script.
 *
 * UI only: generation, media flows and approvals are the page's own.
 */

import { useState, type ReactNode } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { IconActionButton } from "@/components/icon-action-button"
import { MediaPreviewZone } from "@/components/media-preview-zone"
import { LaneStem, TreeConnector } from "@/components/format-lanes"
import { ApprovalCardFooter } from "@/components/format-approval/approval-card-footer"
import {
  ApprovalHeaderTag,
  ApprovalStatusPill,
  ApprovedTag,
  FORMAT_NOUN,
  approvalHeaderFill,
} from "@/components/format-approval/approval-visuals"
import type { ApprovalStatus } from "@/components/format-approval/use-format-approvals"
import { storyFrameSrc } from "@/components/story-player"
import { stripFrameMarkers } from "@/lib/story-text-split"
import { cn } from "@/lib/utils"

/** c = Hani's pick (2026-11-07): B's uniform cards + A's two-screen panel. */
export type FormatCardsVariant = "a" | "b" | "c"

/** Read `?cards=` — anything but a / b is the production canvas. */
export function parseCardsVariant(v: string | null): FormatCardsVariant | null {
  return v === "a" || v === "b" || v === "c" ? v : null
}

export type FormatCardMedia =
  /** Carousel slides or story frames — paged with ‹ ›. */
  | { kind: "slides"; items: string[] }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }

/** What a card shows. Media wins over script; the loaders win over both. */
export type FormatCardState = "generating" | "script" | "media-busy" | "media"

export type FormatCardItem = {
  fid: string
  label: string
  icon: LucideIcon
  script: string
  state: FormatCardState
  media?: FormatCardMedia | null
  approval?: ApprovalStatus
}

/** The format's real shape — the window in variant A, the panel preview in both. */
const MEDIA_ASPECT: Record<string, string> = {
  carousel: "aspect-[4/5]",
  image_post: "aspect-[4/5]",
  story: "aspect-[9/16]",
  b_roll: "aspect-[9/16]",
  talking_head: "aspect-[9/16]",
}
/** How many lines of script fit the empty window before the ellipsis. */
const WINDOW_LINES: Record<string, number> = {
  carousel: 11,
  image_post: 11,
  story: 17,
  b_roll: 17,
  talking_head: 17,
}

function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)
}

/** The script as plain reading text: no story frame marks, no bold marks. */
export function scriptExcerpt(fid: string, text: string): string {
  // Frame / slide marks ("סטורי 2:", "[שקופית 3]") belong to the panel's
  // editor, not to a glance at the card.
  void fid
  return stripFrameMarkers(text).replace(/\*\*/g, "").trim()
}

/** Clamp to `lines`, ending in "…" — the card shows only the start. */
function Clamp({ lines, className, children }: { lines: number; className?: string; children: ReactNode }) {
  return (
    <p
      className={cn("whitespace-pre-line text-small leading-relaxed text-text-primary-default", className)}
      style={{ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
    >
      {children}
    </p>
  )
}

/** The "מייצר סקריפט" / "יוצר מדיה" loader inside a card. */
function CardLoader({ label }: { label: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2" role="status">
      <Loader2 className="size-5 animate-spin text-text-neutral-default" aria-hidden />
      <span className="text-small text-text-neutral-default">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Media preview — shared by the cards and the panel                 */
/* ------------------------------------------------------------------ */

/**
 * The media itself. Slides page with ‹ ›; `fill` makes it cover its box (the
 * window), otherwise it keeps the media's natural shape.
 */
export function FormatMediaPreview({
  media,
  fid,
  fill = false,
  navOverlay = false,
  box,
}: {
  media: FormatCardMedia
  fid: string
  fill?: boolean
  /** A fixed media box (uniform card) — the media fits inside it whole. */
  box?: string
  /** ‹ › floats on the media (window) instead of sitting under it. */
  navOverlay?: boolean
}) {
  const [i, setI] = useState(0)
  const items = media.kind === "slides" ? media.items : [media.url]
  const index = Math.min(i, items.length - 1)
  const src = items[index] ?? ""
  const mediaClass = fill
    ? "size-full object-cover"
    : box
      ? "size-full object-contain"
      : `w-full ${MEDIA_ASPECT[fid] ?? "aspect-[4/5]"} object-cover`

  const nav =
    media.kind === "slides" && items.length > 1 ? (
      <div
        className={cn(
          "flex items-center justify-center gap-3",
          navOverlay &&
            "absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-white/90 px-1 shadow-sm dark:bg-gray-10/90",
        )}
        data-media-control=""
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* RTL: the right chevron goes back, the left one forward. */}
        <button
          type="button"
          aria-label="השקופית הקודמת"
          disabled={index === 0}
          onClick={() => setI(Math.max(0, index - 1))}
          className="flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-gray-95 disabled:opacity-30 dark:hover:bg-gray-20 cursor-pointer disabled:cursor-default"
        >
          <ChevronRight className="size-4 text-text-primary-default" aria-hidden />
        </button>
        <span dir="ltr" className="text-xs tabular-nums text-text-neutral-default" aria-live="polite">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          aria-label="השקופית הבאה"
          disabled={index === items.length - 1}
          onClick={() => setI(Math.min(items.length - 1, index + 1))}
          className="flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-gray-95 disabled:opacity-30 dark:hover:bg-gray-20 cursor-pointer disabled:cursor-default"
        >
          <ChevronLeft className="size-4 text-text-primary-default" aria-hidden />
        </button>
      </div>
    ) : null

  return (
    <div className={cn("flex flex-col gap-2", fill && "relative size-full")}>
      <div className={cn("overflow-hidden rounded-xl bg-gray-95 dark:bg-gray-20", fill && "size-full rounded-none", box)}>
        {isVideo(src) ? (
          <video
            key={src}
            src={`${src}#t=0.001`}
            muted
            playsInline
            preload="metadata"
            className={mediaClass}
            aria-label={`${FORMAT_NOUN[fid] ?? "המדיה"}, וידאו`}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src.startsWith("/") ? src : storyFrameSrc(src)}
            alt={media.kind === "slides" ? `שקופית ${index + 1}` : ""}
            className={mediaClass}
            draggable={false}
          />
        )}
      </div>
      {nav}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  The row on the canvas                                             */
/* ------------------------------------------------------------------ */

export function FormatCardsRow({
  variant,
  items,
  selected,
  onSelect,
}: {
  variant: FormatCardsVariant
  items: FormatCardItem[]
  selected: string | null
  onSelect: (fid: string) => void
}) {
  const Card = variant === "a" ? WindowCard : UniformCard
  return (
    <div className="flex items-start" dir="rtl" data-format-cards={variant}>
      <LaneStem />
      {items.map((item, i) => (
        <div key={item.fid} className="flex items-start" data-format-card={item.fid}>
          {i > 0 && <TreeConnector />}
          <Card item={item} selected={selected === item.fid} onSelect={() => onSelect(item.fid)} />
        </div>
      ))}
    </div>
  )
}

/** Whole-card click target — the canvas pans on mousedown, so keep it a click. */
function cardButtonProps(label: string, onSelect: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: onSelect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onSelect()
      }
    },
  }
}

/**
 * A — the media window. Label above (as in the sketch), the window below in
 * the format's own shape; whatever the format holds right now fills it.
 */
function WindowCard({ item, selected, onSelect }: { item: FormatCardItem; selected: boolean; onSelect: () => void }) {
  const Icon = item.icon
  const aspect = MEDIA_ASPECT[item.fid] ?? "aspect-[4/5]"
  return (
    <div className="flex w-[220px] flex-col gap-2" dir="rtl">
      <div className="flex h-6 items-center gap-1.5 px-1">
        <Icon className="size-4 text-text-neutral-default" aria-hidden />
        <span className="text-p-bold text-text-primary-default">{item.label}</span>
        <span className="ms-auto">
          <ApprovalStatusPill status={item.approval} />
        </span>
      </div>
      <div
        {...cardButtonProps(`${item.label} — פתיחה בפאנל`, onSelect)}
        className={cn(
          "relative w-full overflow-hidden rounded-[20px] border bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 dark:bg-gray-10",
          aspect,
          selected
            ? "border-yellow-50 ring-2 ring-yellow-50"
            : "border-border-neutral-default hover:border-gray-80",
        )}
      >
        {item.state === "generating" && <CardLoader label="מייצר סקריפט" />}
        {item.state === "script" && (
          <div className="size-full p-4">
            <Clamp lines={WINDOW_LINES[item.fid] ?? 11}>{scriptExcerpt(item.fid, item.script)}</Clamp>
          </div>
        )}
        {item.state === "media-busy" && (
          <div className="relative size-full">
            <Skeleton className="absolute inset-0 rounded-none" />
            <div className="relative size-full">
              <CardLoader label="יוצר מדיה" />
            </div>
          </div>
        )}
        {item.state === "media" && item.media && (
          <FormatMediaPreview media={item.media} fid={item.fid} fill navOverlay />
        )}
      </div>
    </div>
  )
}

/**
 * B — one size for every format, the canvas's usual card chrome (header bar),
 * and a status line at the bottom: a step in the workflow, not the post.
 */
function UniformCard({ item, selected, onSelect }: { item: FormatCardItem; selected: boolean; onSelect: () => void }) {
  const Icon = item.icon
  const hasMedia = item.state === "media" && !!item.media
  const status =
    item.state === "generating"
      ? "הסקריפט נכתב…"
      : item.state === "script"
        ? "סקריפט מוכן · עוד אין מדיה"
        : item.state === "media-busy"
          ? "המדיה בהכנה…"
          : item.approval === "approved" || item.approval === "scheduled"
            ? null
            : "מחכה לאישור לתזמון"
  return (
    <div
      {...cardButtonProps(`${item.label} — פתיחה בפאנל`, onSelect)}
      dir="rtl"
      className={cn(
        "flex w-[280px] flex-col overflow-hidden rounded-[20px] border bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 dark:bg-gray-10",
        selected
          ? "border-yellow-50 ring-2 ring-yellow-50"
          : "border-border-neutral-default hover:border-gray-80",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-5 py-3",
          hasMedia ? approvalHeaderFill(item.approval) : "bg-bg-surface",
        )}
      >
        <span className="text-p-bold text-text-primary-default">{item.label}</span>
        <Icon className="size-4 text-text-neutral-default" aria-hidden />
        {hasMedia && <ApprovalHeaderTag status={item.approval} />}
      </div>
      <div className="h-[300px] overflow-hidden px-5 pt-4">
        {item.state === "generating" && <CardLoader label="מייצר סקריפט" />}
        {item.state === "script" && (
          // 9 lines leave room above the status line at any text size (Hani, 2026-11-07).
          <Clamp lines={9}>{scriptExcerpt(item.fid, item.script)}</Clamp>
        )}
        {item.state === "media-busy" && (
          <div className="flex h-full flex-col items-center gap-3">
            <Skeleton className="h-[240px] w-[180px] rounded-xl" />
            <span className="text-small text-text-neutral-default" role="status">יוצר מדיה</span>
          </div>
        )}
        {hasMedia && item.media && (
          <FormatMediaPreview media={item.media} fid={item.fid} box="h-[240px] w-full" />
        )}
      </div>
      <div className="flex min-h-11 items-center px-5 py-3">
        {status && <span className="text-xs text-text-neutral-default">{status}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  The left panel — script, media, footer                            */
/* ------------------------------------------------------------------ */

export type FormatPanelTab = "script" | "media" | "schedule"

const PANEL_TABS: { id: FormatPanelTab; label: string }[] = [
  { id: "script", label: "סקריפט" },
  { id: "media", label: "מדיה" },
  { id: "schedule", label: "תזמון" },
]

/**
 * The panel's three steps as shadcn tabs (Hani, 2026-11-07): סקריפט, מדיה,
 * תזמון. Each tab holds only its own part, and she can move between them
 * freely. A segmented control with soft square corners, not a pill.
 */
export function FormatPanelTabs({
  value,
  onChange,
  showSchedule = true,
  done = {},
}: {
  value: FormatPanelTab
  onChange: (tab: FormatPanelTab) => void
  /** Steps already done get a ✓, so the tabs read as progress (Hani, 2026-11-07). */
  done?: Partial<Record<FormatPanelTab, boolean>>
  /** False for accounts without scheduling — then there is no תזמון tab. */
  showSchedule?: boolean
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as FormatPanelTab)} dir="rtl">
      <TabsList className="h-9 w-full rounded-[10px] bg-gray-95 p-1 dark:bg-gray-20">
        {PANEL_TABS.filter((t) => showSchedule || t.id !== "schedule").map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className="group/tab h-7 gap-1.5 rounded-[10px] px-2 py-1 text-sm font-medium leading-5 text-gray-40 hover:text-text-primary-default data-[state=active]:bg-white data-[state=active]:text-text-primary-default data-[state=active]:shadow-sm dark:data-[state=active]:bg-gray-10 cursor-pointer"
          >
            {t.label}
            {/* Done step (Figma 701:1673): green on the active tab, gray on the others. */}
            {done[t.id] && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/tab-done-active.svg" alt="הושלם" width={20} height={20} className="hidden size-5 shrink-0 group-data-[state=active]/tab:block" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/tab-done.svg" alt="הושלם" width={20} height={20} className="size-5 shrink-0 group-data-[state=active]/tab:hidden" />
              </>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

/**
 * The tab's footer: "השלב הבא: <next tab>" (Hani, 2026-11-07), with the
 * script's delete beside it when it is offered.
 */
export function FormatPanelNextStep({
  label,
  onNext,
  onDelete,
}: {
  /** The next tab's name — "מדיה", "תזמון". */
  label: string
  onNext: () => void
  /** Present = "מחיקת הסקריפט" beside it (plain script, no media). */
  onDelete?: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <Button onClick={onNext} className="flex-1 gap-2">
        השלב הבא: {label}
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      {onDelete && (
        <IconActionButton label="מחיקת הסקריפט" icon={Trash2} destructive onClick={onDelete} />
      )}
    </div>
  )
}

/**
 * The media as it is now (or a skeleton while it is made). Hovering it shows
 * the AI sparkle and the delete; a click on it opens the ways to replace it.
 */
export function FormatPanelMedia({
  fid,
  media,
  mediaBusy = false,
  onOpenMedia,
  onAiEditMedia,
  onDeleteMedia,
}: {
  fid: string
  media?: FormatCardMedia | null
  mediaBusy?: boolean
  onOpenMedia: () => void
  onAiEditMedia?: () => void
  onDeleteMedia: () => void
}) {
  if (mediaBusy || !media) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Skeleton className={cn("w-full rounded-xl", MEDIA_ASPECT[fid])} />
        <span className="text-small text-text-neutral-default" role="status">יוצר מדיה</span>
      </div>
    )
  }
  return (
    <MediaPreviewZone
      onOpen={onOpenMedia}
      openLabel={`החלפת ${FORMAT_NOUN[fid] ?? "המדיה"}`}
      onAiEdit={onAiEditMedia}
      aiClassName={media.kind === "slides" && media.items.length > 1 ? "bottom-11" : undefined}
      onDelete={onDeleteMedia}
      className="w-full"
    >
      <FormatMediaPreview media={media} fid={fid} />
    </MediaPreviewZone>
  )
}

/**
 * The תזמון tab's picture (Hani, 2026-11-07): the calendar, 7 columns in the
 * design system's grays, and its side panel on the left where the approved
 * post waits, green and marked "מאושר", until it is scheduled. Decorative.
 */
function ScheduleIllustration() {
  return (
    <div
      aria-hidden
      className="flex h-[220px] w-full overflow-hidden rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10"
    >
      {/* The month: weekday row + 5 weeks × 7 days. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="mx-auto h-1.5 w-3/5 rounded-full bg-gray-90" />
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7 grid-rows-5 gap-1">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="flex flex-col justify-end rounded-[4px] bg-gray-95 p-0.5 dark:bg-gray-20">
              {[3, 9, 12, 20, 26, 31].includes(i) && <div className="h-1.5 rounded-full bg-gray-80" />}
            </div>
          ))}
        </div>
      </div>
      {/* Side panel — last child sits on the left in RTL (Hani, 2026-11-07). */}
      <div className="flex w-[34%] shrink-0 flex-col gap-2 border-s border-border-neutral-default bg-gray-98 p-2 dark:bg-gray-20">
        <div className="h-2 w-3/5 rounded-full bg-gray-90" />
        <div className="flex flex-col gap-1.5 rounded-lg border border-green-success-50 bg-green-success-97 p-1.5">
          <div className="h-10 rounded-md bg-green-success-70/40" />
          <ApprovedTag className="h-5 self-start px-1.5 text-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5 rounded-lg border border-border-neutral-default bg-white p-1.5 dark:bg-gray-10">
          <div className="h-6 rounded-md bg-gray-95" />
          <div className="h-1.5 w-1/2 rounded-full bg-gray-90" />
        </div>
      </div>
    </div>
  )
}

/**
 * The תזמון tab's body. No media yet: nothing to schedule, with a way to the
 * media tab. Media: the calendar picture; the approval itself is the footer
 * (FormatPanelScheduleFooter), pinned like "השלב הבא" on the other tabs.
 */
export function FormatPanelSchedule({
  fid,
  hasMedia,
  onGoToMedia,
}: {
  fid: string
  hasMedia: boolean
  onGoToMedia: () => void
}) {
  if (!hasMedia) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-small text-text-neutral-default">
          כדי לתזמן את {FORMAT_NOUN[fid] ?? "הפורמט"} צריך קודם מדיה.
        </p>
        <Button variant="outline" onClick={onGoToMedia}>
          ליצירת מדיה
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <ScheduleIllustration />
      <p className="text-small text-text-neutral-default">
        אחרי האישור, הפוסט מחכה בפאנל הצד של לוח התזמון עד שמתזמנים אותו.
      </p>
    </div>
  )
}

/** The תזמון tab's footer: "אישור הפוסט לתזמון", then the way to the calendar. */
export function FormatPanelScheduleFooter({
  fid,
  approval,
}: {
  fid: string
  approval: {
    status: ApprovalStatus
    onApprove: () => void
    onRevoke: () => void
    calendarHref?: string
  }
}) {
  return (
    <ApprovalCardFooter
      status={approval.status}
      formatNoun={FORMAT_NOUN[fid] ?? "הפורמט"}
      onApprove={approval.onApprove}
      onRevoke={approval.onRevoke}
      calendarHref={approval.calendarHref}
      approveLabel="אישור הפוסט לתזמון"
    />
  )
}

/**
 * The panel's script screen: the full, editable script (the page passes its
 * own editor — RichBodyEditor / StorySections with "עריכה עם AI"), and under
 * it the media as it is now, when there is media.
 */
export function FormatPanelScript({
  fid,
  editor,
  media,
  mediaBusy = false,
  onOpenMedia,
  onAiEditMedia,
  onDeleteMedia,
  saveStatus,
}: {
  fid: string
  editor: ReactNode
  /** The script's autosave, as the old canvas card showed it (Hani, 2026-11-07). */
  saveStatus?: "saving" | "saved" | "error"
  media?: FormatCardMedia | null
  mediaBusy?: boolean
  /** Click on the media — to the ways to replace it. */
  onOpenMedia: () => void
  /** Absent = no AI edit for this format (a talking head). */
  onAiEditMedia?: () => void
  onDeleteMedia: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label="סקריפט">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-small-bold text-text-neutral-default">סקריפט</h3>
          {saveStatus && (
            <span className="flex items-center gap-1 text-xs text-text-neutral-default" role="status">
              {saveStatus === "saving" ? (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  שומר...
                </>
              ) : saveStatus === "error" ? (
                <span className="text-button-destructive-default">שגיאה בשמירה</span>
              ) : (
                <>
                  <Check className="size-3" aria-hidden />
                  נשמר
                </>
              )}
            </span>
          )}
        </div>
        {editor}
      </section>

      {(media || mediaBusy) && (
        <section className="flex flex-col gap-2" aria-label="מדיה">
          <h3 className="text-small-bold text-text-neutral-default">מדיה</h3>
          {mediaBusy || !media ? (
            <div className="flex flex-col items-center gap-2">
              <Skeleton className={cn("w-full rounded-xl", MEDIA_ASPECT[fid])} />
              <span className="text-small text-text-neutral-default" role="status">יוצר מדיה</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <MediaPreviewZone
                onOpen={onOpenMedia}
                openLabel={`החלפת ${FORMAT_NOUN[fid] ?? "המדיה"}`}
                onAiEdit={onAiEditMedia}
                aiClassName={media.kind === "slides" && media.items.length > 1 ? "bottom-11" : undefined}
                onDelete={onDeleteMedia}
                className="w-full"
              >
                <FormatMediaPreview media={media} fid={fid} />
              </MediaPreviewZone>
              {/* AI edit and delete live only on the media, shown on hover (Hani, 2026-11-07). */}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * Variant B's script once "צור מדיה" is pressed: folded to its first lines so
 * the ways to make media sit right under it. Clicking it is "חזרה לסקריפט".
 */
export function FormatPanelScriptFolded({
  fid,
  script,
  onUnfold,
}: {
  fid: string
  script: string
  onUnfold: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-small-bold text-text-neutral-default">סקריפט</h3>
      <button
        type="button"
        onClick={onUnfold}
        className="flex flex-col gap-2 rounded-[10px] border border-border-neutral-default bg-white px-3 py-2 text-start transition-colors hover:bg-gray-95 dark:bg-gray-10 dark:hover:bg-gray-20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
      >
        <Clamp lines={3}>{scriptExcerpt(fid, script)}</Clamp>
        <span className="flex items-center gap-1 text-xs text-text-neutral-default">
          <ChevronRight className="size-3.5" aria-hidden />
          חזרה לסקריפט
        </span>
      </button>
      <div className="mt-4 flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-border-neutral-default" />
        <span className="text-small-bold text-text-primary-default">יצירת מדיה</span>
        <span className="h-px flex-1 bg-border-neutral-default" />
      </div>
    </div>
  )
}

/**
 * The panel's footer. No media: "צור מדיה" + "מחיקת הסקריפט", which removes
 * the whole format. Media: only the existing approval row ("אישור הפוסט
 * לתזמון", moved here from the canvas card). There is no format delete while
 * media exists; the media is deleted on its own first (Hani, 2026-11-07).
 */
export function FormatPanelFooter({
  fid,
  hasMedia,
  approval,
  onCreateMedia,
  onDelete,
  createDisabled = false,
}: {
  fid: string
  hasMedia: boolean
  approval?: {
    status: ApprovalStatus
    onApprove: () => void
    onRevoke: () => void
    calendarHref?: string
  }
  onCreateMedia: () => void
  /** Deletes the script, which removes the whole format. Only offered without media. */
  onDelete: () => void
  createDisabled?: boolean
}) {
  const del = (
    <IconActionButton label="מחיקת הסקריפט" icon={Trash2} destructive onClick={onDelete} />
  )
  if (hasMedia && approval) {
    return (
      <ApprovalCardFooter
        status={approval.status}
        formatNoun={FORMAT_NOUN[fid] ?? "הפורמט"}
        onApprove={approval.onApprove}
        onRevoke={approval.onRevoke}
        calendarHref={approval.calendarHref}
        approveLabel="אישור הפוסט לתזמון"
      />
    )
  }
  if (hasMedia) return null
  return (
    <div className="flex items-center gap-3">
      <Button onClick={onCreateMedia} disabled={createDisabled} className="flex-1 gap-2">
        <Plus className="size-4" aria-hidden />
        צור מדיה
      </Button>
      {del}
    </div>
  )
}
