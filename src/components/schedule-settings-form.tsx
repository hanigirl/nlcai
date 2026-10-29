"use client"

/**
 * Schedule settings — the form (Hani picked direction B, 2026-10-29:
 * "כללים, ואז ימים").
 *
 * A quiet settings list for the default rules "סידור אוטומטי" follows:
 *   1. which weekdays we publish at all        (global: activeDays)
 *   2. how many posts a day may carry          (global: postsPerDay)
 *   3. default publishing hours                (global: defaultTimes)
 *   4. gap between publishing days             (global: gapDays)
 *   5. which format on which weekday           (per day, the list underneath)
 *
 * Hours: every post follows the global hour for its place in the day (1st
 * post → first hour, 2nd → second…). A single post can still get its own
 * hour from its picker; that's an exception, not the way in.
 */

import { createElement, useState, type ReactNode } from "react"
import { Check, Plus, Trash2 } from "lucide-react"
import { Chip } from "@/components/ui/chip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select } from "@/components/ui/select"
import { getFormatChipIcon, getFormatChipLabel } from "@/components/format-status-chip"
import { StoryGapField } from "@/components/posting-schedule-parts"
import {
  GAP_OPTIONS,
  MAX_POSTS_PER_DAY,
  SCHEDULE_FORMATS,
  SCHEDULE_HOURS,
  WEEKDAY_NAMES,
  activeDayCount,
  countSlots,
  usesStories,
  withDayActive,
  withDayPost,
  withGlobal,
  withPostTime,
  type PostingSchedule,
  type PostingSlot,
} from "@/lib/posting-schedule"

type Edit = { draft: PostingSchedule; onChange: (next: PostingSchedule) => void }

const GRAY_HOVER = "hover:bg-gray-95 dark:hover:bg-gray-20"
const ORDINALS = ["ראשון", "שני", "שלישי"]
const SHORT_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]

/* ------------------------------------------------------------------ */
/*  Shared controls                                                    */
/* ------------------------------------------------------------------ */

/** One choice out of a few — the existing chip, `selected` on the current one. */
function ChoiceChips<T extends number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Chip
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          selected={o.value === value}
          onClick={() => onChange(o.value)}
          className="tabular-nums"
        >
          {o.label}
        </Chip>
      ))}
    </div>
  )
}

const PER_DAY_OPTIONS = Array.from({ length: MAX_POSTS_PER_DAY }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
}))
const GAP_CHOICES = GAP_OPTIONS.map((o) => ({ value: o.days, label: o.label }))

function HourSelect({
  value,
  onChange,
  label,
  className = "",
}: {
  value: string
  onChange: (v: string) => void
  label: string
  className?: string
}) {
  return (
    <div className={className}>
      <Select
        selectSize="small"
        variant="homepage"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="tabular-nums"
      >
        {SCHEDULE_HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    </div>
  )
}

/**
 * The format of one post on one weekday. Empty → a dashed "+" to add one.
 * The popover: pick a format, optionally give this post its own hour, or
 * remove it.
 */
function PostPicker({
  draft,
  onChange,
  day,
  index,
  slot,
}: Edit & {
  day: number
  index: number
  slot?: PostingSlot
}) {
  const [open, setOpen] = useState(false)
  const dayName = WEEKDAY_NAMES[day]
  const globalHour = draft.defaultTimes[index]
  const ownHour = slot && !slot.inherit ? slot.time : null

  const trigger = slot ? (
    <button
      type="button"
      aria-label={`פורמט, יום ${dayName}, פוסט ${ORDINALS[index]}: ${getFormatChipLabel(slot.format)}`}
      className={`w-full min-w-0 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 text-text-primary-default transition-colors ${GRAY_HOVER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 flex h-9 items-center gap-1.5 px-2.5`}
    >
      {createElement(getFormatChipIcon(slot.format), {
        className: "size-4 shrink-0 text-text-neutral-default",
        "aria-hidden": true,
      })}
      <span className="truncate text-xs-body">{getFormatChipLabel(slot.format)}</span>
      {ownHour && (
        <span className="ms-auto tabular-nums text-xs-body text-text-neutral-default">
          {ownHour}
        </span>
      )}
    </button>
  ) : (
    <button
      type="button"
      aria-label={`הוספת פוסט, יום ${dayName}`}
      className={`flex w-full items-center justify-center rounded-lg border border-dashed border-border-neutral-default text-text-neutral-default transition-colors ${GRAY_HOVER} hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 h-9`}
    >
      <Plus className="size-4" aria-hidden />
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent dir="rtl" align="center" className="w-60 p-1.5">
        <p className="px-2 pt-1.5 pb-1 text-xs-body text-text-neutral-default">
          יום {dayName} · פוסט {ORDINALS[index]}
        </p>
        <ul role="listbox" aria-label="פורמט">
          {SCHEDULE_FORMATS.map((f) => {
            const on = slot?.format === f
            return (
              <li key={f}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onChange(withDayPost(draft, day, index, f))
                    setOpen(false)
                  }}
                  className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-small text-text-primary-default ${GRAY_HOVER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70`}
                >
                  {createElement(getFormatChipIcon(f), {
                    className: "size-4 text-text-neutral-default",
                    "aria-hidden": true,
                  })}
                  {getFormatChipLabel(f)}
                  {on && <Check className="ms-auto size-4" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
        {slot && (
          <>
            <div className="my-1.5 h-px bg-border-neutral-default" />
            <label className="flex items-center gap-2 px-2 py-1">
              <span className="text-xs-body text-text-neutral-default whitespace-nowrap">שעה</span>
              <Select
                selectSize="small"
                variant="homepage"
                value={ownHour ?? ""}
                onChange={(e) => onChange(withPostTime(draft, day, index, e.target.value || null))}
                className="tabular-nums"
              >
                <option value="">כמו בכל יום · {globalHour}</option>
                {SCHEDULE_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </label>
            <div className="my-1.5 h-px bg-border-neutral-default" />
            <button
              type="button"
              onClick={() => {
                onChange(withDayPost(draft, day, index, null))
                setOpen(false)
              }}
              className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-small text-text-neutral-default hover:text-text-primary-default ${GRAY_HOVER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70`}
            >
              <Trash2 className="size-4" aria-hidden />
              הסרת הפוסט
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The posts a weekday shows in the editor (never more than the daily cap). */
function visiblePosts(draft: PostingSchedule, day: number): PostingSlot[] {
  return draft.days[day].slice(0, draft.postsPerDay)
}

/** "5 פוסטים בשבוע · 4 ימי פרסום" — or why nothing will be placed. */
export function WeekSummary({ draft }: { draft: PostingSchedule }) {
  const n = countSlots(draft)
  const d = activeDayCount(draft)
  if (n === 0) {
    return (
      <p role="status" className="text-xs-body text-text-neutral-default">
        אין אף פוסט בשבוע, ולכן הסידור האוטומטי לא ישבץ כלום. בחרו לפחות יום פרסום אחד עם פורמט.
      </p>
    )
  }
  return (
    <p role="status" className="text-xs-body text-text-neutral-default tabular-nums">
      {n} פוסטים בשבוע · {d} ימי פרסום
      {draft.gapDays > 0 && ` · לפחות ${draft.gapDays === 1 ? "יום" : "יומיים"} בין ימי פרסום`}
    </p>
  )
}

function StoryGap({ draft, onChange }: Edit) {
  if (!usesStories(draft)) return null
  return (
    <StoryGapField
      id="schedule-story-gap"
      value={draft.storyGapMinutes}
      enabled
      onChange={(m) => onChange(withGlobal(draft, { storyGapMinutes: m }))}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  The form                                                           */
/* ------------------------------------------------------------------ */

function RuleRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 py-4 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-small text-text-primary-default">{label}</span>
        {hint && <span className="text-xs-body text-text-neutral-default">{hint}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function ScheduleSettingsForm({ draft, onChange }: Edit) {
  const days = [0, 1, 2, 3, 4, 5, 6]
  const active = days.filter((d) => draft.activeDays[d])
  const rows = Array.from({ length: draft.postsPerDay }, (_, i) => i)

  return (
    <div className="flex flex-col divide-y divide-border-neutral-default">
      <RuleRow label="באילו ימים מפרסמים?">
        <div role="group" aria-label="ימי פרסום" className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <Chip
              key={d}
              selected={draft.activeDays[d]}
              onClick={() => onChange(withDayActive(draft, d, !draft.activeDays[d]))}
              aria-label={WEEKDAY_NAMES[d]}
            >
              <span className="sm:hidden">{SHORT_DAYS[d]}</span>
              <span className="hidden sm:inline">{WEEKDAY_NAMES[d]}</span>
            </Chip>
          ))}
        </div>
      </RuleRow>

      <RuleRow label="כמה פוסטים ביום?" hint="לכל היותר">
        <ChoiceChips
          label="פוסטים ביום"
          value={draft.postsPerDay}
          options={PER_DAY_OPTIONS}
          onChange={(v) => onChange(withGlobal(draft, { postsPerDay: v }))}
        />
      </RuleRow>

      <RuleRow label="כמה ימי רווח בין פוסט לפוסט?">
        <ChoiceChips
          label="ימי רווח בין פוסט לפוסט"
          value={draft.gapDays}
          options={GAP_CHOICES}
          onChange={(v) => onChange(withGlobal(draft, { gapDays: v }))}
        />
      </RuleRow>

      <RuleRow label="באיזו שעה מפרסמים?" hint="לכל הלוח">
        <div className="flex flex-wrap items-center gap-2">
          {rows.map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              {draft.postsPerDay > 1 && (
                <span className="text-xs-body text-text-neutral-default">פוסט {ORDINALS[i]}</span>
              )}
              <HourSelect
                className="w-24"
                value={draft.defaultTimes[i]}
                label={`שעת הפוסט ה${ORDINALS[i]} בכל יום`}
                onChange={(t) => onChange(withGlobal(draft, { timeIndex: i, time: t }))}
              />
            </div>
          ))}
        </div>
      </RuleRow>

      <RuleRow label="מה עולה בכל יום?">
        {active.length === 0 ? (
          <p className="text-xs-body text-text-neutral-default">
            בחרו קודם ימי פרסום, ואז הפורמט של כל יום יופיע כאן.
          </p>
        ) : (
          <ul className="flex max-w-md flex-col gap-1.5">
            {active.map((d) => {
              const posts = visiblePosts(draft, d)
              return (
                <li
                  key={d}
                  className="grid items-center gap-1.5"
                  style={{ gridTemplateColumns: `3.5rem repeat(${draft.postsPerDay}, minmax(0, 1fr))` }}
                >
                  <span className="text-small text-text-primary-default">{WEEKDAY_NAMES[d]}</span>
                  {rows.map((i) =>
                    i <= posts.length ? (
                      <PostPicker key={i} draft={draft} onChange={onChange} day={d} index={i} slot={posts[i]} />
                    ) : (
                      <span key={i} />
                    ),
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </RuleRow>

      {usesStories(draft) && (
        <RuleRow label="סטורי">
          <StoryGap draft={draft} onChange={onChange} />
        </RuleRow>
      )}

      <div className="pt-4">
        <WeekSummary draft={draft} />
      </div>
    </div>
  )
}
