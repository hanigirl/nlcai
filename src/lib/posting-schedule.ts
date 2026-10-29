/**
 * Posting schedule — the user's recurring weekly routine ("לו״ז פרסום").
 *
 * Answers the question users ask on day one: "how do I set Tuesdays and
 * Thursdays to carousels?" One rule set for every week:
 *   - which days we publish        → a day with zero slots is a day off
 *   - at what hour                 → each slot has its own time
 *   - which format on which day    → each slot has its own format
 *   - story spacing                → minutes between frames of a multi-frame story
 *
 * This is the contract "תזמן הכל" consumes: given a date, `slotsForDate`
 * returns the (format, time) pairs that day expects, in time order.
 *
 * Persistence: localStorage, same as the rest of timing (see
 * timing-storage.ts — Spinal P0, graduates to a table once it proves itself).
 * The review harness (`?rules=a|b`) never calls the save helper — it keeps
 * everything in component state so a review link touches nothing.
 */

import type { FormatId } from "@/lib/timing-storage"

export type PostingSlot = {
  /** Stable key for React lists and edits. */
  id: string
  format: FormatId
  /** "HH:00" — whole hour, same grain as ScheduledPost.scheduledTime. */
  time: string
  /**
   * True → the slot follows the global hour for its place in the day
   * (`defaultTimes[i]` for the i-th post), and `time` is ignored.
   * Absent/false → `time` is a deliberate override. Routines saved before
   * the global hours existed have no flag, so they keep their exact times.
   */
  inherit?: boolean
}

export type PostingSchedule = {
  /** Index 0 = Sunday … 6 = Saturday (Date.getDay()). */
  days: PostingSlot[][]
  /** Gap between frames of a multi-frame story, in minutes. */
  storyGapMinutes: number
  /**
   * Which weekdays we publish at all (global). A day that's off keeps its
   * formats, so switching it back on restores them.
   */
  activeDays: boolean[]
  /** Most posts on one day (1 = never more than one a day). */
  postsPerDay: number
  /** Default hour for the 1st, 2nd and 3rd post of a day (global). */
  defaultTimes: string[]
  /** Empty days required between two publishing days (0 = none). */
  gapDays: number
}

export const MAX_POSTS_PER_DAY = 3

export const GAP_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: "בלי רווח" },
  { days: 1, label: "יום אחד" },
  { days: 2, label: "יומיים" },
]

export const DEFAULT_TIMES = ["09:00", "13:00", "20:00"]

/** Formats a slot can carry, in the order the pickers list them. */
export const SCHEDULE_FORMATS: FormatId[] = [
  "talking_head",
  "carousel",
  "story",
  "image_post",
  "b_roll",
]

/** Whole hours 07:00–23:00 — matches the scheduler's existing hour range. */
export const SCHEDULE_HOURS: string[] = Array.from(
  { length: 17 },
  (_, i) => `${String(i + 7).padStart(2, "0")}:00`,
)

export const STORY_GAP_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "5 דקות" },
  { minutes: 15, label: "רבע שעה" },
  { minutes: 30, label: "חצי שעה" },
  { minutes: 60, label: "שעה" },
]

export const WEEKDAY_NAMES = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const

let slotSeq = 0
export function newSlotId(): string {
  slotSeq += 1
  return `slot-${Date.now().toString(36)}-${slotSeq}`
}

function slot(format: FormatId, time: string, inherit = true): PostingSlot {
  return { id: newSlotId(), format, time, inherit }
}

/**
 * The schedule a user gets before she sets anything.
 *
 * Built from the persona's own target — 4–6 content units a week (reel +
 * carousel + story + post), Sunday-to-Thursday, nothing on Shabbat. Five
 * slots: enough to feel consistent, few enough not to feel like homework.
 */
export function defaultPostingSchedule(): PostingSchedule {
  return {
    days: [
      [slot("talking_head", "09:00")], // ראשון
      [slot("story", "09:00")], // שני
      [slot("carousel", "09:00")], // שלישי
      [], // רביעי
      [slot("talking_head", "09:00"), slot("story", "13:00")], // חמישי
      [], // שישי
      [], // שבת
    ],
    storyGapMinutes: 15,
    activeDays: [true, true, true, false, true, false, false],
    postsPerDay: 2,
    defaultTimes: [...DEFAULT_TIMES],
    gapDays: 0,
  }
}

export function cloneSchedule(s: PostingSchedule): PostingSchedule {
  return {
    days: s.days.map((d) => d.map((x) => ({ ...x }))),
    storyGapMinutes: s.storyGapMinutes,
    activeDays: [...s.activeDays],
    postsPerDay: s.postsPerDay,
    defaultTimes: [...s.defaultTimes],
    gapDays: s.gapDays,
  }
}

/**
 * Fill in the global settings a stored routine may predate (saved before
 * 2026-10-29). Old routines read exactly as before: a day with slots is a
 * publishing day, slots keep their own hours (no `inherit` flag), the
 * per-day cap is the busiest day, and there's no gap.
 */
export function normalizeSchedule(raw: Partial<PostingSchedule> & { days: PostingSlot[][] }): PostingSchedule {
  const days = raw.days.map((d) => (Array.isArray(d) ? d : []))
  const busiest = Math.max(1, ...days.map((d) => d.length))
  const times = Array.isArray(raw.defaultTimes) ? raw.defaultTimes : []
  return {
    days,
    storyGapMinutes: typeof raw.storyGapMinutes === "number" ? raw.storyGapMinutes : 15,
    activeDays:
      Array.isArray(raw.activeDays) && raw.activeDays.length === 7
        ? raw.activeDays.map(Boolean)
        : days.map((d) => d.length > 0),
    postsPerDay:
      typeof raw.postsPerDay === "number"
        ? Math.min(MAX_POSTS_PER_DAY, Math.max(1, raw.postsPerDay))
        : Math.min(MAX_POSTS_PER_DAY, busiest),
    defaultTimes: DEFAULT_TIMES.map((d, i) => times[i] ?? d),
    gapDays: typeof raw.gapDays === "number" ? Math.max(0, raw.gapDays) : 0,
  }
}

/** The hour a slot actually goes out at: its override, or the global hour for its place in the day. */
export function slotTime(s: PostingSchedule, slotIndex: number, x: PostingSlot): string {
  return x.inherit ? (s.defaultTimes[slotIndex] ?? DEFAULT_TIMES[slotIndex] ?? x.time) : x.time
}

/**
 * The slots expected on a given date, earliest first, with their effective
 * hour in `time`. Respects the global rules: a day that's off has none, and
 * a day never carries more than `postsPerDay`.
 */
export function slotsForDate(s: PostingSchedule, date: Date): PostingSlot[] {
  const dow = date.getDay()
  if (s.activeDays && !s.activeDays[dow]) return []
  return (s.days[dow] ?? [])
    .slice(0, s.postsPerDay ?? MAX_POSTS_PER_DAY)
    .map((x, i) => ({ ...x, time: slotTime(s, i, x) }))
    .sort((a, b) => a.time.localeCompare(b.time))
}

/** The posts a weekday carries under the global rules (same as slotsForDate, by weekday). */
export function effectiveDaySlots(s: PostingSchedule, dow: number): PostingSlot[] {
  const d = new Date(2026, 0, 4 + dow) // 2026-01-04 is a Sunday
  return slotsForDate(s, d)
}

export function countSlots(s: PostingSchedule): number {
  return [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => n + effectiveDaySlots(s, i).length, 0)
}

export function activeDayCount(s: PostingSchedule): number {
  return [0, 1, 2, 3, 4, 5, 6].filter((i) => effectiveDaySlots(s, i).length > 0).length
}

export function usesStories(s: PostingSchedule): boolean {
  return [0, 1, 2, 3, 4, 5, 6].some((i) => effectiveDaySlots(s, i).some((x) => x.format === "story"))
}

/** Slot ids that share a day + hour with another slot — two posts can't air at once. */
export function clashingSlotIds(s: PostingSchedule): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < 7; i++) {
    const day = effectiveDaySlots(s, i)
    const byTime = new Map<string, string[]>()
    for (const x of day) byTime.set(x.time, [...(byTime.get(x.time) ?? []), x.id])
    for (const ids of byTime.values()) if (ids.length > 1) ids.forEach((id) => out.add(id))
  }
  return out
}

export function schedulesEqual(a: PostingSchedule, b: PostingSchedule): boolean {
  if (a.storyGapMinutes !== b.storyGapMinutes) return false
  if (a.postsPerDay !== b.postsPerDay || a.gapDays !== b.gapDays) return false
  if (a.activeDays.some((x, i) => x !== b.activeDays[i])) return false
  if (a.defaultTimes.some((x, i) => x !== b.defaultTimes[i])) return false
  return a.days.every((d, i) => {
    const o = b.days[i] ?? []
    return (
      d.length === o.length &&
      d.every((x, j) => x.format === o[j].format && x.time === o[j].time && !!x.inherit === !!o[j].inherit)
    )
  })
}

// --- persistence (production path only — the review harness never calls it) ---

const SCHEDULE_KEY = "nlcai.timing.posting_schedule"

/** Saved schedule, or null when the user has never set one (→ show the default). */
export function getPostingSchedule(): PostingSchedule | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(SCHEDULE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PostingSchedule
    if (!Array.isArray(parsed?.days) || parsed.days.length !== 7) return null
    return normalizeSchedule(parsed)
  } catch (err) {
    console.warn("[posting-schedule] unreadable schedule, using default", err)
    return null
  }
}

export function savePostingSchedule(s: PostingSchedule): void {
  window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify(s))
  window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULE_KEY }))
}

// --- pure edit helpers ------------------------------------------------------

export function withSlotUpdated(s: PostingSchedule, day: number, next: PostingSlot): PostingSchedule {
  const c = cloneSchedule(s)
  c.days[day] = c.days[day].map((x) =>
    x.id === next.id
      ? // A new hour picked by hand is an override of the global hour.
        { ...next, inherit: next.time !== x.time ? false : next.inherit }
      : x,
  )
  return c
}

/**
 * Add a slot to a day. Copies the day's last slot one hour later when there
 * is one (the common case is "another one of these"), else a carousel at 09:00.
 */
export function withSlotAdded(s: PostingSchedule, day: number): PostingSchedule {
  const c = cloneSchedule(s)
  const last = c.days[day][c.days[day].length - 1]
  let time = "09:00"
  if (last) {
    const h = Math.min(23, parseInt(last.time, 10) + 1)
    time = `${String(h).padStart(2, "0")}:00`
  }
  c.days[day] = [...c.days[day], { id: newSlotId(), format: last?.format ?? "carousel", time }]
  c.activeDays[day] = true
  c.postsPerDay = Math.max(c.postsPerDay, Math.min(MAX_POSTS_PER_DAY, c.days[day].length))
  return c
}

export function withSlotRemoved(s: PostingSchedule, day: number, id: string): PostingSchedule {
  const c = cloneSchedule(s)
  c.days[day] = c.days[day].filter((x) => x.id !== id)
  return c
}

export function withDaySlots(s: PostingSchedule, day: number, slots: PostingSlot[]): PostingSchedule {
  const c = cloneSchedule(s)
  c.days[day] = slots.map((x) => ({ ...x }))
  return c
}

// --- global-rule edits (schedule settings) ---------------------------------

export function withDayActive(s: PostingSchedule, day: number, active: boolean): PostingSchedule {
  const c = cloneSchedule(s)
  c.activeDays[day] = active
  return c
}

/** Set (or clear, with null) the format of the i-th post of a day. New posts follow the global hour. */
export function withDayPost(s: PostingSchedule, day: number, index: number, format: FormatId | null): PostingSchedule {
  const c = cloneSchedule(s)
  const list = c.days[day].slice(0, c.postsPerDay)
  if (format === null) {
    list.splice(index, 1)
  } else if (list[index]) {
    list[index] = { ...list[index], format }
  } else {
    list.push({ id: newSlotId(), format, time: c.defaultTimes[list.length] ?? "09:00", inherit: true })
  }
  c.days[day] = list
  if (format !== null) c.activeDays[day] = true
  return c
}

/** Give the i-th post of a day its own hour, or (null) put it back on the global hour. */
export function withPostTime(s: PostingSchedule, day: number, index: number, time: string | null): PostingSchedule {
  const c = cloneSchedule(s)
  const x = c.days[day][index]
  if (!x) return c
  c.days[day][index] = time === null ? { ...x, inherit: true } : { ...x, time, inherit: false }
  return c
}

export function withGlobal(
  s: PostingSchedule,
  patch: Partial<Pick<PostingSchedule, "postsPerDay" | "gapDays" | "storyGapMinutes">> & { timeIndex?: number; time?: string },
): PostingSchedule {
  const c = cloneSchedule(s)
  if (patch.postsPerDay !== undefined) c.postsPerDay = patch.postsPerDay
  if (patch.gapDays !== undefined) c.gapDays = patch.gapDays
  if (patch.storyGapMinutes !== undefined) c.storyGapMinutes = patch.storyGapMinutes
  if (patch.timeIndex !== undefined && patch.time) c.defaultTimes[patch.timeIndex] = patch.time
  return c
}
