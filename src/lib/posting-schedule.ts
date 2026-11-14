/**
 * Posting schedule — the user's recurring weekly routine ("לו״ז פרסום").
 *
 * Answers the question users ask on day one: "how do I set Tuesdays and
 * Thursdays to carousels?" One rule set for every week:
 *   - which days we publish        → a day with zero slots is a day off
 *   - at what hour                 → each slot has its own time
 *   - which format on which day    → each slot has its own format
 *
 * This is the contract "תזמן הכל" consumes: given a date, `slotsForDate`
 * returns the (format, time) pairs that day expects, in time order.
 *
 * Persistence: on the account (users.posting_schedule via
 * /api/schedule/settings); localStorage is only this browser's first-paint
 * copy. The review harness (`?rules=a|b`) never calls the save helper.
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
   * False → `time` is a deliberate override. Routines saved before the
   * global hours existed have no flag: normalizeSchedule reads a slot whose
   * time is the default hour for its place as following the global hour,
   * and any other time as an override.
   */
  inherit?: boolean
}

export type PostingSchedule = {
  /** Index 0 = Sunday … 6 = Saturday (Date.getDay()). */
  days: PostingSlot[][]
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
  /**
   * Minimum days between two formats of the SAME core post (0 = none), so a
   * reel and its carousel don't go out back to back (Hani, 2026-11-05).
   */
  formatGapDays: number
}

export const MAX_POSTS_PER_DAY = 3

export const GAP_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: "בלי רווח" },
  { days: 1, label: "יום אחד" },
  { days: 2, label: "יומיים" },
]

/** Days between two formats of one core post. 10 is her default. */
export const FORMAT_GAP_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: "בלי רווח" },
  { days: 7, label: "שבוע" },
  { days: 10, label: "10 ימים" },
  { days: 14, label: "שבועיים" },
]
export const DEFAULT_FORMAT_GAP_DAYS = 10

export const DEFAULT_TIMES = ["09:00", "13:00", "20:00"]

/** Formats a slot can carry, in the order the pickers list them. */
export const SCHEDULE_FORMATS: FormatId[] = [
  "talking_head",
  "carousel",
  "story",
  "image_post",
  "b_roll",
]

/** Every half hour, 07:00–23:30 (Hani, 2026-11-15: whole hours only was too coarse). */
export const SCHEDULE_HOURS: string[] = Array.from(
  { length: 34 },
  (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
)

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
    activeDays: [true, true, true, false, true, false, false],
    postsPerDay: 2,
    defaultTimes: [...DEFAULT_TIMES],
    gapDays: 0,
    formatGapDays: DEFAULT_FORMAT_GAP_DAYS,
  }
}

export function cloneSchedule(s: PostingSchedule): PostingSchedule {
  return {
    days: s.days.map((d) => d.map((x) => ({ ...x }))),
    activeDays: [...s.activeDays],
    postsPerDay: s.postsPerDay,
    defaultTimes: [...s.defaultTimes],
    gapDays: s.gapDays,
    formatGapDays: s.formatGapDays,
  }
}

/**
 * Fill in the global settings a stored routine may predate (saved before
 * 2026-10-29). Old routines read exactly as before: a day with slots is a
 * publishing day, slots keep their own hours (no `inherit` flag), the
 * per-day cap is the busiest day, and there's no gap.
 */
export function normalizeSchedule(raw: Partial<PostingSchedule> & { days: PostingSlot[][] }): PostingSchedule {
  const times = Array.isArray(raw.defaultTimes) ? raw.defaultTimes : []
  const defaultTimes = DEFAULT_TIMES.map((d, i) => times[i] ?? d)
  // Slots saved before 2026-10-29 have no `inherit` flag. One sitting on the
  // default hour for its place in the day follows the board-wide hour; any
  // other hour was picked on purpose and stays an override.
  const days = raw.days.map((d) =>
    (Array.isArray(d) ? d : []).map((x, i) =>
      typeof x.inherit === "boolean"
        ? x
        : { ...x, inherit: x.time === DEFAULT_TIMES[i] || x.time === defaultTimes[i] },
    ),
  )
  const busiest = Math.max(1, ...days.map((d) => d.length))
  // Old saved data may still carry `storyGapMinutes` (removed) — ignored.
  return {
    days,
    activeDays:
      Array.isArray(raw.activeDays) && raw.activeDays.length === 7
        ? raw.activeDays.map(Boolean)
        : days.map((d) => d.length > 0),
    postsPerDay:
      typeof raw.postsPerDay === "number"
        ? Math.min(MAX_POSTS_PER_DAY, Math.max(1, raw.postsPerDay))
        : Math.min(MAX_POSTS_PER_DAY, busiest),
    defaultTimes,
    gapDays: typeof raw.gapDays === "number" ? Math.max(0, raw.gapDays) : 0,
    formatGapDays:
      typeof raw.formatGapDays === "number" ? Math.max(0, raw.formatGapDays) : DEFAULT_FORMAT_GAP_DAYS,
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
  return slotsForWeekday(s, date.getDay())
}

/** Same as slotsForDate, by weekday (0 = Sunday) — no Date, no time zone. */
export function slotsForWeekday(s: PostingSchedule, dow: number): PostingSlot[] {
  if (s.activeDays && !s.activeDays[dow]) return []
  return (s.days[dow] ?? [])
    .slice(0, s.postsPerDay ?? MAX_POSTS_PER_DAY)
    .map((x, i) => ({ ...x, time: slotTime(s, i, x) }))
    .sort((a, b) => a.time.localeCompare(b.time))
}

/** The posts a weekday carries under the global rules (same as slotsForDate, by weekday). */
export function effectiveDaySlots(s: PostingSchedule, dow: number): PostingSlot[] {
  return slotsForWeekday(s, dow)
}

/**
 * What a week really carries once the day gap ("ימי רווח בין ימי פרסום")
 * has had its say: a routine day closer than `gapDays` to the previous
 * publishing day is skipped by "סידור אוטומטי", so it doesn't count.
 *
 * Walks the routine forward the way the planner fills it (every slot taken)
 * and reports the fewest / most posts and publishing days a calendar week
 * (Sunday–Saturday) ends up with. Without a gap, min === max === the plain
 * count.
 */
export type WeekLoad = {
  minPosts: number
  maxPosts: number
  minDays: number
  maxDays: number
  /** Routine days per week the gap cancels (most in any week). */
  skippedDays: number
}

export function weekLoad(s: PostingSchedule): WeekLoad {
  const perDay = [0, 1, 2, 3, 4, 5, 6].map((i) => effectiveDaySlots(s, i).length)
  const gap = Math.max(0, s.gapDays ?? 0)
  const WARMUP = 3
  const WEEKS = 12
  const weeks: { posts: number; days: number; skipped: number }[] = []
  let lastPublish = -Infinity
  for (let w = 0; w < WARMUP + WEEKS; w++) {
    const week = { posts: 0, days: 0, skipped: 0 }
    for (let dow = 0; dow < 7; dow++) {
      const n = perDay[dow]
      if (n === 0) continue
      const t = w * 7 + dow
      if (t - lastPublish <= gap) {
        week.skipped += 1
        continue
      }
      lastPublish = t
      week.posts += n
      week.days += 1
    }
    if (w >= WARMUP) weeks.push(week)
  }
  return {
    minPosts: Math.min(...weeks.map((x) => x.posts)),
    maxPosts: Math.max(...weeks.map((x) => x.posts)),
    minDays: Math.min(...weeks.map((x) => x.days)),
    maxDays: Math.max(...weeks.map((x) => x.days)),
    skippedDays: Math.max(...weeks.map((x) => x.skipped)),
  }
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
  if (a.postsPerDay !== b.postsPerDay || a.gapDays !== b.gapDays) return false
  if (a.formatGapDays !== b.formatGapDays) return false
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

// The routine is stored on the account (users.posting_schedule, via
// /api/schedule/settings) so it is the same on every device (QA 2026-11-15).
// localStorage is only this browser's copy for the first paint, tagged with
// the account it belongs to.

export const SCHEDULE_KEY = "nlcai.timing.posting_schedule"
const SETTINGS_API = "/api/schedule/settings"

type CachedSchedule = PostingSchedule & { _owner?: string }

function readCache(): CachedSchedule | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(SCHEDULE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedSchedule
    if (!Array.isArray(parsed?.days) || parsed.days.length !== 7) return null
    return parsed
  } catch (err) {
    console.warn("[posting-schedule] unreadable schedule, using default", err)
    return null
  }
}

function writeCache(s: PostingSchedule, owner: string | undefined): void {
  try {
    window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ ...s, _owner: owner }))
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULE_KEY }))
  } catch (err) {
    console.warn("[posting-schedule] could not cache schedule", err)
  }
}

function stripOwner(c: CachedSchedule): PostingSchedule {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _owner, ...s } = c
  return normalizeSchedule(s)
}

let knownOwner: string | undefined

/** This browser's copy of the saved schedule (first paint only), or null. */
export function getPostingSchedule(): PostingSchedule | null {
  const c = readCache()
  if (!c) return null
  // Another account's copy in this browser is not hers.
  if (knownOwner && c._owner && c._owner !== knownOwner) return null
  return stripOwner(c)
}

/**
 * The account's saved schedule. `null` = never saved (→ the default);
 * `undefined` = couldn't be read (keep what is shown).
 *
 * A routine saved before it moved to the account lives only in this browser:
 * the first read lifts it onto the account, so nothing she set is lost.
 */
export async function fetchPostingSchedule(): Promise<PostingSchedule | null | undefined> {
  try {
    const res = await fetch(SETTINGS_API, { cache: "no-store" })
    if (!res.ok) return undefined
    const json = (await res.json()) as { schedule?: PostingSchedule | null; userId?: string }
    knownOwner = json.userId
    const server = json.schedule
    if (server && Array.isArray(server.days) && server.days.length === 7) {
      const s = normalizeSchedule(server)
      writeCache(s, knownOwner)
      return s
    }
    const local = readCache()
    if (local && (!local._owner || local._owner === knownOwner)) {
      const s = stripOwner(local)
      if (await savePostingSchedule(s)) return s
      return s
    }
    return null
  } catch (err) {
    console.warn("[posting-schedule] could not read the saved schedule", err)
    return undefined
  }
}

/** Save to the account. Resolves false when it wasn't saved. */
export async function savePostingSchedule(s: PostingSchedule): Promise<boolean> {
  try {
    const res = await fetch(SETTINGS_API, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schedule: s }),
    })
    if (!res.ok) return false
    writeCache(s, knownOwner)
    return true
  } catch (err) {
    console.error("[posting-schedule] save failed", err)
    return false
  }
}

// --- pure edit helpers ------------------------------------------------------

export function withSlotUpdated(s: PostingSchedule, day: number, next: PostingSlot): PostingSchedule {
  const c = cloneSchedule(s)
  c.days[day] = c.days[day].map((x, i) => {
    if (x.id !== next.id) return x
    // A new hour picked by hand is an override of the global hour; the same
    // hour it already goes out at keeps the slot as it was.
    const changed = next.time !== slotTime(c, i, x)
    return changed ? { ...next, inherit: false } : { ...next, time: x.time, inherit: x.inherit }
  })
  return c
}

/**
 * Add a slot to a day. Copies the day's last slot one hour later when there
 * is one (the common case is "another one of these"), else a carousel at 09:00.
 */
export function withSlotAdded(s: PostingSchedule, day: number): PostingSchedule {
  const c = cloneSchedule(s)
  const n = c.days[day].length
  const last = c.days[day][n - 1]
  const taken = new Set(c.days[day].map((x, i) => slotTime(c, i, x)))
  // The global hour for this place in the day, when it's free → follow it.
  const globalHour = c.defaultTimes[n]
  let added: PostingSlot
  if (globalHour && !taken.has(globalHour)) {
    added = { id: newSlotId(), format: last?.format ?? "carousel", time: globalHour, inherit: true }
  } else {
    let time = "09:00"
    if (last) {
      const h = Math.min(23, parseInt(slotTime(c, n - 1, last), 10) + 1)
      time = `${String(h).padStart(2, "0")}:00`
    }
    added = { id: newSlotId(), format: last?.format ?? "carousel", time, inherit: false }
  }
  c.days[day] = [...c.days[day], added]
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

/**
 * Set (or clear, with null) the format of the i-th post of a day. New posts
 * follow the global hour. Edits the stored list in place: posts beyond the
 * current daily cap stay stored (raising the cap brings them back).
 */
export function withDayPost(s: PostingSchedule, day: number, index: number, format: FormatId | null): PostingSchedule {
  const c = cloneSchedule(s)
  const list = c.days[day]
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
  patch: Partial<Pick<PostingSchedule, "postsPerDay" | "gapDays" | "formatGapDays">> & { timeIndex?: number; time?: string },
): PostingSchedule {
  const c = cloneSchedule(s)
  if (patch.postsPerDay !== undefined) c.postsPerDay = patch.postsPerDay
  if (patch.gapDays !== undefined) c.gapDays = patch.gapDays
  if (patch.formatGapDays !== undefined) c.formatGapDays = patch.formatGapDays
  if (patch.timeIndex !== undefined && patch.time) c.defaultTimes[patch.timeIndex] = patch.time
  return c
}

/**
 * The routine "סידור אוטומטי" should follow. A routine she saved is hers —
 * even one with no publishing days at all (then nothing gets placed, and the
 * UI should say so). The suggested default applies only when nothing was
 * ever saved on the account.
 */
export function effectiveRoutine(saved: PostingSchedule, hasCustom: boolean): PostingSchedule {
  return hasCustom ? saved : defaultPostingSchedule()
}

// --- summary wording ---------------------------------------------------------

function countWords(min: number, max: number, one: string, many: string): string {
  if (min === max) return min === 1 ? one : `${min} ${many}`
  return `${min}–${max} ${many}`
}

/**
 * "פוסט אחד בשבוע · יום פרסום אחד", "3–4 פוסטים בשבוע · 2–3 ימי פרסום".
 * Counts what the planner will really place, after the day gap.
 */
export function weekLoadText(load: WeekLoad): string {
  const posts = countWords(load.minPosts, load.maxPosts, "פוסט אחד", "פוסטים")
  const days = countWords(load.minDays, load.maxDays, "יום פרסום אחד", "ימי פרסום")
  return `${posts} בשבוע · ${days}`
}
