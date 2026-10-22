"use client"

/**
 * Shared building blocks for the weekly posting schedule (לו״ז פרסום),
 * edited in place on the calendar (Hani picked that, 2026-10-15).
 */

import { createElement, useCallback, useEffect, useState } from "react"
import { AlertCircle, Loader2, Trash2 } from "lucide-react"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { getFormatChipIcon, getFormatChipLabel } from "@/components/format-status-chip"
import {
  SCHEDULE_FORMATS,
  SCHEDULE_HOURS,
  STORY_GAP_OPTIONS,
  WEEKDAY_NAMES,
  cloneSchedule,
  defaultPostingSchedule,
  getPostingSchedule,
  newSlotId,
  savePostingSchedule,
  schedulesEqual,
  type PostingSchedule,
  type PostingSlot,
} from "@/lib/posting-schedule"

/* ------------------------------------------------------------------ */
/*  Slot editor — format + hour + remove                               */
/* ------------------------------------------------------------------ */

export function SlotEditor({
  slot,
  dayIndex,
  clash,
  stacked = false,
  onChange,
  onRemove,
}: {
  slot: PostingSlot
  dayIndex: number
  /** Another slot on this day shares the hour. */
  clash: boolean
  /** Narrow container (calendar column) → format above hour. */
  stacked?: boolean
  onChange: (next: PostingSlot) => void
  onRemove: () => void
}) {
  const day = WEEKDAY_NAMES[dayIndex]
  return (
    <div
      className={`flex gap-1.5 ${stacked ? "flex-col rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 p-1.5" : "items-center"}`}
    >
      <div className={stacked ? "w-full" : "w-44"}>
        <Select
          selectSize="small"
          variant="homepage"
          value={slot.format}
          onChange={(e) => onChange({ ...slot, format: e.target.value })}
          aria-label={`פורמט — יום ${day}`}
          className={stacked ? "text-xs pe-7 ps-2" : undefined}
        >
          {SCHEDULE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {getFormatChipLabel(f)}
            </option>
          ))}
        </Select>
      </div>
      <div className={`flex items-center gap-1 ${stacked ? "w-full" : ""}`}>
        <div className={stacked ? "flex-1 min-w-0" : "w-28"}>
          <Select
            selectSize="small"
            variant="homepage"
            value={slot.time}
            onChange={(e) => onChange({ ...slot, time: e.target.value })}
            aria-label={`שעה — יום ${day}`}
            aria-invalid={clash || undefined}
            className={`tabular-nums ${stacked ? "text-xs pe-7 ps-2" : ""}`}
          >
            {SCHEDULE_HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`הסרת פרסום — יום ${day}`}
          className="shrink-0 text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/** One-line read-only slot: icon + format + hour. Used for summaries and ghosts. */
export function SlotLabel({ slot, className = "" }: { slot: PostingSlot; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
      {createElement(getFormatChipIcon(slot.format), { className: "size-3.5 shrink-0", "aria-hidden": true })}
      <span className="truncate">{getFormatChipLabel(slot.format)}</span>
      <span className="tabular-nums shrink-0">{slot.time}</span>
    </span>
  )
}

export function StoryGapField({
  value,
  enabled,
  onChange,
  id = "story-gap",
}: {
  value: number
  /** False when no story slot exists — the setting has nothing to act on. */
  enabled: boolean
  onChange: (minutes: number) => void
  id?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs-body text-text-neutral-default whitespace-nowrap">
        מרווח בין פריימים בסטורי
      </label>
      <div className="w-32">
        <Select
          id={id}
          selectSize="small"
          variant="homepage"
          value={value}
          disabled={!enabled}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {STORY_GAP_OPTIONS.map((o) => (
            <option key={o.minutes} value={o.minutes}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

export function SaveErrorAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-red-90 bg-red-95 px-3 py-2 dark:border-red-90/25 dark:bg-red-95/10"
    >
      <AlertCircle className="size-4 shrink-0 text-button-danger-default" aria-hidden="true" />
      <p className="text-xs-body text-text-primary-default">
        הלו״ז לא נשמר. השינויים שלכם עדיין כאן.
      </p>
      <Button type="button" variant="outline" size="xs" onClick={onRetry} className="ms-auto">
        ניסיון נוסף
      </Button>
    </div>
  )
}

export function SaveButton({ saving, disabled, onClick }: { saving: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="sm" onClick={onClick} disabled={disabled || saving} className="gap-1.5">
      {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {saving ? "שומרים…" : "שמירת הלו״ז"}
    </Button>
  )
}

/* ------------------------------------------------------------------ */
/*  The saved routine                                                  */
/* ------------------------------------------------------------------ */

/**
 * The weekly routine as saved on this device (lib/posting-schedule). Until
 * she saves one, the suggested default shows and `hasCustom` is false.
 */
export function usePostingSchedule() {
  const [saved, setSaved] = useState<PostingSchedule>(() => defaultPostingSchedule())
  const [draft, setDraft] = useState<PostingSchedule>(() => cloneSchedule(saved))
  const [hasCustom, setHasCustom] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    const stored = getPostingSchedule()
    if (!stored) return
    setSaved(stored)
    setDraft(cloneSchedule(stored))
    setHasCustom(true)
  }, [])

  const save = useCallback((onDone?: () => void) => {
    setSaving(true)
    setSaveError(false)
    try {
      savePostingSchedule(draft)
      setSaved(cloneSchedule(draft))
      setHasCustom(true)
      onDone?.()
    } catch (err) {
      console.error("[posting-schedule] save failed", err)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }, [draft])

  const discard = useCallback(() => {
    setDraft(cloneSchedule(saved))
    setSaveError(false)
  }, [saved])

  return {
    saved,
    draft,
    setDraft,
    dirty: !schedulesEqual(saved, draft),
    hasCustom,
    saving,
    saveError,
    save,
    discard,
  }
}
