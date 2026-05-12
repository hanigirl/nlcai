// Shared date label for list cards on /core_posts and /hooks.
// "Today" is decided in Asia/Jerusalem so a hook saved at 23:00 local Tue
// doesn't render as "yesterday" for a user in the same timezone (which is
// what raw UTC date comparison would do).

const TZ = "Asia/Jerusalem"

/**
 * Stable Jerusalem-timezone day key (YYYY-MM-DD) suitable for grouping
 * lists by calendar day. Same input → same key, regardless of when in
 * the day it's called.
 */
export function getDayKey(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

/**
 * Format a creation timestamp for list cards.
 *   today → "היום · DD.MM.YY"
 *   else  → "DD.MM.YY"
 * Empty / invalid ISO → empty string.
 */
export function formatPostDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const datePart = new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d).replace(/\//g, ".")
  return getDayKey(d) === getDayKey(new Date())
    ? `היום · ${datePart}`
    : datePart
}
