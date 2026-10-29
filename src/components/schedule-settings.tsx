"use client"

/**
 * Schedule settings — ONE component, two homes (Hani, 2026-10-29):
 *   - the modal behind the ⚙ next to "סידור אוטומטי בלוח" in the calendar
 *     panel (`ScheduleSettingsDialog`);
 *   - Settings → "תזמון" (`ScheduleSettings` inline).
 *
 * The form itself is schedule-settings-form.tsx (direction B, picked by Hani).
 */

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SaveErrorAlert, usePostingSchedule } from "@/components/posting-schedule-parts"
import { ScheduleSettingsForm } from "@/components/schedule-settings-form"

type Routine = ReturnType<typeof usePostingSchedule>

/** Same line under the title in both homes (Hani, 2026-10-29). */
const SCHEDULE_SETTINGS_DESCRIPTION =
  "הסידור האוטומטי מניח פוסטים על הלוח. ההגדרות האלה הן ברירת המחדל, אבל מה שקובע הוא הסידור בלוח השנה."

/** The settings themselves. */
function ScheduleSettingsBody({ routine }: { routine: Routine }) {
  return (
    <div className="flex flex-col gap-4">
      {!routine.hasCustom && (
        <p className="text-xs-body text-text-neutral-default">
          זו נקודת התחלה שהכנו לכם. מה שתגדירו כאן חל על כל הלוח.
        </p>
      )}
      <ScheduleSettingsForm draft={routine.draft} onChange={routine.setDraft} />
      {routine.saveError && <SaveErrorAlert onRetry={() => routine.save()} />}
    </div>
  )
}

/** Inline — Settings → "תזמון". */
export function ScheduleSettings() {
  const routine = usePostingSchedule()
  return (
    <div className="flex flex-col gap-5">
      <p className="text-small text-text-neutral-default">{SCHEDULE_SETTINGS_DESCRIPTION}</p>
      <ScheduleSettingsBody routine={routine} />
      <div className="flex">
        <Button
          size="sm"
          disabled={routine.saving || (routine.hasCustom && !routine.dirty)}
          onClick={() => routine.save(() => toast("הגדרות התזמון נשמרו"))}
        >
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[92dvh] overflow-y-auto gap-5 p-4 sm:p-6 sm:max-w-3xl"
        // Land on the dialog itself, not on the first chip (it read as "selected").
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader className="text-start">
          <DialogTitle>הגדרות תזמון</DialogTitle>
          <DialogDescription className="text-small text-text-neutral-default">
            {SCHEDULE_SETTINGS_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per open: a cancelled edit never comes back next time. */}
        {open && (
          <DialogInner
            onDone={() => {
              onSaved?.()
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DialogInner({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const routine = usePostingSchedule()
  return (
    <>
      <ScheduleSettingsBody routine={routine} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={routine.saving || (routine.hasCustom && !routine.dirty)}
          onClick={() =>
            routine.save(() => {
              toast("הגדרות התזמון נשמרו")
              onDone()
            })
          }
        >
          שמירה
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </>
  )
}
