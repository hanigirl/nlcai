/**
 * "הגדרות התזמון" — review harness for the two directions (`?schedset=a|b`).
 *
 * Hani, 29.10.2026: the weekly routine drawn on the calendar (ghost slots +
 * the board turning into an editor) is ugly. Scheduling settings belong in
 * Settings → "תזמון", and the calendar opens the same settings as a floating
 * modal instead of throwing her to Settings. The calendar is the source of
 * truth; the settings only feed the automatic arrangement.
 *
 *   A — her direction: a RULES form. Publishing days, one default hour,
 *       how many posts a day (+ the gap between them), and an optional
 *       "advanced" format-per-day. Default format = "any".
 *   B — alternative: a SLOT TEMPLATE. One sample week where every slot is an
 *       explicit (format, hour) chip, edited directly — no view/edit mode.
 *
 * Nothing here persists: the review never calls savePostingSchedule, never
 * hits the network. Saves are simulated in component state.
 */

import { useEffect, useState } from "react"
import {
  WEEKDAY_NAMES,
  defaultPostingSchedule,
  newSlotId,
  type PostingSchedule,
} from "@/lib/posting-schedule"
import type { FormatId } from "@/lib/timing-storage"

export type SchedsetVariant = "a" | "b"

/** Review states, in toggle order. Each has its own `&state=` link. */
export type SchedsetState =
  | "view" // saved settings, read-only summary (A) / the week (B)
  | "edit" // A only: the form open
  | "first" // never set — the suggested default
  | "empty" // no publishing day chosen
  | "clash" // B only: two slots on the same day + hour
  | "saving"
  | "error"
  | "closed" // the calendar with the modal closed (just the trigger)

export const SCHEDSET_STATES: Record<SchedsetVariant, { id: SchedsetState; label: string }[]> = {
  a: [
    { id: "view", label: "תצוגה" },
    { id: "edit", label: "עריכה" },
    { id: "first", label: "פעם ראשונה" },
    { id: "empty", label: "בלי ימים" },
    { id: "saving", label: "שומרים" },
    { id: "error", label: "שגיאה" },
    { id: "closed", label: "סגור" },
  ],
  b: [
    { id: "view", label: "השבוע הקבוע" },
    { id: "first", label: "פעם ראשונה" },
    { id: "empty", label: "בלי ימים" },
    { id: "clash", label: "שעה כפולה" },
    { id: "saving", label: "שומרים" },
    { id: "error", label: "שגיאה" },
    { id: "closed", label: "סגור" },
  ],
}

function readParams(): { variant: SchedsetVariant | null; state: SchedsetState } {
  if (typeof window === "undefined") return { variant: null, state: "view" }
  const sp = new URLSearchParams(window.location.search)
  const v = sp.get("schedset")
  const variant = v === "a" || v === "b" ? v : null
  const s = sp.get("state") as SchedsetState | null
  const allowed = variant ? SCHEDSET_STATES[variant].map((x) => x.id) : []
  return { variant, state: s && allowed.includes(s) ? s : "view" }
}

/**
 * `?schedset=a|b` + `&state=…`. Read after mount from window.location (the
 * calendar deliberately avoids useSearchParams → no Suspense boundary).
 * null = param absent → production renders untouched.
 */
export function useSchedsetParams() {
  const [p, setP] = useState<{ variant: SchedsetVariant | null; state: SchedsetState }>({
    variant: null,
    state: "view",
  })
  useEffect(() => {
    setP(readParams())
  }, [])
  return p
}

/** Keep `&state=` in the address bar in step with the review toggle. */
export function writeStateParam(state: SchedsetState) {
  const url = new URL(window.location.href)
  url.searchParams.set("state", state)
  window.history.replaceState(null, "", url.toString())
}

/* ------------------------------------------------------------------ */
/*  Variant A — the rules model                                        */
/* ------------------------------------------------------------------ */

/** "any" = no fixed format that day; the arrangement picks what's ready. */
export type DayFormat = FormatId | "any"

export type ScheduleRules = {
  /** Index 0 = Sunday … 6 = Saturday. */
  days: boolean[]
  /** "HH:00" — the first post of the day. */
  defaultTime: string
  /** 1–3 posts on each publishing day. */
  postsPerDay: number
  /** Hours between posts on the same day (only when postsPerDay > 1). */
  gapHours: number
  /** Advanced: per day, per post — the format, or "any". */
  dayFormats: DayFormat[][]
  /** Minutes between frames of a multi-frame story. */
  storyGapMinutes: number
}

export const GAP_HOUR_OPTIONS = [
  { hours: 1, label: "שעה" },
  { hours: 2, label: "שעתיים" },
  { hours: 3, label: "3 שעות" },
  { hours: 4, label: "4 שעות" },
  { hours: 6, label: "6 שעות" },
]

export const MAX_POSTS_PER_DAY = 3

function fill(n: number, from: DayFormat[] = []): DayFormat[] {
  return Array.from({ length: n }, (_, i) => from[i] ?? "any")
}

/** Sunday–Thursday, 09:00, one post, any format — Noa's "4–6 a week, no Shabbat". */
export function defaultRules(): ScheduleRules {
  return {
    days: [true, true, true, true, true, false, false],
    defaultTime: "09:00",
    postsPerDay: 1,
    gapHours: 3,
    dayFormats: Array.from({ length: 7 }, () => fill(1)),
    storyGapMinutes: 15,
  }
}

/** What a user who already tuned things might have: 2 a day, carousel on Tuesday. */
export function sampleSavedRules(): ScheduleRules {
  return {
    days: [true, true, true, false, true, false, false],
    defaultTime: "09:00",
    postsPerDay: 2,
    gapHours: 3,
    dayFormats: [
      ["talking_head", "any"],
      ["any", "story"],
      ["carousel", "any"],
      ["any", "any"],
      ["talking_head", "story"],
      ["any", "any"],
      ["any", "any"],
    ],
    storyGapMinutes: 15,
  }
}

export function emptyRules(): ScheduleRules {
  return { ...sampleSavedRules(), days: [false, false, false, false, false, false, false] }
}

export function withPostsPerDay(r: ScheduleRules, n: number): ScheduleRules {
  const postsPerDay = Math.max(1, Math.min(MAX_POSTS_PER_DAY, n))
  return { ...r, postsPerDay, dayFormats: r.dayFormats.map((d) => fill(postsPerDay, d)) }
}

export function hourAdd(time: string, hours: number): string {
  const h = Math.min(23, parseInt(time, 10) + hours)
  return `${String(h).padStart(2, "0")}:00`
}

/** The hours a publishing day gets: default, then +gap each. Capped at 23:00. */
export function timesFor(r: ScheduleRules): string[] {
  return Array.from({ length: r.postsPerDay }, (_, i) => hourAdd(r.defaultTime, i * r.gapHours))
}

/** True when the gap pushes a later post past 23:00 (it gets squeezed onto 23:00). */
export function runsPastNight(r: ScheduleRules): boolean {
  return parseInt(r.defaultTime, 10) + (r.postsPerDay - 1) * r.gapHours > 23
}

export function activeDays(r: ScheduleRules): number {
  return r.days.filter(Boolean).length
}

export function rulesEqual(a: ScheduleRules, b: ScheduleRules): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The rules as the PostingSchedule "תזמון הכל" consumes. A day with "any"
 * becomes a slot whose format is the literal "any" — shipping A needs one
 * change in lib/schedule-all (treat "any" as a wildcard). Not done here: that
 * file belongs to the in-progress "סידור אוטומטי" task.
 */
export function rulesToPostingSchedule(r: ScheduleRules): PostingSchedule {
  const times = timesFor(r)
  return {
    days: r.days.map((on, d) =>
      on ? times.map((time, i) => ({ id: newSlotId(), format: r.dayFormats[d]?.[i] ?? "any", time })) : [],
    ),
    storyGapMinutes: r.storyGapMinutes,
  }
}

/** "5 ימים · 2 פוסטים ביום · 09:00" */
export function rulesSummary(r: ScheduleRules): string {
  const d = activeDays(r)
  if (d === 0) return "לא נבחרו ימי פרסום"
  const perDay = r.postsPerDay === 1 ? "פוסט אחד ביום" : `${r.postsPerDay} פוסטים ביום`
  return `${d} ימים · ${perDay} · ${r.defaultTime}`
}

/* ------------------------------------------------------------------ */
/*  Variant B — the slot template (lib/posting-schedule, as on main)   */
/* ------------------------------------------------------------------ */

export function sampleSavedTemplate(): PostingSchedule {
  return defaultPostingSchedule()
}

export function emptyTemplate(): PostingSchedule {
  return { days: [[], [], [], [], [], [], []], storyGapMinutes: 15 }
}

export function clashTemplate(): PostingSchedule {
  const s = defaultPostingSchedule()
  s.days[2] = [...s.days[2], { id: newSlotId(), format: "story", time: "12:00" }]
  return s
}

export function templateSummary(s: PostingSchedule): string {
  const n = s.days.reduce((x, d) => x + d.length, 0)
  const d = s.days.filter((x) => x.length > 0).length
  if (n === 0) return "לא נבחרו ימי פרסום"
  return `${n} פרסומים בשבוע · ${d} ימים`
}

export const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const
export { WEEKDAY_NAMES }
