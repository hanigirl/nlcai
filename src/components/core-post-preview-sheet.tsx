"use client"

/**
 * Read-only preview Sheet for /calendar.
 *
 * Per Hani's flow split:
 *   - /calendar = "מתי לפרסם" → side panel is preview, calendar is action
 *   - /core_posts = "מה לפרסם" → that page has the editable Sheet
 *
 * On click in the QueuePanel, this Sheet opens with:
 *   1. Post title + date + close
 *   2. "פורמטים מוכנים לתזמון" — discovery chips (read-only). All four
 *      formats render with their semantic color and per-format state
 *      badge. Selection happens on drag-to-calendar (the
 *      ScheduleFormatPicker), not here.
 *   3. Subtitle with an inline link "קליק כאן" that navigates to
 *      /core_posts (for editing other formats / adding media).
 *   4. Master script body (read-only).
 */

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Image as ImageIcon, Pencil, X } from "lucide-react"

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { DriveVideoPreview } from "@/components/drive-video-preview"
import { isDriveUrl, isVideoUrl } from "@/lib/drive-media"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  TIMING_KEYS,
  getCorePostMeta,
  getFormatReadiness,
  getPublishedMap,
  getScheduledByPostId,
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
import {
  HEADER_CHIP_FORMATS,
  type CorePostSheetData,
} from "@/components/core-post-sheet"

export type CorePostPreviewSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  post: CorePostSheetData | null
  /**
   * When the user opens the preview from a per-format affordance (e.g. a
   * day-cell chip on the calendar grid), pre-select that format so the
   * Sheet lands on its adapted script + visual-active chip in one step.
   * Undefined = open in master-script mode.
   */
  initialFormat?: FormatId
}

export function CorePostPreviewSheet({
  open,
  onOpenChange,
  post,
  initialFormat,
}: CorePostPreviewSheetProps) {
  const router = useRouter()
  const postId = post?.id ?? null

  // Storage-derived state — same pattern as the editable CorePostSheet.
  // Kept local so each preview open is a fresh hydrate; storage events
  // refresh in-place while the sheet is open.
  const [meta, setMeta] = useState<CorePostMeta>({})
  const [scheduledRows, setScheduledRows] = useState<
    Array<{ format: FormatId; date: string; time?: string | null }>
  >([])
  const [publishedMap, setPublishedMap] = useState<PublishedMap>({})

  // Which format's per-format script is currently surfaced. `null` = the
  // master script (post.body); a format id = that format's adapted script
  // pulled from `post.formatBodies`. The chips below act as a single-select
  // toggle: clicking a non-empty chip pops its script in; clicking the
  // active chip again pops it back to the master view.
  //
  // Reset to `null` whenever the post changes — without this, opening the
  // preview for a *different* post while a previous one had a chip
  // selected would surface a stale "format X" header on a body that
  // wasn't generated for that combination.
  const [previewFormat, setPreviewFormat] = useState<FormatId | null>(
    initialFormat ?? null,
  )
  // Re-seed when the post id OR the caller-provided initialFormat changes,
  // so navigating between two scheduled chips (each with its own format)
  // surfaces the right format on each open. We track both inputs so a
  // re-open of the SAME post under a NEW initialFormat still updates.
  useEffect(() => {
    setPreviewFormat(initialFormat ?? null)
  }, [postId, initialFormat])

  useEffect(() => {
    if (!open || !postId) return
    setMeta(getCorePostMeta(postId))
    const rows = getScheduledByPostId(postId).map((r) => ({
      format: r.format,
      date: r.scheduledDate,
      time: r.scheduledTime,
    }))
    setScheduledRows(rows)
    setPublishedMap(getPublishedMap(postId))
  }, [open, postId])

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
        setMeta(getCorePostMeta(postId))
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [open, postId])

  // Format → readiness state, computed once per render. `meta` is in the
  // dep set because `getFormatReadiness` reads localStorage (drive URL
  // can flip a format from empty → ready without a fetch).
  const readinessByFormat = useMemo(() => {
    const empty = Object.fromEntries(
      HEADER_CHIP_FORMATS.map((f) => [f, "empty" as FormatReadiness]),
    ) as Record<FormatId, FormatReadiness>
    if (!post) return empty

    const hasBodyByFormat = post.formatBodies
      ? (Object.fromEntries(
          Object.entries(post.formatBodies).map(([fmt, b]) => [
            fmt,
            !!b?.trim(),
          ]),
        ) as Partial<Record<FormatId, boolean>>)
      : undefined
    const input: ReadinessPostInput = {
      id: post.id,
      formats: post.formats,
      formatsWithMedia: post.formatsWithMedia,
      hasBody: !!post.body?.trim(),
      hasBodyByFormat,
    }
    const map: Record<string, FormatReadiness> = {}
    for (const format of HEADER_CHIP_FORMATS) {
      map[format] = getFormatReadiness(input, format)
    }
    return map as Record<FormatId, FormatReadiness>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, scheduledRows, publishedMap, meta])

  // Derived: human-friendly date line under the title (long format,
  // matches the editable Sheet so the two surfaces feel like the same
  // post regardless of where you opened it from).
  const dateChip = useMemo(() => {
    if (!post?.createdAt) return null
    try {
      const date = new Date(post.createdAt)
      if (Number.isNaN(date.getTime())) return null
      return date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    } catch {
      return null
    }
  }, [post?.createdAt])

  const titleText =
    post?.hookText?.trim() || post?.title?.trim() || "פוסט ליבה"

  const handleEditClick = () => {
    if (!postId) return
    onOpenChange(false)
    // Per Hani: edit goes to the canvas page (/project), not the
    // /core_posts listing.
    router.push(`/project?post_id=${postId}`)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        dir="rtl"
        showCloseButton={false}
        className="w-full sm:max-w-[520px] p-0 flex flex-col"
        // Don't auto-focus the close button — it would fire its tooltip.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-10 border-b border-border-neutral-default px-6 py-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-bold text-text-primary-default line-clamp-3 text-right leading-snug">
                {titleText}
              </SheetTitle>
              <SheetDescription className="sr-only">
                תצוגה מקדימה של פוסט ליבה — סקריפט ופורמטים מוכנים לתזמון.
              </SheetDescription>
              {dateChip && (
                <p className="text-xs-body text-text-neutral-default mt-1.5 text-right">
                  {dateChip}
                </p>
              )}
            </div>
            <TooltipProvider delayDuration={0} skipDelayDuration={0}>
              <div className="flex items-center gap-2 shrink-0">
                {/* Open in canvas editor — small outline button with
                    pencil affordance, mirroring the master Sheet
                    header. No "תזמון פוסט" CTA here because this
                    preview only opens FROM /calendar (the user is
                    already in the scheduling surface; offering it
                    again would be a loop). */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditClick}
                  aria-label="עריכה"
                  className="gap-1.5"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  עריכה
                </Button>
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
          </div>
        </header>

        <div
          dir="rtl"
          className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-7 text-right"
        >
          {post && (
            <>
              {/* Discovery chips — read-only. Selection happens on
                  drag-to-calendar (the ScheduleFormatPicker). */}
              <section aria-labelledby="ready-formats-heading">
                <h3
                  id="ready-formats-heading"
                  className="text-base font-bold text-text-primary-default mb-1.5"
                >
                  פורמטים מוכנים לתזמון
                </h3>
                <p className="text-xs-body text-text-neutral-default mb-3 leading-relaxed">
                  אפשר לבחור רק פורמטים שיש להם סקריפט ומדיה / לינק לגוגל
                  דרייב.{" "}
                  <button
                    type="button"
                    onClick={handleEditClick}
                    className="underline text-text-primary-default hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded"
                  >
                    קליק כאן
                  </button>{" "}
                  לעריכת פורמטים נוספים
                </p>
                <div className="flex flex-wrap gap-2" role="list">
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
                    // A chip is clickable ONLY when it's actually ready
                    // to schedule — script + (media OR drive link) is in
                    // place. The `incomplete` state (script-only, no
                    // media) used to be clickable, but Hani: "the chip
                    // is a 'pick this to schedule' affordance — picking
                    // a half-ready format leads to a dead end on the
                    // calendar." So we treat ready / scheduled /
                    // published as interactive, and empty / incomplete
                    // as decorative state pills.
                    const isInteractive =
                      state === "ready" ||
                      state === "scheduled" ||
                      state === "published"
                    const isActive = previewFormat === format
                    return (
                      <div role="listitem" key={format}>
                        {isInteractive ? (
                          <FormatStatusChipLink
                            format={format}
                            state={state}
                            date={dateValue ?? undefined}
                            size="md"
                            // Visual indication of the active chip — we
                            // wrap with a focus-style ring (same yellow
                            // token used everywhere) instead of recoloring
                            // the chip surface. Recoloring would compete
                            // with the per-format hue that already
                            // encodes format identity; a ring is a layer
                            // ABOVE the chip and reads as "selected"
                            // without overwriting state semantics.
                            className={
                              isActive
                                ? "ring-2 ring-yellow-50 ring-offset-1"
                                : ""
                            }
                            aria-pressed={isActive}
                            onClick={() =>
                              setPreviewFormat((prev) =>
                                prev === format ? null : format,
                              )
                            }
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

              {/* Script — read-only. Master by default; switches to a
                  per-format adapted script when the user toggles a chip
                  above. The format-specific body falls back to the master
                  body when no adaptation exists for the selected format
                  (legacy posts or formats inherited from the global
                  script) — same "fallback, not gap" rule the editable
                  Sheet uses, so the user never sees an empty script panel
                  after an intentional click.
                  Lessons.md "Conditional UI elements לפי signal level": a
                  format-specific header appears ONLY when the user has
                  asked for it; otherwise the heading stays on its
                  primary-action label "הסקריפט". */}
              {(() => {
                const perFormatBody =
                  previewFormat !== null
                    ? post.formatBodies?.[previewFormat]
                    : undefined
                const displayedBody =
                  previewFormat !== null
                    ? (perFormatBody?.trim() ? perFormatBody : post.body)
                    : post.body
                if (!displayedBody?.trim()) return null
                const headingText =
                  previewFormat !== null
                    ? `הסקריפט — ${getFormatChipLabel(previewFormat)}`
                    : "הסקריפט"
                return (
                  <section aria-labelledby="preview-script-heading">
                    <h3
                      id="preview-script-heading"
                      className="text-base font-bold text-text-primary-default mb-3"
                    >
                      {headingText}
                    </h3>
                    <div className="bg-bg-surface border border-border-neutral-default rounded-md px-4 py-3">
                      <p className="text-small text-text-primary-default whitespace-pre-wrap leading-relaxed">
                        {displayedBody}
                      </p>
                    </div>
                  </section>
                )
              })()}

              {/* Media + Cover — read-only 50/50 grid mirroring the
                  full edit panel. Right slot: uploaded video. Left slot:
                  cover (data not yet exposed by the API; renders empty
                  state until then). Drive link sits below as an alt
                  surface to the same content. */}
              <section
                aria-labelledby="preview-media-heading"
                className="flex flex-col gap-2"
              >
                <h3
                  id="preview-media-heading"
                  className="text-base font-bold text-text-primary-default"
                >
                  מדיה
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <PreviewMediaSlot
                    kind="video"
                    url={post.primaryMediaUrl ?? null}
                    onAction={handleEditClick}
                  />
                  <PreviewMediaSlot
                    kind="cover"
                    url={post.coverUrl ?? null}
                    onAction={handleEditClick}
                  />
                </div>
                {meta.driveUrl && (
                  <a
                    href={meta.driveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 self-start text-small text-text-primary-default hover:bg-bg-surface px-2 py-1 rounded-lg border border-border-neutral-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 mt-1"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    פתחו ב-Google Drive
                  </a>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Single media slot for the preview sheet — square card, read-only.
 * Same visual treatment as the slot in the editable Sheet so the user
 * gets the same mental model across surfaces. The action button on the
 * empty state navigates to /project (canvas), where editing actually
 * happens.
 */
function PreviewMediaSlot({
  kind,
  url,
  onAction,
}: {
  kind: "video" | "cover"
  url: string | null
  onAction: () => void
}) {
  const buttonLabel = kind === "video" ? "להוסיף מדיה" : "להוסיף קאבר"
  const emptyAria =
    kind === "video"
      ? "פתיחה בעמוד הפוסט לעריכת מדיה"
      : "פתיחה בעמוד הפוסט לעריכת קאבר"
  const isVideo = isVideoUrl(url)

  if (url) {
    return (
      <div className="aspect-square rounded-xl overflow-hidden bg-bg-surface border border-border-neutral-default">
        {isDriveUrl(url) ? (
          // Link-mode video — plays from Drive, never copied to our bucket.
          <DriveVideoPreview url={url} label="מדיה של הפוסט" />
        ) : isVideo ? (
          <video
            src={url}
            className="w-full h-full object-cover"
            playsInline
            muted
            loop
            autoPlay
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={kind === "video" ? "מדיה של הפוסט" : "קאבר של הפוסט"}
            className="w-full h-full object-cover"
          />
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onAction}
      aria-label={emptyAria}
      className="aspect-square rounded-xl bg-bg-surface border border-dashed border-border-neutral-default flex flex-col items-center justify-center gap-2 px-3 text-center cursor-pointer hover:border-yellow-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
    >
      <ImageIcon
        className="size-5 text-text-neutral-default"
        aria-hidden
      />
      <span className="text-xs-body text-text-neutral-default">
        {buttonLabel}
      </span>
    </button>
  )
}
