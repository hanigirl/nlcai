"use client"

/**
 * Variant A — "how it will look on her phone".
 *
 * A modal over the board, Later-style: on the start side an Instagram frame
 * rendering the post exactly as followers will meet it (feed post with the
 * caption under it; reel / story full-bleed 9:16 with the chrome on top), and
 * under it every carousel slide in order. On the other side, what she can act
 * on: the publish status first, then when it goes out, then the caption.
 *
 * View-first: the caption reads as a finished fact and opens for editing on
 * request; date/time is one field that opens a datepicker. The board is covered while it's open — the moment
 * is "is this ready to go out?", one post at a time. A modal also can't
 * collide with the approved rail: it sits above both.
 */

import { useState } from "react"
import { Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FormatStatusChip } from "@/components/format-status-chip"
import { checkSlot, ScheduleDateTimeField } from "@/components/schedule-date-time-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { destinationForFormat } from "@/lib/social/media-spec"
import {
  CaptionCounter,
  CaptionTooLong,
  FormatMedia,
  InstagramActionRow,
  InstagramHandle,
  PublishStatusSlot,
  SlideDots,
  SlideStrip,
  StoryCaptionNote,
  type FormatPreviewData,
  type PreviewContentState,
} from "./shared"

export type FormatPreviewHandlers = {
  onReschedule: (date: string, time: string) => void
  onCaptionSave: (caption: string) => void
  onUnschedule: () => void
  onOpenCanvas: () => void
  onStatusAction: (action: "connect" | "reconnect" | "retry" | "fix_media" | "open_post") => void
}

export function FormatPreviewDialog({
  open,
  onOpenChange,
  data,
  content,
  ...handlers
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: FormatPreviewData | null
  content: PreviewContentState
} & FormatPreviewHandlers) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        showCloseButton={false}
        className="sm:max-w-[920px] max-h-[calc(100vh-3rem)] overflow-hidden p-0 gap-0"
      >
        {data && <DialogBody key={`${data.corePostId}:${data.format}`} data={data} content={content} onClose={() => onOpenChange(false)} {...handlers} />}
      </DialogContent>
    </Dialog>
  )
}

function DialogBody({
  data,
  content,
  onClose,
  onReschedule,
  onCaptionSave,
  onUnschedule,
  onOpenCanvas,
  onStatusAction,
}: {
  data: FormatPreviewData
  content: PreviewContentState
  onClose: () => void
} & FormatPreviewHandlers) {
  const [slide, setSlide] = useState(0)
  // Draft slot — "תזמון פוסט" in the footer commits it to the board.
  const [draftDate, setDraftDate] = useState(data.scheduledDate)
  const [draftTime, setDraftTime] = useState(data.scheduledTime)
  const [captionDraft, setCaptionDraft] = useState(data.caption)
  const [slotError, setSlotError] = useState<string | null>(null)
  const slotKey = `${data.corePostId}:${data.format} ${data.scheduledDate} ${data.scheduledTime}`
  const [syncedSlot, setSyncedSlot] = useState(slotKey)
  if (syncedSlot !== slotKey) {
    setSyncedSlot(slotKey)
    setDraftDate(data.scheduledDate)
    setDraftTime(data.scheduledTime)
    setSlotError(null)
  }
  const [syncedCaption, setSyncedCaption] = useState(`${data.corePostId}:${data.format} ${data.caption}`)
  if (syncedCaption !== `${data.corePostId}:${data.format} ${data.caption}`) {
    setSyncedCaption(`${data.corePostId}:${data.format} ${data.caption}`)
    setCaptionDraft(data.caption)
  }
  const slotDirty =
    !!draftDate && (draftDate !== data.scheduledDate || draftTime !== data.scheduledTime)
  const captionDirty = captionDraft !== data.caption
  // One button for every edit here (Hani, 2026-10-21): "תזמון פוסט" saves the
  // caption and the slot together. No separate caption save.
  const commit = () => {
    if (slotDirty || !data.scheduledDate) {
      const check = draftDate
        ? checkSlot(draftDate, draftTime)
        : ({ ok: false, reason: "בחרו תאריך ושעה" } as const)
      if (!check.ok) {
        setSlotError(check.reason)
        return
      }
    }
    if (captionDirty) onCaptionSave(captionDraft)
    if (slotDirty) onReschedule(draftDate, draftTime)
  }

  const kind = destinationForFormat(data.format)
  const isStory = kind === "story"
  const isPublished = data.publish.kind === "published"
  const loading = content === "loading"

  return (
    <div className="grid max-h-[calc(100vh-3rem)] grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      {/* Start side (right in RTL) — the post as Instagram will show it. */}
      <div className="flex flex-col items-center gap-3 overflow-y-auto bg-bg-surface px-6 py-6 scrollbar-subtle">
        <PhoneFrame data={data} content={content} slide={slide} onSlide={setSlide} />
        {content === "ready" && data.slides.length > 1 && (
          <div className="flex w-full max-w-[300px] flex-col gap-1.5">
            <span className="text-xs-body text-text-neutral-default">
              {data.slides.length} שקופיות, בסדר שבו יעלו
            </span>
            <SlideStrip slides={data.slides} index={slide} onIndexChange={setSlide} />
          </div>
        )}
      </div>

      {/* End side — status, when, caption. */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-start gap-3 border-b border-border-neutral-default px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex"><FormatStatusChip format={data.format} state="ready" size="xs" /></div>
            <DialogTitle className="line-clamp-2 text-p-bold text-text-primary-default">
              {data.hook}
            </DialogTitle>
            <DialogDescription className="sr-only">
              תצוגה מקדימה של הפורמט כפי שיעלה לאינסטגרם
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="סגירה">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 scrollbar-subtle">
          {loading ? (
            <Skeleton className="h-14 w-full rounded-xl" />
          ) : (
            <PublishStatusSlot
              status={data.publish}
              date={data.scheduledDate}
              time={data.scheduledTime}
              onAction={onStatusAction}
            />
          )}

          {/* When it goes out. One field that opens a datepicker with the
              time under it (Hani, 2026-10-21) — closing it moves the card on
              the board, which is the source of truth. */}
          <section className="flex flex-col gap-2" aria-labelledby="pv-when">
            <h4 id="pv-when" className="text-small-bold text-text-primary-default">
              מתי עולה
            </h4>
            {loading ? (
              <Skeleton className="h-10 w-full rounded-xl" />
            ) : (
              <ScheduleDateTimeField
                idBase={`pv-a-${data.corePostId}-${data.format}`}
                date={draftDate}
                time={draftTime}
                onChange={(d, t) => {
                  setDraftDate(d)
                  setDraftTime(t)
                  setSlotError(null)
                }}
                error={slotError}
                disabled={isPublished}
              />
            )}
          </section>

          {/* Caption — the format's full body, exactly what is sent. */}
          <section className="flex flex-col gap-2" aria-labelledby="pv-caption">
            <div className="flex items-center gap-2">
              <h4 id="pv-caption" className="flex-1 text-small-bold text-text-primary-default">
                כיתוב
              </h4>
            </div>
            {loading ? (
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : isStory ? (
              <StoryCaptionNote />
            ) : isPublished ? (
              <p className="whitespace-pre-wrap text-small leading-relaxed text-text-primary-default">
                {data.caption}
              </p>
            ) : (
              // Editable from the start — saved by "תזמון פוסט" in the footer.
              <>
                <Textarea
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  rows={8}
                  dir="rtl"
                  aria-labelledby="pv-caption"
                  className="min-h-40 text-small leading-relaxed"
                />
                <div className="flex justify-end">
                  <CaptionCounter length={captionDraft.length} />
                </div>
                <CaptionTooLong length={captionDraft.length} />
              </>
            )}
          </section>
        </div>

        {/* Footer (RTL): "הסרה מהלוח" alone on the right; "עריכה בקנבס" and
            the primary "תזמון פוסט" together on the left (Hani, 2026-10-21). */}
        <div className="flex items-center gap-2 border-t border-border-neutral-default px-6 py-3">
          {!isPublished && data.scheduledDate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-text-neutral-default hover:text-text-primary-default"
              onClick={onUnschedule}
            >
              <Trash2 className="size-3.5" aria-hidden />
              הסרה מהלוח
            </Button>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={onOpenCanvas}>
            <Pencil className="size-3.5" aria-hidden />
            עריכה בקנבס
          </Button>
          {!isPublished && (
            <Button size="sm" disabled={!(slotDirty || captionDirty) || loading} onClick={commit}>
              תזמון פוסט
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The Instagram frame. Feed posts get the classic layout (header, media,
 * actions, caption with "עוד"); reels and stories go full-bleed with their
 * chrome laid over the media, because that is how they're actually seen.
 */
function PhoneFrame({
  data,
  content,
  slide,
  onSlide,
}: {
  data: FormatPreviewData
  content: PreviewContentState
  slide: number
  onSlide: (i: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const kind = destinationForFormat(data.format)

  const frame =
    "w-[300px] shrink-0 overflow-hidden rounded-[28px] border-[6px] border-gray-10 bg-white shadow-lg dark:bg-gray-10"

  if (kind === "post") {
    return (
      <div className={frame} aria-label="תצוגה כפי שתיראה בפיד">
        <div className="px-3 py-2.5">
          <InstagramHandle handle={data.handle} />
        </div>
        <FormatMedia data={data} content={content} index={slide} onIndexChange={onSlide} />
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="relative">
            <InstagramActionRow />
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none">
              <SlideDots total={content === "ready" ? data.slides.length : 0} index={slide} />
            </div>
          </div>
          {content === "loading" ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <p className={`text-xs-body text-text-primary-default ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>
              <bdi dir="ltr" className="font-bold">
                {data.handle}
              </bdi>{" "}
              {data.caption}
            </p>
          )}
          {!expanded && content !== "loading" && data.caption.length > 90 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="self-start text-xs-body text-text-neutral-default hover:text-text-primary-default"
            >
              עוד
            </button>
          )}
        </div>
      </div>
    )
  }

  // Reel / story — full-bleed 9:16 with the chrome over the media.
  const overlay =
    content === "ready" ? (
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/35 via-transparent to-black/55 p-3">
        {kind === "story" ? (
          <div className="flex flex-col gap-2">
            <span className="h-0.5 w-full rounded-full bg-white/80" aria-hidden />
            <InstagramHandle handle={data.handle} light />
          </div>
        ) : (
          <span className="text-small-bold text-white">רילס</span>
        )}
        {kind === "reel" && (
          <div className="flex flex-col gap-2">
            <InstagramHandle handle={data.handle} light />
            <p className="line-clamp-2 text-xs-body text-white">{data.caption}</p>
          </div>
        )}
      </div>
    ) : null

  return (
    <div className={frame} aria-label={kind === "story" ? "תצוגה כפי שתיראה בסטורי" : "תצוגה כפי שתיראה ברילס"}>
      <FormatMedia data={data} content={content} index={slide} onIndexChange={onSlide} overlay={overlay} />
    </div>
  )
}
