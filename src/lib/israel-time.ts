/**
 * Israel wall-clock time, whatever time zone the browser (or server) is in.
 *
 * The board, the routine and every scheduledDate/scheduledTime mean Israel
 * time (Asia/Jerusalem). A user abroad — or a server running in UTC — must
 * still see "today" and "Tuesday 09:00" the way the board means them.
 */

export const ISRAEL_TZ = "Asia/Jerusalem"

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ISRAEL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

export type IsraelParts = {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday */
  dow: number
  /** "YYYY-MM-DD" */
  dateKey: string
  /** "HH:MM" */
  time: string
}

const pad = (n: number) => String(n).padStart(2, "0")

/** The Israel date + time of an instant (default: now). */
export function israelNowParts(at: Date = new Date()): IsraelParts {
  const get = (type: string) => {
    const p = partsFmt.formatToParts(at).find((x) => x.type === type)
    return p ? parseInt(p.value, 10) : 0
  }
  const year = get("year")
  const month = get("month")
  const day = get("day")
  const hour = get("hour") % 24
  const minute = get("minute")
  const second = get("second")
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  }
}

/** "YYYY-MM-DD" of an instant, in Israel. */
export function israelDateKey(at: Date = new Date()): string {
  return israelNowParts(at).dateKey
}

/** Day of week (0 = Sunday) of a "YYYY-MM-DD" key — the calendar date itself, no time zone. */
export function dateKeyWeekday(key: string): number {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The "YYYY-MM-DD" key `n` days after `key` (calendar arithmetic, no time zone). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** The instant Israel's clock reads `time` ("HH:MM") on `key` ("YYYY-MM-DD"). */
export function israelWallTimeToDate(key: string, time: string): Date {
  const [y, mo, d] = key.split("-").map(Number)
  const [h, mi] = time.split(":").map((n) => parseInt(n, 10))
  const wall = Date.UTC(y, mo - 1, d, h, mi || 0)
  // Guess with the offset at the wall time read as UTC, then correct once
  // (enough across DST changes: Israel's offset is +2 or +3).
  let guess = wall
  for (let i = 0; i < 2; i++) {
    const p = israelNowParts(new Date(guess))
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess = guess + (wall - asUtc)
  }
  return new Date(guess)
}
