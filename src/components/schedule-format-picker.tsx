"use client"

/**
 * ScheduleFormatPicker — modal that asks "which formats are we scheduling?"
 * after the user drops a core post on a calendar slot.
 *
 * Why a picker?
 *   The per-format era (2026-05-06) made (corePostId, format) the unit of
 *   scheduling. A single post can ship as story, talking_head, carousel, or
 *   image_post, each on its own clock. Drag-to-calendar can only set ONE
 *   slot at a time, so we have to ask the user which formats they meant.
 *
 *   Without this dialog, the legacy default (`talking_head`) was committed
 *   silently — which broke the moment a user dragged a post that didn't
 *   have a talking_head variant ready.
 *
 * Multi-select era (2026-05-06):
 *   Hani's MoT moved from "one slot = one format" to "one drag = N formats
 *   scheduled at the same (date, hour)". The picker is now a CHECKBOX group
 *   instead of a radio. The DB schema already supports this: the composite
 *   key (corePostId, format) means each format gets its own row, painted on
 *   the calendar with its own semantic color.
 *
 * Bypass rules (unchanged):
 *   - 0 ready formats   → caller surfaces a toast and never opens this.
 *   - 1 ready format    → caller schedules straight, never opens this.
 *   - >1 ready formats  → opens this. The dialog ALWAYS renders all four
 *                         canonical formats so the user sees the full slate;
 *                         non-ready formats are disabled checkboxes with a
 *                         helper line explaining why (no script / already
 *                         published).
 *
 *   Showing the disabled rows (instead of hiding them) is a deliberate UX
 *   choice from `lessons.md` ("Visual hole != signal"): hiding a format the
 *   user expected to see reads as "broken", not "not yet ready". Disabled
 *   reads as "not yet, here's why".
 *
 * Anatomy:
 *   Dialog (radix) → DialogContent → header + <fieldset>(checkbox rows) +
 *   selection counter + footer. Each row is a clickable card: checkbox +
 *   format icon + Hebrew label + readiness chip + helper text (only when
 *   disabled). The chip is the same `<FormatStatusChip size="sm">` we use
 *   everywhere — single visual language across surfaces.
 *
 * Default selection:
 *   The first READY format starts checked. We deliberately keep at least one
 *   format pre-selected (instead of zero) because (a) ≥1 ready is a
 *   precondition to opening this dialog, and (b) the most common path is
 *   "user wanted exactly one" — giving them a default means Enter on mount
 *   commits the most likely intent without an extra tap.
 *
 * Keyboard:
 *   - Space toggles the focused checkbox (radix Checkbox primitive).
 *   - Tab moves between checkboxes in source order; the first ready row is
 *     focused on mount.
 *   - Enter on the form submits → fires onConfirm with the selected formats.
 *   - Esc closes (radix Dialog default).
 *
 * Focus management:
 *   On open, we focus the first READY (selectable) checkbox so the user can
 *   confirm immediately or de/select with Space.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FormatStatusChip,
  getFormatChipIcon,
  getFormatChipLabel,
} from "@/components/format-status-chip"
import {
  getPublishedMark,
  type FormatId,
  type FormatReadiness,
} from "@/lib/timing-storage"

/**
 * Same canonical format list the Sheet header and /core_posts cards use — kept
 * in sync with `HEADER_CHIP_FORMATS` by hand rather than imported, because
 * core-post-sheet already imports this file and pulling the constant back the
 * other way would close a module cycle.
 *
 * We intentionally don't intersect with `post.formats` here — showing the full
 * slate (including not-yet-duplicated formats as disabled) is what gives the
 * user "what's left to create" context.
 */
const PICKER_FORMATS: FormatId[] = [
  "story",
  "talking_head",
  "carousel",
  "image_post",
  "b_roll",
]

export type ScheduleFormatPickerProps = {
  /** Controlled open state. Caller flips to `false` after `onConfirm`. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The post we're scheduling, plus the per-format readiness already derived
   * by the caller. Keeping readiness as an INPUT (instead of recomputing
   * here) lets the picker stay a pure presentational layer, and matches the
   * pattern used by FormatStatusChip and FormatSection.
   */
  post: {
    corePostId: string
    /**
     * Hook text or title — surfaced in the dialog header so the user
     * confirms they're scheduling the right post. Optional because callers
     * may not have it on hand; we fall back to a generic label.
     */
    displayText?: string | null
    /** All four formats in canonical order with their readiness. */
    formatStates: Record<FormatId, FormatReadiness>
  }
  /** Pretty target date+time for confirmation copy. e.g. "5 במאי בשעה 09:00". */
  targetLabel?: string
  /**
   * Fired when the user confirms one or more formats. The caller is
   * responsible for actually persisting the schedule (calling
   * `schedulePost` per format); this dialog is intentionally I/O-free so it
   * can be reused from any drag source.
   *
   * Multi-select era: receives an ARRAY of format ids (in canonical order).
   * Always non-empty when called — the confirm button is disabled when the
   * user has nothing checked.
   */
  onConfirm: (formats: FormatId[]) => void
}

export function ScheduleFormatPicker({
  open,
  onOpenChange,
  post,
  targetLabel,
  onConfirm,
}: ScheduleFormatPickerProps) {
  // Selectable formats = state is "ready". `scheduled` already has a slot
  // (the user shouldn't double-schedule the same format on a different day
  // through this flow — that's the chip menu's job). `published` is final.
  // `empty` has no script. We fall through to disabled rows for those.
  const selectableFormats = useMemo(() => {
    return PICKER_FORMATS.filter(
      (f) => post.formatStates[f] === "ready",
    )
  }, [post.formatStates])

  // Multi-select state. Default = first ready format checked. We intentionally
  // start with one selection (not zero) because:
  //   (1) the bypass rules guarantee ≥1 ready format reaches this dialog, so
  //       a sensible default exists, and
  //   (2) the most common path is "user wanted one" — leaving them a default
  //       means Enter immediately commits the most likely intent.
  // We re-derive on every open because the readiness map can change between
  // opens (e.g. user marked a script just before dragging again).
  // Per Hani: pre-select ALL ready formats — "what's left." If the user
  // wants fewer, they can deselect individually. Disabled formats
  // (scheduled / published / empty) stay unselectable.
  const [selected, setSelected] = useState<Set<FormatId>>(new Set())
  useEffect(() => {
    if (!open) return
    setSelected(new Set(selectableFormats))
  }, [open, selectableFormats])

  // Focus the first ready checkbox after the dialog mounts. The radix
  // Checkbox renders as a button under the hood, so a plain ref + .focus()
  // is enough; we run it after one paint to give the dialog content time to
  // mount and avoid focus stealing by the dialog body.
  const firstCheckboxRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      firstCheckboxRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  const toggle = (format: FormatId, isReady: boolean) => {
    if (!isReady) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(format)) {
        next.delete(format)
      } else {
        next.add(format)
      }
      return next
    })
  }

  const handleConfirm = () => {
    if (selected.size === 0) return
    // Emit in canonical order — same order the chips will paint in the day
    // cell, the Sheet header lists them, and the rows render here. Keeps
    // every downstream surface predictable.
    const orderedFormats = PICKER_FORMATS.filter((f) => selected.has(f))
    onConfirm(orderedFormats)
  }

  const titleText =
    post.displayText?.trim() && post.displayText.trim().length > 0
      ? post.displayText.trim()
      : "פוסט ליבה"

  // Hebrew plural counter — the helper users see under the rows. Matches the
  // "feedback_plural_addressing" rule (always plural, never singular masc/fem).
  // We split "1" out as "פורמט אחד" because Hebrew grammar treats it as a
  // distinct phrasing; ≥2 collapses to "{n} פורמטים".
  const selectionLabel =
    selected.size === 0
      ? "לא נבחרו פורמטים"
      : selected.size === 1
        ? "פורמט אחד נבחר"
        : `${selected.size} פורמטים נבחרו`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="sm:max-w-md"
        // The default close button is positioned `absolute end-4` which in
        // RTL lands on the start (right) edge — that overlaps our content.
        // We hide it and add a Cancel button in the footer instead.
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>אילו פורמטים מתזמנים?</DialogTitle>
          <DialogDescription className="text-xs-body text-text-neutral-default">
            {targetLabel ? (
              <>
                לפוסט “
                <span className="text-text-primary-default">{titleText}</span>
                ” — {targetLabel}
              </>
            ) : (
              <>
                לפוסט “
                <span className="text-text-primary-default">{titleText}</span>”
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Form wraps a semantic <fieldset>+<legend> so screen readers
            announce the group purpose ("בחרו פורמטים לתזמון"). The legend is
            sr-only because the visible <DialogTitle> already serves that role
            visually — but assistive tech still benefits from the explicit
            grouping. */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleConfirm()
          }}
          aria-label="בחירת פורמטים לתזמון"
        >
          <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
            <legend className="sr-only">בחרו פורמטים לתזמון</legend>
            {PICKER_FORMATS.map((format, i) => {
              const state = post.formatStates[format]
              const isReady = state === "ready"
              const isFirst = isReady && format === selectableFormats[0]
              return (
                <PickerRow
                  key={format}
                  format={format}
                  state={state}
                  isReady={isReady}
                  isChecked={selected.has(format)}
                  onToggle={() => toggle(format, isReady)}
                  // Pass the ref ONLY to the first ready row so we can
                  // focus it after mount.
                  checkboxRef={isFirst ? firstCheckboxRef : undefined}
                  index={i}
                  postId={post.corePostId}
                />
              )
            })}
          </fieldset>

          {/* Selection counter — lives between the rows and the footer so
              the user reads the running total just before deciding to
              confirm. aria-live="polite" announces changes (e.g. "2
              פורמטים נבחרו") without stealing focus. */}
          <p
            className="mt-3 text-xs-body text-text-neutral-default text-right tabular-nums"
            aria-live="polite"
          >
            {selectionLabel}
          </p>

          <DialogFooter className="mt-4 flex flex-row-reverse gap-2 w-full sm:justify-start">
            <Button
              type="submit"
              disabled={selected.size === 0}
              className="flex-1"
            >
              אשרו תזמון
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/*  Row                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A single checkbox row. The whole row is a clickable label (so the entire
 * card surface is the click target — not just the 16px checkbox). We use a
 * native <label> wrapping the radix <Checkbox>: clicks anywhere on the
 * label toggle the checkbox, and the label's `htmlFor` ties it to the
 * checkbox for assistive tech.
 *
 * Disabled rows still render but are not interactive and explain why in a
 * helper line.
 */
function PickerRow({
  format,
  state,
  isReady,
  isChecked,
  onToggle,
  checkboxRef,
  index,
  postId,
}: {
  format: FormatId
  state: FormatReadiness
  isReady: boolean
  isChecked: boolean
  onToggle: () => void
  checkboxRef?: React.RefObject<HTMLButtonElement | null>
  index: number
  postId: string
}) {
  const Icon = getFormatChipIcon(format)
  const label = getFormatChipLabel(format)
  const checkboxId = `picker-checkbox-${format}-${index}`
  const helperId = `picker-helper-${format}-${index}`

  // Helper text for disabled rows. Only rendered when it adds info the
  // chip can't carry on its own.
  //   - empty:     no helper. The dashed-border empty chip already says
  //                "not created" — duplicating it as text is noise.
  //   - scheduled / published: same copy. Per Hani 2026-05-13 the picker
  //                            never shows a publish date — the row just
  //                            reads as "already on the calendar". Both
  //                            states map to the same disabled helper.
  const disabledHelper: string | null = (() => {
    if (state === "empty") return null
    if (state === "incomplete") return "צריך מדיה או קישור לדרייב"
    if (state === "scheduled" || state === "published") {
      return "כבר מתוזמן בלוח"
    }
    return null
  })()

  // Per Hani 2026-05-13: the row used to double-paint selection (yellow
  // frame + bg fill AND the checkbox tick) which read as "two things got
  // selected" instead of one. The checkbox is the single source of truth
  // for selected-state now.
  //
  // We also drop the `focus-within` ring from the row. The Checkbox
  // component already paints its own `focus-visible:ring-2` on the
  // checkbox button — that's the accessible focus indicator. Echoing it
  // on the whole row was what produced the persistent "yellow frame"
  // after click: Radix Checkbox keeps focus after a mouse click, so the
  // row's focus-within ring stayed on and visually re-painted "selected"
  // even though we'd removed the explicit selected-state classes.

  return (
    <label
      htmlFor={isReady ? checkboxId : undefined}
      className={[
        // Layout — full-width row, content right-aligned for RTL.
        "group/row relative flex flex-col items-stretch gap-1.5 w-full text-right",
        "rounded-xl border px-3 py-2.5 transition-all",
        // Visual states — note: NO selected-state visual on the row itself.
        // The Checkbox component owns both "checked" and "focused".
        isReady
          ? "border-border-neutral-default bg-white dark:bg-gray-10 cursor-pointer hover:border-gray-80 hover:bg-bg-surface"
          : // Disabled: muted surface, no hover, no focus ring.
            "border-border-neutral-default bg-bg-surface opacity-60 cursor-not-allowed",
      ].join(" ")}
    >
      {/* Single line — checkbox + icon + label + (inline helper) + chip.
          Per Hani 2026-05-13: helper text used to live on its own line
          below; she wants it inline next to the format name so the row
          stays at a consistent height. The chip is pushed to the end
          with `ms-auto`; helper text is `truncate` so it can't blow out
          the row width. */}
      <div className="flex items-center gap-2.5">
        <Checkbox
          ref={checkboxRef}
          id={checkboxId}
          checked={isReady ? isChecked : false}
          onCheckedChange={onToggle}
          disabled={!isReady}
          aria-describedby={disabledHelper ? helperId : undefined}
          // The label wraps the checkbox so it's accessible by clicking
          // anywhere on the row — but on the checkbox itself we still want
          // a clear shrink-0 size and the standard yellow focus ring.
          className="shrink-0"
        />

        <Icon
          className="size-4 text-text-neutral-default shrink-0"
          aria-hidden
        />

        <span className="text-small text-text-primary-default shrink-0">
          {label}
        </span>

        {disabledHelper && (
          <span
            id={helperId}
            className="text-xs-body text-text-neutral-default min-w-0 truncate"
          >
            {disabledHelper}
          </span>
        )}

        <FormatStatusChip
          format={format}
          state={state}
          size="sm"
          className="shrink-0 ms-auto"
        />
      </div>
    </label>
  )
}
