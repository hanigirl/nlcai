/**
 * "תזמון הכל" — the distribution rule.
 *
 * Takes every ready, still-unscheduled (post × format) card and lays it on
 * the calendar by the weekly routine (lib/posting-schedule): each weekday's
 * slots say which format goes out at what time.
 *
 * Pure function, no I/O — the calendar shows the plan as a preview and
 * commits it only on "תזמון כל הפוסטים".
 */

import type { FormatId } from "@/lib/timing-storage"
import { effectiveDaySlots, slotsForWeekday, type PostingSchedule } from "@/lib/posting-schedule"
import {
  addDaysToKey,
  dateKeyWeekday,
  israelDateKey,
  israelWallTimeToDate,
} from "@/lib/israel-time"

export type PlanInputCard = {
  corePostId: string
  format: FormatId
  hook: string
  mediaUrl?: string
}

export type PlannedSlot = PlanInputCard & {
  scheduledDate: string
  scheduledTime: string
}

export type SchedulePlan = {
  placed: PlannedSlot[]
  /** Cards whose format has no slot in the routine. */
  unmatched: PlanInputCard[]
  /**
   * Cards whose format HAS slots in the routine, but no free one was found
   * within HORIZON_DAYS (every matching slot taken, the day already at its
   * posts-per-day cap, or blocked by the day gap / format gap). The calendar
   * should tell her these were left out — they are not silently dropped.
   */
  noRoom: PlanInputCard[]
}

/**
 * How far ahead the planner may look. Every card goes in, however far ahead
 * that is (Hani, 2026-11-11: "תמיד להכניס פוסטים גם אם זה עובר את 4 החודשים
 * הקרובים") — this is only a guard against a loop, three years out.
 */
export const HORIZON_DAYS = 3 * 365

export function hasAnySlot(schedule: PostingSchedule | null | undefined): boolean {
  return !!schedule && [0, 1, 2, 3, 4, 5, 6].some((i) => effectiveDaySlots(schedule, i).length > 0)
}

/** Whole days between two "YYYY-MM-DD" keys. */
function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000)
}

/**
 * Greedy, order-preserving fill. Cards keep the order they were given, and
 * each takes the earliest open slot for its format. A slot is open when:
 *   - its time is still ahead (Israel time — the board's clock), by minLeadMs;
 *   - the board + this plan don't already fill it (each routine slot holds
 *     one post, so two slots of one format at one hour are two places);
 *   - the day hasn't reached postsPerDay yet, counting posts already on it;
 *   - the day gap and the format gap allow that day.
 * Running it twice never stacks two posts on one slot.
 */
export function planScheduleAll(
  cards: PlanInputCard[],
  schedule: PostingSchedule,
  occupied: { scheduledDate: string; scheduledTime?: string | null; format: FormatId; corePostId?: string }[],
  now: Date = new Date(),
  /** Minimum lead before a slot (Instagram refuses anything sooner). */
  minLeadMs = 10 * 60 * 1000,
): SchedulePlan {
  const slotKey = (date: string, time: string, format: FormatId) => `${date}:${time}:${format}`
  // How many posts already fill each date + hour + format.
  const used = new Map<string, number>()
  const bump = (k: string) => used.set(k, (used.get(k) ?? 0) + 1)
  for (const o of occupied) bump(slotKey(o.scheduledDate, o.scheduledTime ?? "09:00", o.format))

  // Posts on each date, any format — the "at most N a day" rule.
  const perDay = Math.max(1, schedule.postsPerDay ?? 1)
  const dayCount = new Map<string, number>()
  // Stories don't count: a day carries its posts and a story on top.
  for (const o of occupied) {
    if (o.format === "story") continue
    dayCount.set(o.scheduledDate, (dayCount.get(o.scheduledDate) ?? 0) + 1)
  }

  const placed: PlannedSlot[] = []
  const unmatched: PlanInputCard[] = []
  const noRoom: PlanInputCard[] = []
  const formatsWithASlot = new Set(
    [0, 1, 2, 3, 4, 5, 6].flatMap((i) => effectiveDaySlots(schedule, i)).map((s) => s.format),
  )
  // Publishing days already on the board or in this plan — the global gap
  // ("רווח בין ימי פרסום") keeps a new day clear of them. Same day is fine:
  // how many posts a day may carry is postsPerDay's job.
  const gap = schedule.gapDays ?? 0
  const publishDays = new Set(occupied.map((o) => o.scheduledDate))
  const clearOfGap = (key: string) => {
    if (gap <= 0 || publishDays.has(key)) return true
    for (const other of publishDays) {
      if (Math.abs(daysApart(key, other)) <= gap) return false
    }
    return true
  }

  // Formats of one core post stay `formatGapDays` apart (Hani, 2026-11-05):
  // every date one of its formats already has, on the board or in this plan.
  const formatGap = schedule.formatGapDays ?? 0
  const datesByPost = new Map<string, string[]>()
  const notePostDate = (id: string | undefined, key: string) => {
    if (!id) return
    datesByPost.set(id, [...(datesByPost.get(id) ?? []), key])
  }
  for (const o of occupied) notePostDate(o.corePostId, o.scheduledDate)
  const clearOfSiblings = (id: string, key: string) =>
    formatGap <= 0 || (datesByPost.get(id) ?? []).every((other) => Math.abs(daysApart(key, other)) >= formatGap)

  // "Today" is Israel's today, whatever zone this browser is in.
  const today = israelDateKey(now)

  for (const card of cards) {
    if (!formatsWithASlot.has(card.format)) {
      unmatched.push(card)
      continue
    }
    let done = false
    for (let i = 0; i < HORIZON_DAYS && !done; i++) {
      const key = addDaysToKey(today, i)
      if (card.format !== "story" && (dayCount.get(key) ?? 0) >= perDay) continue
      if (!clearOfGap(key)) continue
      if (!clearOfSiblings(card.corePostId, key)) continue
      const slots = slotsForWeekday(schedule, dateKeyWeekday(key)).filter((s) => s.format === card.format)
      // Each routine slot is one place: two slots of this format at one hour hold two posts.
      const capacity = new Map<string, number>()
      for (const slot of slots) {
        const k = slotKey(key, slot.time, card.format)
        capacity.set(k, (capacity.get(k) ?? 0) + 1)
      }
      for (const slot of slots) {
        const at = israelWallTimeToDate(key, slot.time)
        if (at.getTime() - now.getTime() < minLeadMs) continue
        const k = slotKey(key, slot.time, card.format)
        if ((used.get(k) ?? 0) >= (capacity.get(k) ?? 0)) continue
        bump(k)
        if (card.format !== "story") dayCount.set(key, (dayCount.get(key) ?? 0) + 1)
        placed.push({ ...card, scheduledDate: key, scheduledTime: slot.time })
        publishDays.add(key)
        notePostDate(card.corePostId, key)
        done = true
        break
      }
    }
    if (!done) noRoom.push(card)
  }

  return { placed, unmatched, noRoom }
}
