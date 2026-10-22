"use client"

/**
 * Variant A — "הלו״ז על הלוח": the weekly posting schedule lives ON the
 * calendar it drives.
 *
 *   - Browsing: every upcoming day shows its expected slots as dashed ghost
 *     cards ("קרוסלה 12:00") until a real post fills them. The routine is
 *     visible exactly where the user plans, and an empty week reads as
 *     "5 slots waiting", not "nothing here".
 *   - Editing: one button turns the same 7 columns into the template editor
 *     — add / change / remove slots per day, in place. No settings detour.
 *
 * Mounted only under `?rules=a` (review gate). Nothing here persists.
 */

import { CalendarClock, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  SaveButton,
  SaveErrorAlert,
  SlotEditor,
  SlotLabel,
  StoryGapField,
} from "@/components/posting-schedule-parts"
import {
  activeDayCount,
  clashingSlotIds,
  countSlots,
  usesStories,
  withSlotAdded,
  withSlotRemoved,
  withSlotUpdated,
  type PostingSchedule,
  type PostingSlot,
} from "@/lib/posting-schedule"
import type { FormatId } from "@/lib/timing-storage"

function weeklySummary(s: PostingSchedule): string {
  const n = countSlots(s)
  const d = activeDayCount(s)
  if (n === 0) return "אין פרסומים קבועים"
  return `${n} פרסומים בשבוע · ${d} ימים`
}

/** Button in the week-nav row (browse mode). */
export function RoutineButton({ schedule, onEdit }: { schedule: PostingSchedule; onEdit: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
      <CalendarClock className="size-4" aria-hidden="true" />
      לו״ז קבוע
      <span className="text-text-neutral-default">· {weeklySummary(schedule)}</span>
    </Button>
  )
}

/** First-visit note: a default routine is already on the board. */
export function RoutineSuggestionNote({ schedule, onEdit }: { schedule: PostingSchedule; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-yellow-80 bg-bg-surface-primary-default px-3 py-2 mb-4 dark:border-yellow-30">
      <Sparkles className="size-4 shrink-0 text-yellow-30 dark:text-yellow-80" aria-hidden="true" />
      <p className="text-xs-body text-text-primary-default">
        שמנו לכם לו״ז מוצע — {weeklySummary(schedule)}. המשבצות המקווקוות הן המקומות ש״תזמן הכל״ ימלא.
      </p>
      <Button variant="outline" size="xs" onClick={onEdit} className="ms-auto shrink-0">
        התאמת הלו״ז
      </Button>
    </div>
  )
}

/** Replaces the week-nav row while the template is being edited. */
export function RoutineEditBar({
  draft,
  saving,
  saveError,
  dirty,
  onStoryGap,
  onCancel,
  onSave,
}: {
  draft: PostingSchedule
  saving: boolean
  saveError: boolean
  dirty: boolean
  onStoryGap: (m: number) => void
  onCancel: () => void
  onSave: () => void
}) {
  const clashes = clashingSlotIds(draft).size > 0
  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-border-neutral-default bg-bg-surface px-3 py-2">
        <CalendarClock className="size-4 text-text-primary-default" aria-hidden="true" />
        <div className="flex flex-col">
          <span className="text-small-bold text-text-primary-default">עריכת הלו״ז הקבוע</span>
          <span className="text-xs-body text-text-neutral-default">חל על כל שבוע · {weeklySummary(draft)}</span>
        </div>
        <StoryGapField id="story-gap-a" value={draft.storyGapMinutes} enabled={usesStories(draft)} onChange={onStoryGap} />
        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            ביטול
          </Button>
          <SaveButton saving={saving} disabled={!dirty || clashes} onClick={onSave} />
        </div>
      </div>
      {clashes && (
        <p role="status" className="text-xs-body text-button-danger-default">
          יש יום עם שני פרסומים באותה שעה. שנו את אחת השעות כדי לשמור.
        </p>
      )}
      {saveError && <SaveErrorAlert onRetry={onSave} />}
    </div>
  )
}

/** One day-column's content in edit mode. */
export function RoutineDayEditor({
  dayIndex,
  draft,
  onChange,
}: {
  dayIndex: number
  draft: PostingSchedule
  onChange: (next: PostingSchedule) => void
}) {
  const slots = draft.days[dayIndex]
  const clashes = clashingSlotIds(draft)
  return (
    <div className="flex flex-col gap-1.5 p-2 min-h-full">
      {slots.length === 0 && (
        <p className="text-xs-body text-text-neutral-default text-center py-2">יום ללא פרסום</p>
      )}
      {slots.map((slot) => (
        <SlotEditor
          key={slot.id}
          stacked
          slot={slot}
          dayIndex={dayIndex}
          clash={clashes.has(slot.id)}
          onChange={(next) => onChange(withSlotUpdated(draft, dayIndex, next))}
          onRemove={() => onChange(withSlotRemoved(draft, dayIndex, slot.id))}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onChange(withSlotAdded(draft, dayIndex))}
        className="w-full border border-dashed border-gray-80 text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default"
      >
        <Plus aria-hidden="true" />
        הוספת פרסום
      </Button>
    </div>
  )
}

/**
 * Rule slots a day still expects, after matching real scheduled posts by
 * format (each post fills one slot of its format).
 */
export function unfilledSlots(ruleSlots: PostingSlot[], scheduledFormats: FormatId[]): PostingSlot[] {
  const remaining = [...scheduledFormats]
  return ruleSlots.filter((s) => {
    const i = remaining.indexOf(s.format)
    if (i === -1) return true
    remaining.splice(i, 1)
    return false
  })
}

/** Browse-mode ghost card. Clicking it opens the editor. */
export function GhostSlot({ slot, onEdit }: { slot: PostingSlot; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      title="משבצת מהלו״ז הקבוע — ״תזמן הכל״ ימלא אותה"
      aria-label={`משבצת פנויה בלו״ז: ${slot.time}. עריכת הלו״ז`}
      className="w-full rounded-lg border border-dashed border-gray-80 px-2 py-2 text-xs-body text-text-neutral-default text-start hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
    >
      <SlotLabel slot={slot} className="w-full" />
    </button>
  )
}
