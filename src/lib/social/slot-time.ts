/**
 * The board's wall-clock slot, as a real instant.
 *
 * The calendar stores "the 27th at 18:00" with no zone, on purpose — it has to
 * mean the same thing to everyone looking at it (migration 026). The product is
 * Israeli and the board means Israel time, always: a user whose laptop is set
 * to New York, and a server running in UTC, must both turn "18:00" into the
 * same instant. So the conversion lives here, in one place, and depends on
 * nothing but the timezone database — not on the process's TZ, not on the
 * browser's.
 *
 * Pure: no server imports, so the calendar can run the same check the server
 * does before a drop ("is this slot already too close?").
 */

import { PUBLISH_FLOOR_MS } from "./publish-state"
import { SocialPublishError } from "./types"

/** The board's zone. Not configurable per user, by design (see above). */
export const CALENDAR_TIMEZONE = "Asia/Jerusalem"

/**
 * Resolve the calendar's local wall-clock slot to an absolute instant.
 *
 * Two passes, because the zone's offset is a property of the *answer*, not of
 * the question. The first guess reads the offset at "these numbers as UTC",
 * which is up to three hours away from the real instant — on the night the
 * clocks change (25.10.2026, 02:00 → 01:00) that guess can land on the wrong
 * side of the switch. The second pass re-reads the offset at the instant the
 * first pass produced, which is on the right side.
 */
export function slotToInstant(scheduledDate: string, scheduledTime: string): Date {
  const [y, m, d] = scheduledDate.split("-").map(Number)
  const [hh, mm] = (scheduledTime || "").split(":").map(Number)

  if (!y || !m || !d || Number.isNaN(hh)) {
    throw new SocialPublishError(
      `slot has an unreadable date/time: ${scheduledDate} ${scheduledTime}`,
      "provider_error",
      false,
    )
  }

  const asUtc = Date.UTC(y, m - 1, d, hh, mm || 0)
  const first = asUtc - zoneOffsetMs(new Date(asUtc))
  const second = asUtc - zoneOffsetMs(new Date(first))
  return new Date(second)
}

/** How far ahead of UTC the calendar's zone was at a given instant. */
function zoneOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  )
  // Intl drops the milliseconds; so must we, or every offset is off by them.
  return local - Math.floor(at.getTime() / 1000) * 1000
}

/**
 * Is this slot too close (or already past) for the provider to accept?
 *
 * The provider refuses anything under ~6 minutes ahead ("Schedule Date must be
 * after current date"). Checking here means the user hears it while she is
 * dragging the card, not from a failed post later.
 */
export function isSlotTooSoon(
  scheduledDate: string,
  scheduledTime: string,
  now: number = Date.now(),
): boolean {
  try {
    return slotToInstant(scheduledDate, scheduledTime).getTime() - now < PUBLISH_FLOOR_MS
  } catch {
    return true
  }
}

/** "יום ג׳ 27.10 · 18:00", in Israel time regardless of the browser's zone. */
export function formatSlotForHumans(instant: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: CALENDAR_TIMEZONE,
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant)
}
