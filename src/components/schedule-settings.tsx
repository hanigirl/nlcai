"use client"

/**
 * Schedule settings — ONE component, two homes (Hani, 2026-10-29):
 *   - the modal behind the ⚙ next to "סידור אוטומטי בלוח" in the calendar
 *     panel (`ScheduleSettingsDialog`);
 *   - Settings → "תזמון" (`ScheduleSettings` inline).
 *
 * `ScheduleSettingsBody` holds the design. Two directions are under review
 * (`?variant=a|b`, default A) — see schedule-settings-variants.tsx. Review
 * links can land on a state with `&state=first|empty|error`.
 */

import { useMemo, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SaveErrorAlert,
  usePostingSchedule,
  type RoutineReviewState,
} from "@/components/posting-schedule-parts"
import { RulesSettings, WeekGridSettings } from "@/components/schedule-settings-variants"

type Routine = ReturnType<typeof usePostingSchedule>
export type ScheduleSettingsVariant = "a" | "b"

export type ScheduleReviewParams = {
  variant: ScheduleSettingsVariant
  state: RoutineReviewState | null
}

const REVIEW_STATES: RoutineReviewState[] = ["first", "empty", "error"]

/** `?variant=a|b&state=…`, read after mount (null until then). */
const noSubscribe = () => () => {}

export function useScheduleReviewParams(): ScheduleReviewParams | null {
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => null,
  )
  return useMemo(() => {
    if (search === null) return null
    const q = new URLSearchParams(search)
    const state = q.get("state") as RoutineReviewState | null
    return {
      variant: q.get("variant") === "b" ? "b" : "a",
      state: state && REVIEW_STATES.includes(state) ? state : null,
    }
  }, [search])
}

/** The settings themselves. */
function ScheduleSettingsBody({
  routine,
  variant,
}: {
  routine: Routine
  variant: ScheduleSettingsVariant
}) {
  const edit = { draft: routine.draft, onChange: routine.setDraft }
  return (
    <div className="flex flex-col gap-4">
      {!routine.hasCustom && (
        <p className="text-xs-body text-text-neutral-default">
          זו נקודת התחלה שהכנו לכם. מה שתגדירו כאן חל על כל הלוח.
        </p>
      )}
      {variant === "b" ? <RulesSettings {...edit} /> : <WeekGridSettings {...edit} />}
      {routine.saveError && <SaveErrorAlert onRetry={() => routine.save()} />}
    </div>
  )
}

function useRoutineFor(params: ScheduleReviewParams, persist: boolean) {
  return usePostingSchedule({ review: params.state, persist })
}

/** Inline — Settings → "תזמון". */
export function ScheduleSettings() {
  const params = useScheduleReviewParams()
  if (!params) return null
  return <ScheduleSettingsInline params={params} />
}

function ScheduleSettingsInline({ params }: { params: ScheduleReviewParams }) {
  const routine = useRoutineFor(params, true)
  return (
    <div className="flex flex-col gap-5">
      <ScheduleSettingsBody routine={routine} variant={params.variant} />
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
  persist = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After a save, so the calendar can re-read the routine. */
  onSaved?: () => void
  /** False on the state preview page — saves stay in memory. */
  persist?: boolean
}) {
  const params = useScheduleReviewParams()
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
            ככה הסידור האוטומטי מניח פוסטים על הלוח.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per open: a cancelled edit never comes back next time. */}
        {open && params && (
          <DialogInner
            params={params}
            persist={persist}
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

function DialogInner({
  params,
  persist,
  onDone,
  onCancel,
}: {
  params: ScheduleReviewParams
  persist: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const routine = useRoutineFor(params, persist)
  return (
    <>
      <ScheduleSettingsBody routine={routine} variant={params.variant} />
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
