"use client"

/**
 * Format preview — the pieces both variants share.
 *
 * Clicking a format on the calendar opens a view of exactly what will go out:
 * the media as Instagram will show it, the caption that will be sent, every
 * carousel slide in order, the date and time, and the publish status. Two
 * layouts compete for how that view lives next to the board (see
 * `format-preview-dialog.tsx` and `format-preview-inspector.tsx`); everything
 * below is identical between them, so a reviewer compares placement and
 * interaction model, not two copies of the same widgets drifting apart.
 *
 * What is NOT here, on purpose: first comment, location, collaborators, alt
 * text. The publish path (`src/lib/social/types.ts` → `SchedulePostInput`,
 * and `highlevel.ts` → `buildPostBody`) sends caption, media, type, reel cover
 * and time — nothing else. A field that isn't sent isn't shown (brief, 16.10).
 */

import { useState } from "react"
import {
  AlertCircle,
  Bookmark,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  ImageOff,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Play,
  Send,
  Unplug,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { destinationForFormat, MAX_CAPTION_CHARS } from "@/lib/social/media-spec"
import type { FormatId } from "@/lib/timing-storage"

// --- data --------------------------------------------------------------------

/**
 * Publish status, as the board shows it.
 *
 * Maps onto `scheduled_posts.publish_status` (migration 033) plus the account
 * state, which Ben is wiring in the parallel task:
 *   no connected account        → not_connected
 *   idle, handed to the provider → pending   (no provider id yet)
 *   queued                       → scheduled (ONLY with a provider id)
 *   failed                       → failed + publish_error
 *   published                    → published (+ permalink when known)
 * The rule from that task holds here too: never "scheduled" without an id.
 */
export type PublishStatus =
  /** Opened from the "ready to schedule" rail — not on the board yet. */
  | { kind: "unscheduled" }
  | { kind: "not_connected" }
  | { kind: "pending" }
  | { kind: "scheduled" }
  | {
      kind: "failed"
      /** Hebrew, actionable — `publish_error` as written by the bridge. */
      reason: string
      action: "reconnect" | "retry" | "fix_media"
    }
  | { kind: "published"; permalink?: string }
  /** The time passed but no "published" signal yet — Ben's "יצא לפרסום". */
  | { kind: "sent" }

export type PreviewSlide = { url: string; type: "image" | "video" }

export type FormatPreviewData = {
  corePostId: string
  format: FormatId
  hook: string
  /** The format's own body, in full — what `assemble.ts` sends as the caption. */
  caption: string
  /** Every content asset in slide order (carousel), or the single image/video. */
  slides: PreviewSlide[]
  /** Reel cover — attached as the reel's thumbnail. */
  coverUrl?: string
  /** The connected account's handle, for the Instagram frame. */
  handle: string
  scheduledDate: string
  scheduledTime: string
  publish: PublishStatus
  /** The slot's time has passed — the preview is read-only. */
  isPast?: boolean
}

export type PreviewContentState = "ready" | "loading" | "no-media"

/** `/project` is where media is edited; the preview only links there. */
export function canvasHref(d: Pick<FormatPreviewData, "corePostId" | "format">) {
  return `/project?post_id=${d.corePostId}&format=${d.format}`
}

// --- formatting --------------------------------------------------------------

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** "יום שלישי, 21 באוקטובר · 09:00" */
export function formatSlot(date: string, time: string): string {
  const day = parseDateKey(date).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return `${day} · ${time}`
}

/** "21.10 ב-09:00" — short form for status lines. */
function formatSlotShort(date: string, time: string): string {
  const d = parseDateKey(date)
  return `${d.getDate()}.${d.getMonth() + 1} ב-${time}`
}

// --- publish status ------------------------------------------------------------

const FAILED_ACTION_LABEL: Record<"reconnect" | "retry" | "fix_media", string> = {
  reconnect: "חיבור מחדש",
  retry: "ניסיון חוזר",
  fix_media: "עריכה בקנבס",
}

/**
 * The one place the publish status is drawn. Neutral for "nothing will happen
 * on its own yet", green for "Instagram has it", red for "it won't go out".
 * Colour never carries the message alone — every state has an icon and words.
 */
export function PublishStatusSlot({
  status,
  date,
  time,
  onAction,
}: {
  status: PublishStatus
  date: string
  time: string
  /** Fired by the status's own action (connect / retry / open canvas). */
  onAction: (action: "connect" | "reconnect" | "retry" | "fix_media" | "open_post") => void
}) {
  const tone =
    status.kind === "failed"
      ? "border-red-80 bg-red-95 dark:bg-red-95/10"
      : status.kind === "scheduled" || status.kind === "published"
        ? "border-green-90 bg-green-95 dark:bg-green-95/10"
        : "border-border-neutral-default bg-bg-surface"

  let icon: React.ReactNode
  let title: string
  let body: string | null = null
  let action: { label: string; id: Parameters<typeof onAction>[0]; external?: boolean } | null = null

  switch (status.kind) {
    case "unscheduled":
      icon = <CalendarPlus className="size-4 text-text-neutral-default" aria-hidden />
      title = "עוד לא על הלוח"
      body = "בחרו תאריך ושעה ולחצו ״תזמון פוסט״."
      break
    case "not_connected":
      icon = <Unplug className="size-4 text-text-neutral-default" aria-hidden />
      title = "לא יפורסם — אינסטגרם לא מחובר"
      body = "הפוסט נשאר על הלוח כתכנון. כדי שיעלה לבד, חברו את חשבון האינסטגרם."
      action = { label: "חיבור אינסטגרם", id: "connect" }
      break
    case "pending":
      icon = <Loader2 className="size-4 animate-spin text-text-neutral-default" aria-hidden />
      title = "בתהליך — נשלח לאינסטגרם"
      body = "עד שאינסטגרם מאשרת את התזמון, הפוסט לא מסומן כמתוזמן."
      break
    case "scheduled":
      icon = <CalendarCheck className="size-4 text-green-50" aria-hidden />
      title = `תוזמן · יעלה ב-${formatSlotShort(date, time)}`
      break
    case "failed":
      icon = <AlertCircle className="size-4 text-red-50" aria-hidden />
      title = "לא תוזמן"
      body = status.reason
      action = { label: FAILED_ACTION_LABEL[status.action], id: status.action }
      break
    case "sent":
      icon = <CalendarCheck className="size-4 text-text-neutral-default" aria-hidden />
      title = `יצא לפרסום · ${formatSlotShort(date, time)}`
      body = "עוד לא קיבלנו מאינסטגרם אישור שהפוסט עלה."
      break
    case "published":
      icon = <CheckCircle2 className="size-4 text-green-50" aria-hidden />
      title = `פורסם · ${formatSlotShort(date, time)}`
      if (status.permalink) action = { label: "צפייה באינסטגרם", id: "open_post", external: true }
      break
  }

  return (
    <div
      role={status.kind === "failed" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${tone}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-small-bold text-text-primary-default">{title}</span>
        {body && <span className="text-xs-body text-text-neutral-default">{body}</span>}
      </div>
      {action && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 bg-white dark:bg-gray-10"
          onClick={() => onAction(action.id)}
        >
          {action.label}
          {action.external && <ExternalLink className="size-3.5" aria-hidden />}
        </Button>
      )}
    </div>
  )
}

// --- media -------------------------------------------------------------------

/** Aspect of the media box, from where the format lands on Instagram. */
function aspectFor(format: FormatId): string {
  return destinationForFormat(format) === "post" ? "aspect-[4/5]" : "aspect-[9/16]"
}

/**
 * The media itself, paged when there is more than one slide.
 *
 * RTL: Hebrew Instagram pages right-to-left, so "next" sits on the visual left
 * (`end-*`) and points left. Arrow keys follow the same direction.
 */
export function FormatMedia({
  data,
  content,
  index,
  onIndexChange,
  rounded = "rounded-none",
  overlay,
}: {
  data: FormatPreviewData
  content: PreviewContentState
  index: number
  onIndexChange: (i: number) => void
  rounded?: string
  /** Extra layer drawn over the media (the reel/story chrome in variant A). */
  overlay?: React.ReactNode
}) {
  const aspect = aspectFor(data.format)
  const kind = destinationForFormat(data.format)

  if (content === "loading") {
    return <Skeleton className={`w-full ${aspect} ${rounded}`} />
  }
  if (content === "no-media" || data.slides.length === 0) {
    return (
      <div
        className={`flex w-full ${aspect} ${rounded} flex-col items-center justify-center gap-2 border border-dashed border-gray-80 bg-bg-surface p-6 text-center`}
      >
        <ImageOff className="size-6 text-text-neutral-default" aria-hidden />
        <span className="text-small text-text-primary-default">אין עדיין מדיה לפורמט הזה</span>
        <span className="text-xs-body text-text-neutral-default">
          אפשר ליצור או להעלות אותה בקנבס. בלי מדיה הפוסט לא יכול לעלות.
        </span>
      </div>
    )
  }

  const total = data.slides.length
  const slide = data.slides[Math.min(index, total - 1)]
  const go = (delta: number) => onIndexChange(Math.max(0, Math.min(total - 1, index + delta)))

  // Reel: the video when we have one, else its cover with a play mark — the
  // cover is what the grid will show, so it is a faithful preview either way.
  const isReel = kind === "reel"
  const showVideo = slide.type === "video"
  const still = isReel && !showVideo ? data.coverUrl ?? slide.url : slide.url

  return (
    <div
      className={`group/media relative w-full ${aspect} ${rounded} overflow-hidden bg-gray-10`}
      tabIndex={total > 1 ? 0 : undefined}
      onKeyDown={(e) => {
        if (total < 2) return
        if (e.key === "ArrowLeft") go(1)
        if (e.key === "ArrowRight") go(-1)
      }}
      aria-roledescription={total > 1 ? "קרוסלה" : undefined}
      aria-label={total > 1 ? `שקופית ${index + 1} מתוך ${total}` : undefined}
    >
      {showVideo ? (
        <video
          key={slide.url}
          src={slide.url}
          poster={data.coverUrl}
          controls
          playsInline
          className="size-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={still} alt="" className="size-full object-cover" draggable={false} />
      )}

      {isReel && !showVideo && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white">
            <Play className="size-5 fill-current" aria-hidden />
          </span>
        </span>
      )}

      {overlay}

      {total > 1 && (
        <>
          <span className="absolute top-2 end-2 rounded-full bg-black/60 px-2 py-0.5 text-xs-body text-white tabular-nums">
            {index + 1}/{total}
          </span>
          {index > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="שקופית קודמת"
              className="absolute top-1/2 start-2 -translate-y-1/2 flex size-7 items-center justify-center rounded-full bg-white/90 text-text-primary-default shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              <ChevronRight className="size-4" />
            </button>
          )}
          {index < total - 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="שקופית הבאה"
              className="absolute top-1/2 end-2 -translate-y-1/2 flex size-7 items-center justify-center rounded-full bg-white/90 text-text-primary-default shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Carousel dots, Instagram-style. */
export function SlideDots({ total, index }: { total: number; index: number }) {
  if (total < 2) return null
  return (
    <div className="flex items-center justify-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full ${i === index ? "bg-yellow-50" : "bg-gray-80"}`}
        />
      ))}
    </div>
  )
}

/**
 * Every slide, in the order it will be published, numbered. Clicking one
 * shows it. This is the "all slides, in order" requirement made scannable.
 */
export function SlideStrip({
  slides,
  index,
  onIndexChange,
  size = "sm",
}: {
  slides: PreviewSlide[]
  index: number
  onIndexChange: (i: number) => void
  size?: "sm" | "md"
}) {
  if (slides.length < 2) return null
  const box = size === "md" ? "w-16" : "w-12"
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-subtle" role="tablist" aria-label="סדר השקופיות">
      {slides.map((s, i) => (
        <button
          key={`${s.url}-${i}`}
          type="button"
          role="tab"
          aria-selected={i === index}
          aria-label={`שקופית ${i + 1}`}
          onClick={() => onIndexChange(i)}
          className={`relative ${box} aspect-[4/5] shrink-0 overflow-hidden rounded-md border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
            i === index ? "border-yellow-50" : "border-transparent hover:border-gray-80"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.url} alt="" className="size-full object-cover" draggable={false} />
          <span className="absolute bottom-0.5 start-0.5 rounded bg-black/60 px-1 text-[10px] leading-4 text-white tabular-nums">
            {i + 1}
          </span>
        </button>
      ))}
    </div>
  )
}

/** The like / comment / share / save row — Instagram's icons, inert. */
export function InstagramActionRow() {
  return (
    <div className="flex items-center gap-3 text-text-primary-default" aria-hidden>
      <Heart className="size-5" />
      <MessageCircle className="size-5" />
      <Send className="size-5" />
      <Bookmark className="ms-auto size-5" />
    </div>
  )
}

/** Avatar + handle. Handles are Latin, so they're isolated LTR inside RTL. */
export function InstagramHandle({ handle, light = false }: { handle: string; light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex size-7 items-center justify-center rounded-full text-xs-body font-medium ${
          light ? "bg-white/90 text-text-primary-default" : "bg-yellow-90 text-text-primary-default"
        }`}
        aria-hidden
      >
        {handle.slice(0, 1).toUpperCase()}
      </span>
      <bdi
        dir="ltr"
        className={`text-small-bold ${light ? "text-white" : "text-text-primary-default"}`}
      >
        {handle}
      </bdi>
      <MoreHorizontal
        className={`ms-auto size-4 ${light ? "text-white" : "text-text-neutral-default"}`}
        aria-hidden
      />
    </div>
  )
}

// --- caption -----------------------------------------------------------------

/**
 * The caption that will be sent. Stories have none — Instagram accepts no text
 * on a story through any API, so the text is already baked into the frame.
 */
export function StoryCaptionNote() {
  return (
    <p className="rounded-lg bg-bg-surface px-3 py-2 text-xs-body text-text-neutral-default">
      לסטורי אין כיתוב. אינסטגרם לא מקבלת טקסט לסטורי, ולכן הטקסט כבר צרוב בתמונה.
    </p>
  )
}

export function CaptionCounter({ length }: { length: number }) {
  const over = length > MAX_CAPTION_CHARS
  return (
    <span
      className={`text-xs-body tabular-nums ${over ? "text-red-50" : "text-text-neutral-default"}`}
      dir="ltr"
    >
      {length.toLocaleString("he-IL")} / {MAX_CAPTION_CHARS.toLocaleString("he-IL")}
    </span>
  )
}

export function CaptionTooLong({ length }: { length: number }) {
  if (length <= MAX_CAPTION_CHARS) return null
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs-body text-text-primary-default">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-50" aria-hidden />
      הכיתוב ארוך ב-{(length - MAX_CAPTION_CHARS).toLocaleString("he-IL")} תווים ממה שאינסטגרם
      מקבלת. כדאי לקצר לפני מועד הפרסום, אחרת הפוסט לא יעלה.
    </p>
  )
}

/**
 * Caption editor. Saving writes to the FORMAT's body — the same text the
 * canvas shows — not to a copy on the scheduled slot, so the two can never
 * disagree about what goes out (brief, 16.10).
 */
export function CaptionEditor({
  value,
  onSave,
  onCancel,
  autoFocus,
}: {
  value: string
  onSave: (next: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const dirty = draft !== value
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus={autoFocus}
        rows={8}
        dir="rtl"
        aria-label="כיתוב הפוסט"
        className="min-h-40 text-small leading-relaxed"
      />
      <div className="flex items-center gap-2">
        <CaptionCounter length={draft.length} />
        <span className="flex-1 text-xs-body text-text-neutral-default">
          נשמר על הפורמט עצמו, גם בקנבס.
        </span>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            ביטול
          </Button>
        )}
        <Button size="sm" disabled={!dirty} onClick={() => onSave(draft)}>
          שמירה
        </Button>
      </div>
      <CaptionTooLong length={draft.length} />
    </div>
  )
}
