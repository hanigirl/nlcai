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
}

export type PostingSchedule = {
  /** Index 0 = Sunday … 6 = Saturday (Date.getDay()). Empty array = day off. */
  days: PostingSlot[][]
  /** Gap between frames of a multi-frame story, in minutes. */
  storyGapMinutes: number
}

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

function slot(format: FormatId, time: string): PostingSlot {
  return { id: newSlotId(), format, time }
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
      [slot("story", "20:00")], // שני
      [slot("carousel", "12:00")], // שלישי
      [], // רביעי
      [slot("talking_head", "09:00"), slot("story", "20:00")], // חמישי
      [], // שישי
      [], // שבת
    ],
    storyGapMinutes: 15,
  }
}

export function cloneSchedule(s: PostingSchedule): PostingSchedule {
  return {
    days: s.days.map((d) => d.map((x) => ({ ...x }))),
    storyGapMinutes: s.storyGapMinutes,
  }
}

/** The slots expected on a given date, earliest first. */
export function slotsForDate(s: PostingSchedule, date: Date): PostingSlot[] {
  return [...(s.days[date.getDay()] ?? [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  )
}

export function countSlots(s: PostingSchedule): number {
  return s.days.reduce((n, d) => n + d.length, 0)
}

export function activeDayCount(s: PostingSchedule): number {
  return s.days.filter((d) => d.length > 0).length
}

export function usesStories(s: PostingSchedule): boolean {
  return s.days.some((d) => d.some((x) => x.format === "story"))
}

/** Slot ids that share a day + hour with another slot — two posts can't air at once. */
export function clashingSlotIds(s: PostingSchedule): Set<string> {
  const out = new Set<string>()
  for (const day of s.days) {
    const byTime = new Map<string, string[]>()
    for (const x of day) byTime.set(x.time, [...(byTime.get(x.time) ?? []), x.id])
    for (const ids of byTime.values()) if (ids.length > 1) ids.forEach((id) => out.add(id))
  }
  return out
}

export function schedulesEqual(a: PostingSchedule, b: PostingSchedule): boolean {
  if (a.storyGapMinutes !== b.storyGapMinutes) return false
  return a.days.every((d, i) => {
    const o = b.days[i] ?? []
    return d.length === o.length && d.every((x, j) => x.format === o[j].format && x.time === o[j].time)
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
    return parsed
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
  c.days[day] = c.days[day].map((x) => (x.id === next.id ? { ...next } : x))
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
