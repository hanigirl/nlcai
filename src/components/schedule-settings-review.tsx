"use client"

/**
 * "הגדרות התזמון" — both review directions (`?schedset=a|b`), one file so
 * the calendar and Settings mount the very same body.
 *
 *   A — rules form (Hani's direction): days · default hour · posts a day ·
 *       optional format-per-day. The modal opens on a read-only summary
 *       ("what goes out when"), "עריכה" turns it into the form.
 *   B — slot template: one sample week of explicit (format, hour) chips,
 *       edited directly; the calendar's day headers quietly echo it.
 *
 * Review only. Nothing persists, nothing is fetched: saves are simulated.
 */

import { createElement, useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  CalendarClock,
  ChevronDown,
  Info,
  Minus,
  Plus,
  Settings2,
  Shuffle,
  Sparkles,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { getFormatChipIcon, getFormatChipLabel } from "@/components/format-status-chip"
import { SaveButton, SaveErrorAlert, StoryGapField } from "@/components/posting-schedule-parts"
import {
  SCHEDULE_FORMATS,
  SCHEDULE_HOURS,
  WEEKDAY_NAMES,
  clashingSlotIds,
  cloneSchedule,
  schedulesEqual,
  withSlotAdded,
  withSlotRemoved,
  withSlotUpdated,
  type PostingSchedule,
  type PostingSlot,
} from "@/lib/posting-schedule"
import {
  GAP_HOUR_OPTIONS,
  MAX_POSTS_PER_DAY,
  SCHEDSET_STATES,
  activeDays,
  clashTemplate,
  defaultRules,
  emptyRules,
  emptyTemplate,
  rulesEqual,
  rulesSummary,
  runsPastNight,
  sampleSavedRules,
  sampleSavedTemplate,
  templateSummary,
  timesFor,
  withPostsPerDay,
  writeStateParam,
  type DayFormat,
  type ScheduleRules,
  type SchedsetState,
  type SchedsetVariant,
} from "@/lib/schedule-settings-review"

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

function formatLabel(f: DayFormat): string {
  return f === "any" ? "כל פורמט" : getFormatChipLabel(f)
}

function FormatName({ format, time, muted = false }: { format: DayFormat; time?: string; muted?: boolean }) {
  const icon = format === "any" ? Shuffle : getFormatChipIcon(format)
  return (
    <span
      className={`inline-flex items-center gap-1 min-w-0 ${muted ? "text-text-neutral-default" : "text-text-primary-default"}`}
    >
      {createElement(icon, { className: "size-3.5 shrink-0", "aria-hidden": true })}
      <span className="truncate">{formatLabel(format)}</span>
      {time && <span className="tabular-nums shrink-0 text-text-neutral-default">{time}</span>}
    </span>
  )
}

/** The rule Hani set: the board wins over the settings. */
function BoardWinsNote() {
  return (
    <p className="flex items-start gap-1.5 text-xs-body text-text-neutral-default">
      <Info className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        הלוח הוא הקובע. ההגדרות משמשות רק לסידור האוטומטי, וכל פוסט שתזיזו ידנית בלוח נשאר בדיוק איפה ששמתם אותו.
      </span>
    </p>
  )
}

function FirstTimeNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-yellow-80 bg-bg-surface-primary-default px-3 py-2 dark:border-yellow-30">
      <Sparkles className="size-4 mt-0.5 shrink-0 text-yellow-30 dark:text-yellow-80" aria-hidden="true" />
      <p className="text-xs-body text-text-primary-default">{text}</p>
    </div>
  )
}

function NoDaysNote() {
  return (
    <p role="status" className="flex items-start gap-1.5 text-xs-body text-text-primary-default">
      <Info className="size-3.5 mt-0.5 shrink-0 text-yellow-30" aria-hidden="true" />
      <span>לא נבחר אף יום. בלי ימי פרסום הסידור האוטומטי לא יוכל לפזר פוסטים, אבל הלוח עצמו ממשיך לעבוד כרגיל.</span>
    </p>
  )
}

/** Review-only strip: jump between states without driving the flow. */
export function ReviewStateBar({
  variant,
  state,
  onState,
  hideClosed = false,
  className = "",
}: {
  variant: SchedsetVariant
  state: SchedsetState
  onState: (s: SchedsetState) => void
  hideClosed?: boolean
  className?: string
}) {
  const states = SCHEDSET_STATES[variant].filter((s) => !(hideClosed && s.id === "closed"))
  return (
    <div className={`flex items-center gap-1.5 flex-wrap rounded-lg border border-dashed border-gray-80 px-2 py-1.5 ${className}`}>
      <span className="text-xs-body text-text-neutral-default">סקירה · הצעה {variant === "a" ? "א׳" : "ב׳"}:</span>
      {states.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={state === s.id}
          onClick={() => onState(s.id)}
          className={`rounded-md px-2 py-0.5 text-xs-body cursor-pointer ${
            state === s.id
              ? "bg-bg-surface-primary-default text-text-primary-default font-semibold"
              : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  The review model — one per surface                                 */
/* ------------------------------------------------------------------ */

type Model = ReturnType<typeof useReviewModel>

function seedRules(state: SchedsetState): ScheduleRules {
  if (state === "first") return defaultRules()
  if (state === "empty") return emptyRules()
  return sampleSavedRules()
}

function seedTemplate(state: SchedsetState): PostingSchedule {
  if (state === "empty") return emptyTemplate()
  if (state === "clash") return clashTemplate()
  return sampleSavedTemplate()
}

/** saving/error need something to save → a small change on top of the seed. */
function draftRules(state: SchedsetState): ScheduleRules {
  const r = seedRules(state)
  return state === "saving" || state === "error" ? { ...r, defaultTime: "10:00" } : r
}
function draftTemplate(state: SchedsetState): PostingSchedule {
  const t = seedTemplate(state)
  return state === "saving" || state === "error" ? withSlotAdded(t, 3) : t
}

/** B's saved week, shared with the calendar's day-header hints. */
let templateStore: PostingSchedule = sampleSavedTemplate()
const templateListeners = new Set<() => void>()
function setTemplateStore(s: PostingSchedule) {
  templateStore = cloneSchedule(s)
  templateListeners.forEach((l) => l())
}
function useTemplateStore(): PostingSchedule {
  return useSyncExternalStore(
    (l) => {
      templateListeners.add(l)
      return () => templateListeners.delete(l)
    },
    () => templateStore,
    () => templateStore,
  )
}

export function useReviewModel(variant: SchedsetVariant, initial: SchedsetState) {
  const [state, setStateRaw] = useState<SchedsetState>(initial)
  const [savedRules, setSavedRules] = useState(() => seedRules(initial))
  const [rules, setRules] = useState(() => draftRules(initial))
  const [savedTemplate, setSavedTemplate] = useState(() => seedTemplate(initial))
  const [template, setTemplate] = useState(() => draftTemplate(initial))
  const [editing, setEditing] = useState(initial === "edit" || initial === "empty" || initial === "saving" || initial === "error")
  const [saving, setSaving] = useState(initial === "saving")
  const [saveError, setSaveError] = useState(initial === "error")

  useEffect(() => {
    if (variant === "b") setTemplateStore(savedTemplate)
  }, [variant, savedTemplate])

  const applyState = useCallback((s: SchedsetState) => {
    setStateRaw(s)
    writeStateParam(s)
    // "first" = never saved: the default shows as the saved value, nothing dirty.
    setSavedRules(seedRules(s))
    setSavedTemplate(seedTemplate(s))
    setRules(draftRules(s))
    setTemplate(draftTemplate(s))
    setEditing(s === "edit" || s === "empty" || s === "saving" || s === "error")
    setSaving(s === "saving")
    setSaveError(s === "error")
  }, [])

  const dirty = variant === "a" ? !rulesEqual(rules, savedRules) : !schedulesEqual(template, savedTemplate)
  const clashes = variant === "b" && clashingSlotIds(template).size > 0

  const save = useCallback(
    (onDone?: () => void) => {
      setSaving(true)
      setSaveError(false)
      // Simulated — the review never writes. The "error" state's retry succeeds.
      window.setTimeout(() => {
        setSaving(false)
        setSavedRules(rules)
        setSavedTemplate(cloneSchedule(template))
        setEditing(false)
        onDone?.()
      }, 700)
    },
    [rules, template],
  )

  const discard = useCallback(() => {
    setRules(savedRules)
    setTemplate(cloneSchedule(savedTemplate))
    setSaveError(false)
    setEditing(false)
  }, [savedRules, savedTemplate])

  return {
    variant,
    state,
    applyState,
    rules,
    setRules,
    savedRules,
    template,
    setTemplate,
    savedTemplate,
    editing,
    setEditing,
    saving,
    saveError,
    dirty,
    clashes,
    save,
    discard,
  }
}

/* ------------------------------------------------------------------ */
/*  Variant A — rules                                                  */
/* ------------------------------------------------------------------ */

/** Read-only: what goes out on which day. The quick look Nataliya asked for. */
function RulesSummaryView({ rules }: { rules: ScheduleRules }) {
  const times = timesFor(rules)
  return (
    <ul className="flex flex-col divide-y divide-border-neutral-default rounded-xl border border-border-neutral-default">
      {WEEKDAY_NAMES.map((name, d) => (
        <li key={name} className="flex items-center gap-3 px-3 py-2 min-h-10">
          <span className={`w-14 shrink-0 text-small ${rules.days[d] ? "text-text-primary-default font-semibold" : "text-text-neutral-default"}`}>
            {name}
          </span>
          {rules.days[d] ? (
            <span className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs-body min-w-0">
              {times.map((t, i) => (
                <FormatName key={i} format={rules.dayFormats[d]?.[i] ?? "any"} time={t} />
              ))}
            </span>
          ) : (
            <span className="text-xs-body text-text-neutral-default">לא מפרסמים</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function FieldLabel({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={htmlFor} className="text-small-bold text-text-primary-default">
        {children}
      </label>
      {hint && <p className="text-xs-body text-text-neutral-default">{hint}</p>}
    </div>
  )
}

function RulesForm({ rules, onChange, idPrefix }: { rules: ScheduleRules; onChange: (r: ScheduleRules) => void; idPrefix: string }) {
  const times = timesFor(rules)
  const [advancedOpen, setAdvancedOpen] = useState(rules.dayFormats.some((d) => d.some((f) => f !== "any")))
  return (
    <div className="flex flex-col gap-5">
      {/* 1 — days */}
      <section className="flex flex-col gap-2">
        <FieldLabel hint="ימים שלא תבחרו, למשל שישי ושבת, יישארו ריקים בסידור האוטומטי.">ימי פרסום</FieldLabel>
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="ימי פרסום">
          {WEEKDAY_NAMES.map((name, d) => {
            const on = rules.days[d]
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...rules, days: rules.days.map((x, i) => (i === d ? !x : x)) })}
                className={`h-8 rounded-lg border px-3 text-small cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                  on
                    ? "border-yellow-50 bg-bg-surface-primary-default text-text-primary-default font-semibold"
                    : "border-border-neutral-default bg-white text-text-neutral-default hover:bg-gray-95 dark:bg-transparent dark:hover:bg-gray-20"
                }`}
              >
                {name}
              </button>
            )
          })}
        </div>
        {activeDays(rules) === 0 && <NoDaysNote />}
      </section>

      {/* 2 — hour + posts a day */}
      <section className="flex gap-6 flex-wrap">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={`${idPrefix}-time`}>שעת פרסום</FieldLabel>
          <div className="w-28">
            <Select
              id={`${idPrefix}-time`}
              selectSize="small"
              variant="homepage"
              value={rules.defaultTime}
              onChange={(e) => onChange({ ...rules, defaultTime: e.target.value })}
              className="tabular-nums"
            >
              {SCHEDULE_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel>פוסטים ביום</FieldLabel>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="פוסט אחד פחות ביום"
              disabled={rules.postsPerDay <= 1}
              onClick={() => onChange(withPostsPerDay(rules, rules.postsPerDay - 1))}
            >
              <Minus className="size-4" />
            </Button>
            <span className="w-6 text-center text-small-bold tabular-nums text-text-primary-default" aria-live="polite">
              {rules.postsPerDay}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="פוסט נוסף ביום"
              disabled={rules.postsPerDay >= MAX_POSTS_PER_DAY}
              onClick={() => onChange(withPostsPerDay(rules, rules.postsPerDay + 1))}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        {rules.postsPerDay > 1 && (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={`${idPrefix}-gap`}>מרווח בין הפוסטים</FieldLabel>
            <div className="w-28">
              <Select
                id={`${idPrefix}-gap`}
                selectSize="small"
                variant="homepage"
                value={rules.gapHours}
                onChange={(e) => onChange({ ...rules, gapHours: Number(e.target.value) })}
              >
                {GAP_HOUR_OPTIONS.map((o) => (
                  <option key={o.hours} value={o.hours}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </section>
      <p className="text-xs-body text-text-neutral-default -mt-3">
        בכל יום פרסום: <span className="tabular-nums">{times.join(" · ")}</span>
        {runsPastNight(rules) && " (הפוסט האחרון לא יעבור את 23:00)"}
      </p>

      {/* 3 — advanced: format per day */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 text-small-bold text-text-primary-default cursor-pointer rounded-md hover:bg-gray-95 dark:hover:bg-gray-20 px-1 -mx-1"
          >
            <ChevronDown className={`size-4 transition-transform ${advancedOpen ? "" : "rotate-90"}`} aria-hidden="true" />
            מתקדם: פורמט קבוע לכל יום
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 flex flex-col gap-2">
          <p className="text-xs-body text-text-neutral-default">
            למשל קרוסלה בשלישי ודיבור למצלמה בראשון. ״כל פורמט״ אומר שהסידור האוטומטי ישים שם מה שמוכן.
          </p>
          {activeDays(rules) === 0 ? (
            <p className="text-xs-body text-text-neutral-default">בחרו קודם ימי פרסום.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {WEEKDAY_NAMES.map((name, d) =>
                rules.days[d] ? (
                  <div key={name} className="flex items-center gap-2 flex-wrap">
                    <span className="w-14 shrink-0 text-small text-text-primary-default">{name}</span>
                    {times.map((t, i) => (
                      <div key={i} className="w-48">
                        <Select
                          selectSize="small"
                          variant="homepage"
                          value={rules.dayFormats[d]?.[i] ?? "any"}
                          aria-label={`פורמט — ${name} ${t}`}
                          onChange={(e) =>
                            onChange({
                              ...rules,
                              dayFormats: rules.dayFormats.map((row, di) =>
                                di === d ? row.map((f, pi) => (pi === i ? e.target.value : f)) : row,
                              ),
                            })
                          }
                        >
                          <option value="any">{rules.postsPerDay > 1 ? `${t} · כל פורמט` : "כל פורמט"}</option>
                          {SCHEDULE_FORMATS.map((f) => (
                            <option key={f} value={f}>
                              {rules.postsPerDay > 1 ? `${t} · ${getFormatChipLabel(f)}` : getFormatChipLabel(f)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <StoryGapField
        id={`${idPrefix}-story-gap`}
        value={rules.storyGapMinutes}
        enabled
        onChange={(m) => onChange({ ...rules, storyGapMinutes: m })}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Variant B — the sample week                                        */
/* ------------------------------------------------------------------ */

function SlotChip({
  slot,
  dayIndex,
  clash,
  onChange,
  onRemove,
}: {
  slot: PostingSlot
  dayIndex: number
  clash: boolean
  onChange: (s: PostingSlot) => void
  onRemove: () => void
}) {
  const day = WEEKDAY_NAMES[dayIndex]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${getFormatChipLabel(slot.format)} ${slot.time}, ${day} — עריכה`}
          className={`w-full rounded-lg border bg-white dark:bg-gray-10 px-2 py-1.5 text-xs-body text-start cursor-pointer hover:bg-gray-95 dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
            clash ? "border-button-danger-default" : "border-border-neutral-default"
          }`}
        >
          <span className="flex flex-col gap-0.5">
            <FormatName format={slot.format} />
            <span className={`tabular-nums ${clash ? "text-button-danger-default" : "text-text-neutral-default"}`}>{slot.time}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="center" className="w-60 p-3 flex flex-col gap-2 text-right">
        <p className="text-small-bold text-text-primary-default">{day}</p>
        <Select
          selectSize="small"
          variant="homepage"
          value={slot.format}
          aria-label={`פורמט — יום ${day}`}
          onChange={(e) => onChange({ ...slot, format: e.target.value })}
        >
          {SCHEDULE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {getFormatChipLabel(f)}
            </option>
          ))}
        </Select>
        <Select
          selectSize="small"
          variant="homepage"
          value={slot.time}
          aria-label={`שעה — יום ${day}`}
          aria-invalid={clash || undefined}
          className="tabular-nums"
          onChange={(e) => onChange({ ...slot, time: e.target.value })}
        >
          {SCHEDULE_HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={onRemove} className="gap-1.5 self-start">
          <Trash2 className="size-4" aria-hidden="true" />
          הסרה מהשבוע
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function TemplateWeek({ template, onChange }: { template: PostingSchedule; onChange: (s: PostingSchedule) => void }) {
  const clashes = clashingSlotIds(template)
  return (
    <div className="grid grid-cols-7 rounded-xl border border-border-neutral-default overflow-hidden">
      {WEEKDAY_NAMES.map((name, d) => {
        const slots = [...template.days[d]].sort((a, b) => a.time.localeCompare(b.time))
        return (
          <div
            key={name}
            className={`flex flex-col min-w-0 ${d < 6 ? "border-l border-border-neutral-default" : ""}`}
          >
            <div className="px-2 py-1.5 text-center text-xs-body text-text-neutral-default bg-bg-surface border-b border-border-neutral-default">
              {name}
            </div>
            <div className="flex flex-col gap-1.5 p-1.5 min-h-36">
              {slots.length === 0 && (
                <p className="text-xs-body text-text-neutral-default text-center py-2">לא מפרסמים</p>
              )}
              {slots.map((slot) => (
                <SlotChip
                  key={slot.id}
                  slot={slot}
                  dayIndex={d}
                  clash={clashes.has(slot.id)}
                  onChange={(next) => onChange(withSlotUpdated(template, d, next))}
                  onRemove={() => onChange(withSlotRemoved(template, d, slot.id))}
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`הוספת פרסום — יום ${name}`}
                onClick={() => onChange(withSlotAdded(template, d))}
                className="w-full border border-dashed border-gray-80 text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Body — the same in the modal and in Settings                       */
/* ------------------------------------------------------------------ */

function SettingsBody({ m, idPrefix }: { m: Model; idPrefix: string }) {
  if (m.variant === "a") {
    return (
      <div className="flex flex-col gap-4">
        {m.state === "first" && (
          <FirstTimeNote text="עוד לא קבעתם מתי לפרסם, אז שמנו לו״ז מוצע: ראשון עד חמישי ב-09:00, פוסט אחד ביום. אפשר לשנות בכל רגע." />
        )}
        {m.editing ? (
          <RulesForm rules={m.rules} onChange={m.setRules} idPrefix={idPrefix} />
        ) : (
          <>
            <p className="text-small text-text-neutral-default">{rulesSummary(m.savedRules)}</p>
            <RulesSummaryView rules={m.savedRules} />
          </>
        )}
        <BoardWinsNote />
        {m.saveError && <SaveErrorAlert onRetry={() => m.save()} />}
      </div>
    )
  }
  const noDays = m.template.days.every((d) => d.length === 0)
  return (
    <div className="flex flex-col gap-3">
      {m.state === "first" && (
        <FirstTimeNote text="עוד לא קבעתם מתי לפרסם, אז שמנו שבוע מוצע. לחצו על פרסום כדי לשנות פורמט או שעה, או על + כדי להוסיף." />
      )}
      <p className="text-small text-text-neutral-default">{templateSummary(m.template)}</p>
      <TemplateWeek template={m.template} onChange={m.setTemplate} />
      {noDays && <NoDaysNote />}
      {m.clashes && (
        <p role="status" className="text-xs-body text-button-danger-default">
          יש יום עם שני פרסומים באותה שעה. שנו את אחת השעות כדי לשמור.
        </p>
      )}
      <StoryGapField
        id={`${idPrefix}-story-gap`}
        value={m.template.storyGapMinutes}
        enabled={m.template.days.some((d) => d.some((x) => x.format === "story"))}
        onChange={(v) => m.setTemplate({ ...m.template, storyGapMinutes: v })}
      />
      <BoardWinsNote />
      {m.saveError && <SaveErrorAlert onRetry={() => m.save()} />}
    </div>
  )
}

function BodyActions({ m, onCancel, onSaved }: { m: Model; onCancel?: () => void; onSaved?: () => void }) {
  if (m.variant === "a" && !m.editing) {
    return (
      <Button type="button" size="sm" onClick={() => m.setEditing(true)} className="gap-1.5">
        <Settings2 className="size-4" aria-hidden="true" />
        עריכת ההגדרות
      </Button>
    )
  }
  return (
    <>
      <SaveButton saving={m.saving} disabled={!m.dirty || m.clashes} onClick={() => m.save(onSaved)} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={m.saving}
        onClick={() => {
          m.discard()
          onCancel?.()
        }}
      >
        ביטול
      </Button>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Calendar — trigger + floating modal                                */
/* ------------------------------------------------------------------ */

/**
 * Replaces the "לו״ז קבוע" button in the week-nav row under `?schedset`.
 * Opens straight away on review links (land on the surface, no clicks).
 */
export function CalendarScheduleSettings({
  variant,
  initialState,
}: {
  variant: SchedsetVariant
  initialState: SchedsetState
}) {
  const m = useReviewModel(variant, initialState)
  const [open, setOpen] = useState(initialState !== "closed")
  const settingsHref = `/settings?tab=schedule&schedset=${variant}`
  const summary = variant === "a" ? rulesSummary(m.savedRules) : templateSummary(m.savedTemplate)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <CalendarClock className="size-4" aria-hidden="true" />
        הגדרות תזמון
        <span className="text-text-neutral-default">· {summary}</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && m.editing && variant === "a") m.discard()
          setOpen(o)
        }}
      >
        <DialogContent
          dir="rtl"
          className={`text-right max-h-[calc(100vh-4rem)] overflow-y-auto ${variant === "b" ? "sm:max-w-4xl" : "sm:max-w-xl"}`}
        >
          <ReviewStateBar
            className="me-8"
            variant={variant}
            state={m.state}
            onState={(s) => {
              m.applyState(s)
              if (s === "closed") setOpen(false)
            }}
          />
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle>הגדרות תזמון</DialogTitle>
            <DialogDescription>
              {variant === "a"
                ? "באילו ימים ובאיזו שעה מפרסמים. לפי זה הסידור האוטומטי מפזר את הפוסטים בלוח."
                : "השבוע הקבוע שלכם: איזה פורמט יוצא באיזה יום ובאיזו שעה. לפי זה הסידור האוטומטי מפזר את הפוסטים בלוח."}
            </DialogDescription>
          </DialogHeader>
          <SettingsBody m={m} idPrefix={`modal-${variant}`} />
          <DialogFooter className="gap-2 sm:justify-start items-center">
            <BodyActions m={m} onSaved={() => (variant === "b" ? setOpen(false) : undefined)} />
            <Link
              href={settingsHref}
              className="ms-auto text-xs-body text-text-neutral-default underline underline-offset-2 hover:text-text-primary-default"
            >
              גם בהגדרות ← תזמון
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** B only: the day's slots, quietly under the date in the board's header. */
export function DayHeaderRoutineHint({ dayIndex }: { dayIndex: number }) {
  const t = useTemplateStore()
  const slots = [...t.days[dayIndex]].sort((a, b) => a.time.localeCompare(b.time))
  if (slots.length === 0) return <div className="text-[11px] leading-4 text-text-neutral-default mt-0.5">—</div>
  return (
    <div className="flex flex-col items-center mt-0.5 text-[11px] leading-4 text-text-neutral-default">
      {slots.map((s) => (
        <span key={s.id} className="truncate max-w-full">
          {getFormatChipLabel(s.format)} <span className="tabular-nums">{s.time}</span>
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Settings → תזמון                                                   */
/* ------------------------------------------------------------------ */

export function ScheduleSettingsTab({ variant, initialState }: { variant: SchedsetVariant; initialState: SchedsetState }) {
  const start = initialState === "closed" ? "view" : initialState
  const m = useReviewModel(variant, start)
  return (
    <div className={`flex flex-col gap-5 ${variant === "b" ? "max-w-4xl" : "max-w-xl"}`}>
      <ReviewStateBar variant={variant} state={m.state} onState={m.applyState} hideClosed />
      <div className="flex flex-col gap-1">
        <h3 className="text-text-primary-default">הגדרות תזמון</h3>
        <p className="text-small text-text-neutral-default">
          {variant === "a"
            ? "באילו ימים ובאיזו שעה מפרסמים. אותן הגדרות נפתחות גם מתוך היומן."
            : "השבוע הקבוע שלכם. אותו שבוע נפתח גם מתוך היומן."}
        </p>
      </div>
      <SettingsBody m={m} idPrefix={`page-${variant}`} />
      <div className="flex items-center gap-2">
        <BodyActions m={m} />
      </div>
    </div>
  )
}
