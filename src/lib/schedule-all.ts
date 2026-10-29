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
import { effectiveDaySlots, slotsForDate, type PostingSchedule } from "@/lib/posting-schedule"

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
}

/** How far ahead the planner is allowed to look before giving up on a card. */
const HORIZON_DAYS = 120

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

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
 * each takes the earliest open slot for its format. A slot is open when its
 * time is still ahead and the board doesn't already hold that format at that
 * date + time — so running it twice never stacks two reels on one slot.
 */
export function planScheduleAll(
  cards: PlanInputCard[],
  schedule: PostingSchedule,
  occupied: { scheduledDate: string; scheduledTime?: string | null; format: FormatId }[],
  now: Date = new Date(),
  /** Minimum lead before a slot (Instagram refuses anything sooner). */
  minLeadMs = 10 * 60 * 1000,
): SchedulePlan {
  const taken = new Set(
    occupied.map((o) => `${o.scheduledDate}:${o.scheduledTime ?? "09:00"}:${o.format}`),
  )
  const placed: PlannedSlot[] = []
  const unmatched: PlanInputCard[] = []
  const formatsWithASlot = new Set(
    [0, 1, 2, 3, 4, 5, 6].flatMap((i) => effectiveDaySlots(schedule, i)).map((s) => s.format),
  )
  // Publishing days already on the board or in this plan — the global gap
  // ("רווח בין פרסומים") keeps a new day clear of them. Same day is fine:
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

  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  for (const card of cards) {
    if (!formatsWithASlot.has(card.format)) {
      unmatched.push(card)
      continue
    }
    let done = false
    for (let i = 0; i < HORIZON_DAYS && !done; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      if (!clearOfGap(dateKey(d))) continue
      const slots = slotsForDate(schedule, d).filter((s) => s.format === card.format)
      for (const slot of slots) {
        const [h, m] = slot.time.split(":").map((n) => parseInt(n, 10))
        const at = new Date(d)
        at.setHours(h, m || 0, 0, 0)
        if (at.getTime() - now.getTime() < minLeadMs) continue
        const key = `${dateKey(d)}:${slot.time}:${card.format}`
        if (taken.has(key)) continue
        taken.add(key)
        placed.push({ ...card, scheduledDate: dateKey(d), scheduledTime: slot.time })
        publishDays.add(dateKey(d))
        done = true
        break
      }
    }
    if (!done) unmatched.push(card)
  }

  return { placed, unmatched }
}
