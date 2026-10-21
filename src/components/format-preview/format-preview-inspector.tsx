"use client"

/**
 * Variant B — an inspector that takes the rail's place.
 *
 * Clicking a format on the board swaps the 480px "פוסטים לתזמון" rail for this
 * panel, in exactly the same slot. Nothing covers the board: she can keep
 * clicking card after card (the panel follows), drag the card she's looking
 * at to another day and watch the date here change with it, and close the
 * panel to get the rail back. It never competes with the rail for space — it
 * borrows the rail's space while the rail isn't what she's doing.
 *
 * Edit-first: the media is shown as-is (no phone chrome) with every slide on
 * a filmstrip, and the date/time and caption controls are already open. The
 * Sunday-evening session from the journey map — go through the week, fix
 * what's off — is one click per post instead of open / edit / save / close.
 */

import { useState } from "react"
import { ChevronRight, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormatStatusChip } from "@/components/format-status-chip"
import { ScheduleDateTimePicker } from "@/components/schedule-date-time-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { destinationForFormat } from "@/lib/social/media-spec"
import type { FormatPreviewHandlers } from "./format-preview-dialog"
import {
  CaptionEditor,
  FormatMedia,
  PublishStatusSlot,
  SlideStrip,
  StoryCaptionNote,
  formatSlot,
  type FormatPreviewData,
  type PreviewContentState,
} from "./shared"

export function FormatPreviewInspector({
  data,
  content,
  onClose,
  ...handlers
}: {
  data: FormatPreviewData
  content: PreviewContentState
  /** Back to the rail. */
  onClose: () => void
} & FormatPreviewHandlers) {
  return (
    <aside
      dir="rtl"
      // Same slot, size and layer as QueuePanel — see its comment for why it
      // is `fixed` and why 480.
      className="fixed top-14 bottom-0 end-0 z-30 flex w-[480px] flex-col border-s border-border-neutral-default bg-white dark:bg-gray-10"
      aria-label="תצוגה מקדימה של הפורמט"
    >
      <InspectorBody key={`${data.corePostId}:${data.format}`} data={data} content={content} onClose={onClose} {...handlers} />
    </aside>
  )
}

function InspectorBody({
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
  const [pickedDate, setPickedDate] = useState(data.scheduledDate)
  const [pickedTime, setPickedTime] = useState(data.scheduledTime)
  // The board is the source of truth: a drag on the board while this panel is
  // open must land here too, so re-sync whenever the slot changes underneath.
  const slotKey = `${data.scheduledDate} ${data.scheduledTime}`
  const [syncedSlot, setSyncedSlot] = useState(slotKey)
  if (syncedSlot !== slotKey) {
    setSyncedSlot(slotKey)
    setPickedDate(data.scheduledDate)
    setPickedTime(data.scheduledTime)
  }

  const isStory = destinationForFormat(data.format) === "story"
  const isPublished = data.publish.kind === "published"
  const loading = content === "loading"
  const whenDirty = pickedDate !== data.scheduledDate || pickedTime !== data.scheduledTime

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border-neutral-default px-2 py-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1 px-2">
          <ChevronRight className="size-4" aria-hidden />
          פוסטים לתזמון
        </Button>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="סגירת התצוגה">
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>סגירה</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 scrollbar-subtle">
        <div className="flex flex-col gap-1.5">
          <div className="flex"><FormatStatusChip format={data.format} state="ready" size="xs" /></div>
          <h3 className="line-clamp-2 text-p-bold text-text-primary-default">{data.hook}</h3>
        </div>

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

        {/* Media — as-is, no phone chrome. Vertical formats are capped so a
            9:16 frame doesn't push everything else off-screen. */}
        <section className="flex flex-col gap-2" aria-label="מדיה">
          <div className={isStory || destinationForFormat(data.format) === "reel" ? "mx-auto w-[240px]" : "mx-auto w-[320px]"}>
            <FormatMedia
              data={data}
              content={content}
              index={slide}
              onIndexChange={setSlide}
              rounded="rounded-xl"
            />
          </div>
          {content === "ready" && data.slides.length > 1 && (
            <>
              <span className="text-xs-body text-text-neutral-default">
                {data.slides.length} שקופיות, בסדר שבו יעלו
              </span>
              <SlideStrip slides={data.slides} index={slide} onIndexChange={setSlide} size="md" />
            </>
          )}
        </section>

        {/* When — open by default. Changes save explicitly; a drag on the
            board updates it live. */}
        <section className="flex flex-col gap-3" aria-labelledby="pv-b-when">
          <div className="flex items-baseline gap-2">
            <h4 id="pv-b-when" className="text-small-bold text-text-primary-default">
              מתי עולה
            </h4>
            {!loading && (
              <span className="text-small text-text-neutral-default tabular-nums">
                {formatSlot(data.scheduledDate, data.scheduledTime)}
              </span>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : isPublished ? (
            <p className="text-xs-body text-text-neutral-default">
              הפוסט כבר עלה, אז המועד שלו כבר לא ניתן לשינוי.
            </p>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border-neutral-default p-3">
              <ScheduleDateTimePicker
                idBase={`pv-b-${data.corePostId}-${data.format}`}
                anchorDate={data.scheduledDate}
                date={pickedDate}
                time={pickedTime}
                onDateChange={setPickedDate}
                onTimeChange={setPickedTime}
              />
              {whenDirty && (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => onReschedule(pickedDate, pickedTime)}>
                    שמירה
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPickedDate(data.scheduledDate)
                      setPickedTime(data.scheduledTime)
                    }}
                  >
                    ביטול
                  </Button>
                  <span className="text-xs-body text-text-neutral-default tabular-nums">
                    {formatSlot(pickedDate, pickedTime)}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Caption — always editable (except stories, which have none). */}
        <section className="flex flex-col gap-2" aria-labelledby="pv-b-caption">
          <h4 id="pv-b-caption" className="text-small-bold text-text-primary-default">
            כיתוב
          </h4>
          {loading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : isStory ? (
            <StoryCaptionNote />
          ) : isPublished ? (
            <p className="whitespace-pre-wrap text-small leading-relaxed text-text-primary-default">
              {data.caption}
            </p>
          ) : (
            <CaptionEditor key={data.caption} value={data.caption} onSave={onCaptionSave} />
          )}
        </section>
      </div>

      <div className="flex items-center gap-2 border-t border-border-neutral-default px-4 py-3">
        <Button size="sm" variant="outline" onClick={onOpenCanvas}>
          <Pencil className="size-3.5" aria-hidden />
          עריכה בקנבס
        </Button>
        <span className="flex-1" />
        {!isPublished && (
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
      </div>
    </>
  )
}
