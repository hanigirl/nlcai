"use client"

/**
 * Schedule settings — ONE component, two homes (Hani, 2026-10-29):
 *   - the modal behind the ⚙ next to "סידור אוטומטי בלוח" in the calendar
 *     panel (`ScheduleSettingsDialog`);
 *   - Settings → "תזמון" (`ScheduleSettings` inline).
 *
 * Infrastructure only: it owns the weekly routine (lib/posting-schedule via
 * usePostingSchedule) and its save, and renders a placeholder. Hani is
 * sending the full design — build it inside `ScheduleSettingsBody`, and both
 * homes get it.
 */

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { usePostingSchedule } from "@/components/posting-schedule-parts"

type Routine = ReturnType<typeof usePostingSchedule>

/** The settings themselves. Design goes here. */
function ScheduleSettingsBody({ routine }: { routine: Routine }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border-neutral-default p-6">
      {/* Placeholder until the design lands. `routine.draft` / `routine.setDraft`
          hold the weekly routine; `routine.save()` persists it. */}
      <p className="text-small text-text-neutral-default">הגדרות התזמון</p>
    </div>
  )
}

/** Inline — Settings → "תזמון". */
export function ScheduleSettings() {
  const routine = usePostingSchedule()
  return (
    <div className="flex flex-col gap-4">
      <ScheduleSettingsBody routine={routine} />
      <div className="flex">
        <Button size="sm" onClick={() => routine.save()} disabled={routine.saving}>
          שמירה
        </Button>
      </div>
    </div>
  )
}

/** Modal — the ⚙ in the calendar panel. */
export function ScheduleSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After a save, so the calendar can re-read the routine. */
  onSaved?: () => void
}) {
  const routine = usePostingSchedule()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>הגדרות תזמון</DialogTitle>
          <DialogDescription className="sr-only">הימים והשעות שבהם הפוסטים עולים</DialogDescription>
        </DialogHeader>
        <ScheduleSettingsBody routine={routine} />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={routine.saving}
            onClick={() =>
              routine.save(() => {
                onSaved?.()
                onOpenChange(false)
              })
            }
          >
            שמירה
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
