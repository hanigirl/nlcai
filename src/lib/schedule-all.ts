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
import type { PostingSchedule } from "@/lib/posting-schedule"

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
  return !!schedule && schedule.days.some((d) => d.length > 0)
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
  const formatsWithASlot = new Set(schedule.days.flat().map((s) => s.format))

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
      const slots = (schedule.days[d.getDay()] ?? [])
        .filter((s) => s.format === card.format)
        .sort((a, b) => a.time.localeCompare(b.time))
      for (const slot of slots) {
        const [h, m] = slot.time.split(":").map((n) => parseInt(n, 10))
        const at = new Date(d)
        at.setHours(h, m || 0, 0, 0)
        if (at.getTime() - now.getTime() < minLeadMs) continue
        const key = `${dateKey(d)}:${slot.time}:${card.format}`
        if (taken.has(key)) continue
        taken.add(key)
        placed.push({ ...card, scheduledDate: dateKey(d), scheduledTime: slot.time })
        done = true
        break
      }
    }
    if (!done) unmatched.push(card)
  }

  return { placed, unmatched }
}
