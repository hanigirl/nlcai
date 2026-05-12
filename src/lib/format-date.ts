// Shared date label for list cards on /core_posts and /hooks.
// "Today" is decided in Asia/Jerusalem so a hook saved at 23:00 local Tue
// doesn't render as "yesterday" for a user in the same timezone (which is
// what raw UTC date comparison would do).

const TZ = "Asia/Jerusalem"

function jerusalemDayKey(d: Date): string {
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
  return jerusalemDayKey(d) === jerusalemDayKey(new Date())
    ? `היום · ${datePart}`
    : datePart
}
