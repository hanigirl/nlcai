"use client"

/**
 * @deprecated 2026-05-06 — superseded by the Tabs refactor in
 * `core-post-sheet.tsx`. The Sheet no longer stacks four FormatSections;
 * each format is now a TabsContent with inline panel sub-blocks
 * (ScriptBlock / MediaBlock / DriveLinkBlock / TriggerWordBlock /
 * ScheduleStatusBlock). No surface imports this file anymore. Kept in the
 * tree pending Hani's approval to delete (the agent didn't have permission
 * to `rm` it during the build).
 *
 * --- original docstring follows ---
 *
 * FormatSection — one section of the CorePostSheet body, scoped to a single
 * (corePost, format) pair.
 *
 * Why a per-format section (Phase 2)?
 *   The Sheet originally had three flat sections (script, media, details) for
 *   the whole post. That worked when the post existed in one format — but a
 *   core post can be expressed as story / talking_head / carousel / image_post
 *   on independent clocks (each scheduled and published separately). Showing
 *   the script + media + state once for "the post" hid the per-format reality.
 *   This section is the unit that pairs with each chip in the header row:
 *   chip says "carousel is ready", section shows the carousel content.
 *
 * Anchor id contract:
 *   The wrapping `<section>` always has `id="format-section-{format}"`. Two
 *   things in the Sheet rely on this:
 *     1. `FormatStatusChipScrollTo` chips in the header → scrolls/focuses here.
 *     2. The Sheet's `initialFormat` prop → scrolls here on open from the
 *        calendar / queue.
 *   Keeping the id deterministic (no random suffix) lets both paths target
 *   the same DOM node without coordination.
 *
 * State-driven body:
 *   `state` is the same `FormatReadiness` projection used by the chip — so
 *   the chip and the section stay in sync by construction (both derive from
 *   the same input). The section never recomputes readiness; the parent
 *   passes it down already-derived.
 *
 *     empty     → CTA only ("create a script for {format}"). Tiny footprint.
 *     ready     → script + media + (no published checkbox; not scheduled).
 *     scheduled → script + media + "mark as published" checkbox.
 *     published → script + media + the checkbox is checked.
 *
 *   "Scheduled" and "published" share the body shape on purpose: the only
 *   thing that changes between them is the checkbox state. Treating them as
 *   one branch keeps the visual rhythm consistent for the user as they tick
 *   off posts.
 *
 * What this component does NOT own:
 *   - Editing the script. The script preview is read-only here; full editing
 *     lives in /project (drill-in via `onCreateScript`/`onEditScript`).
 *   - Uploading media. The Sheet is a hub, not a workshop. Media upload
 *     lives in /project alongside the avatar/recording flow.
 *   - Storage I/O. Callbacks (`onTogglePublished`, `onCreateScript`) are
 *     fired up to the Sheet which holds the storage write.
 */

import { useState } from "react"
import { ExternalLink, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  formatChipDate,
  getFormatChipIcon,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import type { FormatId, FormatReadiness } from "@/lib/timing-storage"

/**
 * Build the canonical anchor id for a (sheet, format) section. Exported so
 * the chips row in the header can target the same id without duplicating
 * the prefix.
 */
export function formatSectionId(format: FormatId): string {
  return `format-section-${format}`
}

/**
 * Threshold above which the script body collapses to a preview + "see more".
 * Tuned to ~3 lines at the Sheet's body width (text-small leading-relaxed):
 * shorter than that and the preview/expand is more friction than value.
 */
const SCRIPT_PREVIEW_THRESHOLD = 200

export type FormatSectionProps = {
  /** Format this section represents — drives label, icon, anchor id. */
  format: FormatId
  /** Pre-derived readiness state — caller is responsible for projection. */
  state: FormatReadiness
  /** Core post id — passed through to handlers so they can write storage. */
  postId: string
  /**
   * The script body to display for this format. Phase 3a wired the Sheet to
   * pass the per-format script (`formatBodies[format]`) here. Callers that
   * don't yet have per-format scripts can still pass a post-level body — the
   * section's contract has always been format-aware, so the only thing that
   * changed is what the parent sources from.
   */
  body: string | null
  /**
   * Primary media URL for this format if one exists, else null. Phase 3a
   * lets the Sheet pass an explicit per-format URL via `formatMedia[format]`
   * when the API exposes it; until then the Sheet falls back to its existing
   * approximation (post-level `primaryMediaUrl` for any format in
   * `formatsWithMedia`).
   */
  mediaUrl: string | null
  /** Whether the post has a drive_url override. Drives the "open drive" CTA. */
  hasDriveUrl: boolean
  /** Drive URL value (only used when `hasDriveUrl` is true). */
  driveUrl?: string
  /** YYYY-MM-DD scheduled date (when state is "scheduled"). Optional. */
  scheduledDate?: string
  /** ISO timestamp when the user marked this format as published. Optional. */
  publishedAt?: string
  /** Click handler for the empty-state CTA — open /project to author the script. */
  onCreateScript: () => void
  /** Click handler for the "mark as published" checkbox toggle. */
  onTogglePublished: () => void
  /**
   * Optional drill-in handler. If provided and state ≠ empty, surfaces a
   * subtle "edit in /project" affordance next to the script. We keep it
   * optional because some host pages may not want to leave their flow.
   */
  onEditScript?: () => void
}

export function FormatSection({
  format,
  state,
  body,
  mediaUrl,
  hasDriveUrl,
  driveUrl,
  scheduledDate,
  publishedAt,
  onCreateScript,
  onTogglePublished,
  onEditScript,
}: FormatSectionProps) {
  const Icon = getFormatChipIcon(format)
  const label = getFormatChipLabel(format)
  const sectionId = formatSectionId(format)

  // Local expand toggle for long scripts. We deliberately don't lift this to
  // the Sheet — it's UI-state per section, and lifting would create one global
  // "see more" toggle that fights the user when multiple formats are long.
  const [expanded, setExpanded] = useState(false)

  // Pick the small date-line text that sits at the end of the header row.
  // Empty/ready show nothing — the chip already carries any state info.
  const dateLine = (() => {
    if (state === "scheduled" && scheduledDate) {
      const short = formatChipDate(scheduledDate)
      return short ? `מתוזמן ל-${short}` : null
    }
    if (state === "published" && publishedAt) {
      const short = formatChipDate(publishedAt)
      return short ? `פורסם ב-${short}` : null
    }
    return null
  })()

  return (
    // tabIndex=-1 so smooth-scroll focus from the chip lands here cleanly.
    // The section is not in the natural Tab order (the heading inside it is
    // not focusable either), but a programmatic focus call from the anchor
    // wrapper needs SOMEWHERE to land — this is that target.
    <section
      id={sectionId}
      tabIndex={-1}
      aria-label={label}
      className="scroll-mt-4 focus-visible:outline-none"
    >
      {/* Header — icon + format name + (optional date line) */}
      <div className="flex items-center gap-2 mb-3">
        <Icon
          className="size-4 text-text-neutral-default shrink-0"
          aria-hidden
        />
        <h3 className="text-text-primary-default flex-1">{label}</h3>
        {dateLine && (
          <span className="text-xs-body text-text-neutral-default tabular-nums">
            {dateLine}
          </span>
        )}
      </div>

      {/* Body — branches on state. Empty is a tiny prompt; everything else
          shares the script + media layout. */}
      {state === "empty" ? (
        <EmptySectionBody label={label} onCreateScript={onCreateScript} />
      ) : (
        <PopulatedSectionBody
          format={format}
          state={state}
          label={label}
          body={body}
          mediaUrl={mediaUrl}
          hasDriveUrl={hasDriveUrl}
          driveUrl={driveUrl}
          publishedAt={publishedAt}
          expanded={expanded}
          setExpanded={setExpanded}
          onTogglePublished={onTogglePublished}
          onEditScript={onEditScript}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Empty branch                                                        */
/* ------------------------------------------------------------------ */

/**
 * Empty-state body. Intentionally low-density:
 *   - No "container" treatment (border, shadow, big padding) — that would
 *     look like a placeholder asset and create dead weight on the screen.
 *     Instead we use a soft `bg-bg-surface` block with only enough padding
 *     to host the CTA and a microcopy line.
 *   - One outline button. Primary action of the Sheet itself is the footer
 *     CTA — empty sections shouldn't fight that.
 */
function EmptySectionBody({
  label,
  onCreateScript,
}: {
  label: string
  onCreateScript: () => void
}) {
  return (
    <div className="rounded-xl bg-bg-surface px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-small text-text-neutral-default">
        טרם נוצר סקריפט ל{label}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onCreateScript}
        className="shrink-0"
      >
        צרו {label}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Populated branch (ready / scheduled / published)                    */
/* ------------------------------------------------------------------ */

function PopulatedSectionBody({
  format,
  state,
  label,
  body,
  mediaUrl,
  hasDriveUrl,
  driveUrl,
  publishedAt,
  expanded,
  setExpanded,
  onTogglePublished,
  onEditScript,
}: {
  format: FormatId
  state: FormatReadiness
  label: string
  body: string | null
  mediaUrl: string | null
  hasDriveUrl: boolean
  driveUrl?: string
  publishedAt?: string
  expanded: boolean
  setExpanded: (v: boolean) => void
  onTogglePublished: () => void
  onEditScript?: () => void
}) {
  const trimmedBody = body?.trim() ?? ""
  const hasBody = trimmedBody.length > 0
  const isLong = trimmedBody.length > SCRIPT_PREVIEW_THRESHOLD
  const visibleBody =
    isLong && !expanded
      ? `${trimmedBody.slice(0, SCRIPT_PREVIEW_THRESHOLD).trimEnd()}…`
      : trimmedBody

  // Separate the "the user has SOMETHING for this format" check from the
  // strict mediaUrl check: a drive link counts as "media is somewhere" even
  // though we can't preview it inline. This drives the missing-media prompt.
  const hasAnyMediaSignal = !!mediaUrl || hasDriveUrl

  return (
    <div className="flex flex-col gap-4">
      {/* Script block ------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs-body text-text-neutral-default">סקריפט</span>
          {hasBody && onEditScript && (
            <button
              type="button"
              onClick={onEditScript}
              className="inline-flex items-center gap-1 text-xs-body text-text-neutral-default hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-md px-1 py-0.5 transition-colors"
              aria-label={`ערכו את הסקריפט ל${label}`}
            >
              <Pencil className="size-3" aria-hidden />
              ערכו
            </button>
          )}
        </div>
        {hasBody ? (
          <div className="rounded-xl bg-bg-surface px-4 py-3 text-text-primary-default text-small leading-relaxed whitespace-pre-wrap">
            {visibleBody}
            {isLong && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="block mt-2 text-xs-body text-text-neutral-default hover:text-text-primary-default underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded-md"
              >
                {expanded ? "הציגו פחות" : "ראו עוד"}
              </button>
            )}
          </div>
        ) : (
          // We're in a non-empty state but the body is missing — e.g. media
          // exists but text doesn't. Don't show a fake script container; just
          // a small inline note so the user knows it's incomplete.
          <p className="text-xs-body text-text-neutral-default">
            עדיין אין סקריפט ל{label}
          </p>
        )}
      </div>

      {/* Media block -------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs-body text-text-neutral-default">מדיה</span>
        {mediaUrl ? (
          <MediaPreview url={mediaUrl} label={label} />
        ) : hasDriveUrl ? (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="self-start gap-1.5"
          >
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`פתחו את המדיה של ${label} ב-Google Drive`}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              פתחו ב-Google Drive
            </a>
          </Button>
        ) : (
          // Ready-but-no-media is a possible state for non-media formats
          // (story captions etc.). For media-bearing states (scheduled /
          // published) we emit the same prompt — the data should usually
          // never reach here for those, but if it does we surface the gap
          // rather than rendering nothing.
          <p className="text-xs-body text-text-neutral-default">
            {state === "ready"
              ? "אפשר להעלות וידאו/תמונה במסך מלא או להוסיף קישור דרייב"
              : "לא נמצאה מדיה לפורמט הזה"}
          </p>
        )}
      </div>

      {/* Published checkbox — only when scheduled or already published. */}
      {(state === "scheduled" || state === "published") && (
        <div className="flex items-start gap-2.5 pt-1">
          <Checkbox
            id={`published-${format}`}
            checked={state === "published"}
            onCheckedChange={onTogglePublished}
            className="mt-0.5"
            aria-label={`סמנו את ${label} כפורסם`}
          />
          <Label
            htmlFor={`published-${format}`}
            className="text-small text-text-primary-default cursor-pointer"
          >
            {state === "published"
              ? `סומן כפורסם${publishedAt ? ` ב-${formatChipDate(publishedAt) ?? ""}` : ""}`
              : `סמנו את ${label} כפורסם`}
          </Label>
        </div>
      )}

      {/* Light divider visual cue between this section and the next.
          We use a thin border under the section block instead of a
          standalone <hr> so it doesn't add an extra Tab stop or get
          read aloud as "horizontal separator". */}
      {/* (Removed inline divider — the parent column gap-7 already
          provides clear separation between sections.) */}

      {/* SR-only state announcement. Phase 3a decoupled body per-format —
          this label still announces format readiness and lets screen
          readers know the section content reflects the per-format script
          (not the global body, which they previously heard repeated four
          times). */}
      <span className="sr-only">
        {state === "ready"
          ? `${label} מוכן`
          : state === "scheduled"
            ? `${label} מתוזמן`
            : `${label} פורסם`}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Media preview                                                       */
/* ------------------------------------------------------------------ */

/**
 * Compact thumbnail/video preview. We use the existing aspect-video shape so
 * portrait videos letterbox without cropping faces — the Sheet body is too
 * narrow to commit to portrait.
 */
function MediaPreview({ url, label }: { url: string; label: string }) {
  const isVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(url)
  return (
    <div className="rounded-xl overflow-hidden border border-border-neutral-default bg-bg-surface aspect-video">
      {isVideo ? (
        <video
          src={url}
          className="w-full h-full object-cover"
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`מדיה ל${label}`}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  )
}
