"use client"

/**
 * Variant B — "לו״ז בהגדרות": the weekly posting schedule is a settings
 * form, set once and forgotten.
 *
 *   One row per day (Sunday first): a checkbox turns the day on/off, and an
 *   "on" day lists its posts — format + hour each, as many as needed. A
 *   summary line says what the week adds up to, and story spacing has its
 *   own block. The calendar links here ("לו״ז פרסום"), it doesn't host it.
 *
 * Mounted only under `?rules=b` (review gate). Nothing here persists.
 */

import { useRef } from "react"
import { CalendarClock, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { getFormatChipLabel } from "@/components/format-status-chip"
import {
  ReviewStateToggle,
  SaveButton,
  SaveErrorAlert,
  SlotEditor,
  StoryGapField,
  useReviewSchedule,
} from "@/components/posting-schedule-parts"
import {
  WEEKDAY_NAMES,
  activeDayCount,
  clashingSlotIds,
  countSlots,
  newSlotId,
  usesStories,
  withDaySlots,
  withSlotAdded,
  withSlotRemoved,
  withSlotUpdated,
  type PostingSchedule,
  type PostingSlot,
} from "@/lib/posting-schedule"
import { toast } from "sonner"

function formatMix(s: PostingSchedule): string {
  const counts = new Map<string, number>()
  for (const d of s.days) for (const x of d) counts.set(x.format, (counts.get(x.format) ?? 0) + 1)
  return [...counts.entries()].map(([f, n]) => `${n} ${getFormatChipLabel(f)}`).join(" · ")
}

export function PostingScheduleSettings() {
  const r = useReviewSchedule()
  const { draft } = r
  const clashes = clashingSlotIds(draft)
  // Unchecking a day remembers its posts, so re-checking it restores them.
  const stash = useRef<Record<number, PostingSlot[]>>({})

  const toggleDay = (day: number, on: boolean) => {
    if (on) {
      const back = stash.current[day]
      r.setDraft(
        back?.length
          ? withDaySlots(draft, day, back)
          : withDaySlots(draft, day, [{ id: newSlotId(), format: "carousel", time: "09:00" }]),
      )
    } else {
      stash.current[day] = draft.days[day]
      r.setDraft(withDaySlots(draft, day, []))
    }
  }

  const total = countSlots(draft)

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <ReviewStateToggle label="הצעה ב׳ — לו״ז בהגדרות" value={r.reviewState} onChange={r.setReviewState} />

      <div className="flex flex-col gap-1">
        <h3 className="text-text-primary-default flex items-center gap-2">
          <CalendarClock className="size-5" aria-hidden="true" />
          לו״ז הפרסום השבועי
        </h3>
        <p className="text-p text-text-neutral-default">
          קובעים פעם אחת באילו ימים, באיזו שעה ובאיזה פורמט מפרסמים. ״תזמן הכל״ ממלא כל שבוע לפי הלו״ז הזה.
        </p>
      </div>

      {!r.hasCustom && (
        <div className="flex items-start gap-2 rounded-xl border border-yellow-80 bg-bg-surface-primary-default px-3 py-2.5 dark:border-yellow-30">
          <Sparkles className="size-4 shrink-0 mt-0.5 text-yellow-30 dark:text-yellow-80" aria-hidden="true" />
          <p className="text-xs-body text-text-primary-default leading-relaxed">
            זה לו״ז מוצע שהכנו לכם — 4–6 פרסומים בשבוע, ראשון עד חמישי. אפשר לשמור אותו כמו שהוא או להתאים.
          </p>
        </div>
      )}

      <section
        aria-labelledby="week-heading"
        className="rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border-neutral-default">
          <h4 id="week-heading" className="text-p-bold text-text-primary-default">ימים ושעות</h4>
          <span className="text-xs-body text-text-neutral-default" aria-live="polite">
            {total === 0
              ? "אין פרסומים בלו״ז"
              : `${total} פרסומים · ${activeDayCount(draft)} ימים — ${formatMix(draft)}`}
          </span>
        </div>

        <ul className="divide-y divide-border-neutral-default">
          {WEEKDAY_NAMES.map((name, day) => {
            const slots = draft.days[day]
            const on = slots.length > 0
            const id = `day-${day}`
            return (
              <li key={day} className="flex items-start gap-4 px-5 py-3">
                <div className="flex items-center gap-2 w-24 shrink-0 h-[34px]">
                  <Checkbox id={id} checked={on} onCheckedChange={(v) => toggleDay(day, v === true)} />
                  <label htmlFor={id} className={`text-p ${on ? "text-text-primary-default" : "text-text-neutral-default"}`}>
                    {name}
                  </label>
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  {on ? (
                    <>
                      {slots.map((slot) => (
                        <SlotEditor
                          key={slot.id}
                          slot={slot}
                          dayIndex={day}
                          clash={clashes.has(slot.id)}
                          onChange={(next) => r.setDraft(withSlotUpdated(draft, day, next))}
                          onRemove={() => r.setDraft(withSlotRemoved(draft, day, slot.id))}
                        />
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => r.setDraft(withSlotAdded(draft, day))}
                        className="w-fit text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default"
                      >
                        <Plus aria-hidden="true" />
                        פרסום נוסף ביום {name}
                      </Button>
                    </>
                  ) : (
                    <span className="text-p text-text-neutral-default leading-[34px]">לא מפרסמים</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 px-5 py-4">
        <h4 className="text-p-bold text-text-primary-default">סטוריז עם כמה פריימים</h4>
        <p className="text-xs-body text-text-neutral-default">
          {usesStories(draft)
            ? "כשסטורי כולל כמה פריימים, הם עולים אחד אחרי השני במרווח הזה — החל מהשעה שבלו״ז."
            : "אין סטורי בלו״ז כרגע. ההגדרה תחול ברגע שתוסיפו סטורי לאחד הימים."}
        </p>
        <StoryGapField
          id="story-gap-b"
          value={draft.storyGapMinutes}
          enabled={usesStories(draft)}
          onChange={(m) => r.setDraft({ ...draft, storyGapMinutes: m })}
        />
      </section>

      {clashes.size > 0 && (
        <p role="status" className="text-xs-body text-button-danger-default">
          יש יום עם שני פרסומים באותה שעה. שנו את אחת השעות כדי לשמור.
        </p>
      )}
      {r.saveError && <SaveErrorAlert onRetry={() => r.save(() => toast.success("הלו״ז נשמר"))} />}

      <div className="flex items-center gap-2">
        <SaveButton
          saving={r.saving}
          disabled={(!r.dirty && r.hasCustom) || clashes.size > 0}
          onClick={() => r.save(() => toast.success("הלו״ז נשמר"))}
        />
        {r.dirty && (
          <Button type="button" variant="outline" size="sm" onClick={r.discard} disabled={r.saving}>
            ביטול שינויים
          </Button>
        )}
      </div>
    </div>
  )
}
