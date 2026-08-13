/**
 * Timing storage — local persistence layer for the /calendar feature.
 *
 * Three namespaces live in localStorage:
 *   - SCHEDULED_KEY → ScheduledPost[]      : posts placed on a specific date
 *   - META_KEY:{id} → CorePostMeta         : per-post optional metadata (drive_url / product_id / trigger_word)
 *   - PUBLISHED_KEY:{id} → PublishedMark   : per-post "פורסם" timestamp(s) — keyed BY format
 *
 * Per-format model (2026-05-06):
 *   The original timing P0 modelled scheduling and publishing as a property
 *   of the core post. A core post, however, can be expressed as multiple
 *   formats (talking_head, carousel, image_post…) and the user wants to
 *   schedule and publish each format on its own clock. To keep the
 *   localStorage shape forwards-compatible without nuking existing data we
 *   use **migration helpers** that promote legacy rows on first read:
 *
 *     ScheduledPost.format        : was optional. Now REQUIRED. Legacy rows
 *                                   without `format` are stamped as
 *                                   "talking_head" on first read.
 *     ScheduledPost identity     : was (corePostId). Now (corePostId, format).
 *                                  → `getScheduledByPostId` now returns an
 *                                    array. Use `getScheduledByPostAndFormat`
 *                                    when you need a single slot.
 *     PublishedMark              : was `{publishedAt}`. Now
 *                                  `{[format]: {publishedAt}}`. Legacy
 *                                  payloads are migrated to
 *                                  `{talking_head: {publishedAt}}` on first
 *                                  read.
 *
 * The QUEUE namespace was removed in the live-feedback round (2026-05-05).
 * Previously the panel showed only posts the user had manually pushed into
 * a "queue" via the project-page CTA. That created a blind spot: most
 * posts the user created never made it to the queue, so the panel felt
 * empty even when the inventory was full. The new model is binary —
 * "scheduled" (in SCHEDULED_KEY) or "not scheduled" (everything else,
 * sourced from the server). The queue panel now reads from the API and
 * filters out scheduled ids; nothing in localStorage tracks "in queue"
 * because the concept no longer exists.
 *
 * Why localStorage and not Supabase for the rest? Spinal P0 — we want the
 * timing loop working end-to-end before we commit to a server-side schema.
 * Anything that proves itself here graduates to a real table.
 *
 * All write helpers dispatch a synthetic `storage` event after writing so
 * components on the SAME tab pick up changes (the native `storage` event
 * only fires across tabs). Without this the queue panel and the calendar
 * grid would not stay in sync without a hard reload.
 */

export type FormatId = "talking_head" | "carousel" | "image_post" | string

/**
 * Default format used for the "single format era" → "per-format era" migration.
 * Any legacy row without an explicit format gets stamped as talking_head,
 * because that was the only format the original scheduler exercised in P0.
 */
export const LEGACY_DEFAULT_FORMAT: FormatId = "talking_head"

export type ScheduledPost = {
  /** Reference to the core post being scheduled. */
  corePostId: string
  /**
   * Format being scheduled. REQUIRED in the per-format model — a single
   * core post can be on the calendar multiple times, once per format.
   * Identity is (corePostId, format).
   */
  format: FormatId
  /** YYYY-MM-DD. Day-resolution date the post is scheduled for. */
  scheduledDate: string
  /** "HH:00" — whole hour 07–23. Defaults to "09:00" at read time when missing. */
  scheduledTime?: string | null
  /**
   * ISO timestamp set by the future "פורסם" action (P1). null until then.
   * Mirrors PUBLISHED_KEY[corePostId][format].publishedAt — kept on the
   * scheduled row so calendar reads don't need a second lookup.
   */
  publishedAt: string | null
  /** Optional cached fields for the day-cell chip so we don't need a join. */
  hook?: string
}

/**
 * Per-format slice of meta (Sheet refactor 2026-05-06).
 *
 * The original Sheet collected one drive URL + one trigger word per post — a
 * post-level model that didn't survive contact with the per-format reality.
 * Each format has its own deliverable and therefore its own assets folder
 * (so its own drive URL) and its own automation (so its own trigger word).
 *
 * We DON'T migrate post-level values into `byFormat[someFormat]` on first
 * read — that would be a guess about which format owns the legacy values.
 * Instead, the post-level fields stay where they are and act as a fallback
 * for any format whose own slice hasn't been populated yet. The first time
 * the user types a value into a per-format input, that format gets its own
 * entry; the post-level value remains untouched (so other formats still see
 * it as a fallback) until the user explicitly edits it for them too.
 */
export type CorePostFormatMeta = {
  driveUrl?: string
  triggerWord?: string
  /**
   * Carousel only: the template the current saved carousel was generated
   * with. Absent when the carousel came from a Drive import — that's how the
   * panel tells "made here" from "brought in" and decides where to show it.
   */
  templateId?: string
  /**
   * Carousel only: where the caption sits on a slide the user brought —
   * "top" | "center" | "bottom", one choice for the whole carousel.
   *
   * Persisted (unlike the image post's, which is component state) because
   * the slides themselves are saved: a picker that reset to "bottom" while
   * the stored slides carried the caption at the top would be the panel
   * lying about what the post looks like.
   */
  captionPosition?: "top" | "center" | "bottom"
  /**
   * Carousel only: whether the slides the user brought carry the caption at
   * all. Persisted for the same reason as the position — the slides are
   * saved, so a control that reset to "on" over stored bare slides would be
   * the panel lying about what the post looks like.
   */
  captionOn?: boolean
}

/** Per-post optional metadata captured in the Sheet (task #B). */
export type CorePostMeta = {
  /** Legacy post-level drive URL — fallback when a format has no own value. */
  driveUrl?: string
  productId?: string | null
  /** Legacy post-level trigger word — fallback when a format has no own value. */
  triggerWord?: string
  /**
   * Per-format slices. Optional and partial — formats without an entry simply
   * inherit the post-level fallback above. Adding/removing keys is done via
   * `setFormatMeta` (don't write this object directly from the UI).
   */
  byFormat?: Partial<Record<FormatId, CorePostFormatMeta>>
}

/** One per-format published mark. */
export type PublishedMark = {
  /** ISO timestamp when the user marked the post+format as published. */
  publishedAt: string
}

/**
 * Per-post published map — one entry per format the user has marked as
 * published. Stored at PUBLISHED_KEY:{corePostId}.
 */
export type PublishedMap = Record<FormatId, PublishedMark>

/**
 * Status of a single (corePost, format) pair, derived from the API post
 * + scheduled rows + published map. Pure projection — no I/O inside.
 */
export type FormatReadiness =
  | "empty"
  | "incomplete"
  | "ready"
  | "scheduled"
  | "published"

const SCHEDULED_KEY = "nlcai.timing.scheduled"
const META_KEY_PREFIX = "nlcai.timing.core_post_meta:"
const PUBLISHED_KEY_PREFIX = "nlcai.timing.published:"

/** Default hour we drop posts into when no time is supplied. */
export const DEFAULT_SCHEDULED_TIME = "09:00"

/**
 * Format a Date as YYYY-MM-DD in local time (NOT UTC).
 * We keep dates in local time on purpose: the calendar is a human artifact,
 * and "the 5th of May" should mean the same thing regardless of timezone.
 */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * Safe JSON read — returns [] on missing key, parse error, or non-array shape.
 * Errors are surfaced via console.warn so they show up in dev without
 * crashing the calendar (which would block the user from any other action).
 */
function readArray<T>(key: string): T[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn(`[timing-storage] expected array at ${key}, got`, typeof parsed)
      return []
    }
    return parsed as T[]
  } catch (err) {
    console.warn(`[timing-storage] failed to read ${key}`, err)
    return []
  }
}

function readObject<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return parsed as T
  } catch (err) {
    console.warn(`[timing-storage] failed to read ${key}`, err)
    return null
  }
}

/**
 * Persist an array AND notify same-tab listeners. The native `storage` event
 * only fires across tabs, but every consumer in this app needs same-tab
 * updates — so we dispatch a synthetic StorageEvent. Listeners just key off
 * `e.key`, the same way they would for a cross-tab update.
 */
function writeArray<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return
  try {
    const next = JSON.stringify(value)
    window.localStorage.setItem(key, next)
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }))
  } catch (err) {
    console.warn(`[timing-storage] failed to write ${key}`, err)
  }
}

function writeObject<T>(key: string, value: T): void {
  if (typeof window === "undefined") return
  try {
    const next = JSON.stringify(value)
    window.localStorage.setItem(key, next)
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }))
  } catch (err) {
    console.warn(`[timing-storage] failed to write ${key}`, err)
  }
}

function removeKey(key: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: null }))
  } catch (err) {
    console.warn(`[timing-storage] failed to remove ${key}`, err)
  }
}

// --- Server mirror --------------------------------------------------------

/**
 * The calendar graduated to a real table (migration 026) but kept its
 * synchronous API.
 *
 * Rewriting all twelve consumers to async would have been a large, risky
 * refactor of a live board for no user-visible gain, so the model is
 * write-through instead: localStorage stays the read cache every component
 * already reads synchronously, and each write additionally fires a
 * background request at `/api/schedule`. On page load `syncScheduledFromServer`
 * replaces the cache with the server's copy.
 *
 * That makes the table the source of truth. Two things depend on it:
 *   - The board follows Hani across browsers and devices.
 *   - Chandler (the newsletter agent) reads the week's calendar from the
 *     cloud on Saturday night, when no tab is open.
 *
 * Mirror failures are deliberately non-fatal: a failed request logs and the
 * local write stands, so a dropped connection can never block scheduling.
 * The next successful sync reconciles.
 */

const SCHEDULE_API = "/api/schedule"

/**
 * Set once the first successful server sync has happened in this browser.
 * Gates the one-time backfill so we only ever lift a pre-026 localStorage
 * board upward once — without it, clearing the board on another device would
 * be silently undone by this browser's stale cache on next load.
 */
const BACKFILL_FLAG = "nlcai.timing.backfilled"

function mirrorFailed(action: string, detail: unknown): void {
  console.warn(`[timing-storage] server mirror failed (${action})`, detail)
}

/** Upsert one row or a batch on the server. Fire-and-forget. */
function mirrorUpsert(rows: ScheduledPost[]): void {
  if (typeof window === "undefined" || rows.length === 0) return
  void fetch(SCHEDULE_API, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rows.length === 1 ? rows[0] : { rows }),
  })
    .then((res) => {
      if (!res.ok) mirrorFailed("upsert", res.status)
    })
    .catch((err) => mirrorFailed("upsert", err))
}

/** Delete a slot (or every slot of a post when `format` is omitted). */
function mirrorDelete(corePostId: string, format?: FormatId): void {
  if (typeof window === "undefined") return
  const qs = new URLSearchParams({ corePostId })
  if (format) qs.set("format", format)
  void fetch(`${SCHEDULE_API}?${qs.toString()}`, { method: "DELETE" })
    .then((res) => {
      if (!res.ok) mirrorFailed("delete", res.status)
    })
    .catch((err) => mirrorFailed("delete", err))
}

/**
 * Rebuild the per-format published marks from the server's scheduled rows.
 *
 * `publishedAt` lives in two places by design — on the scheduled row (so a
 * calendar read is one lookup) and in the PUBLISHED_KEY map (which
 * `getFormatReadiness` consults). Only the scheduled row round-trips to the
 * server, so after a hydrate we re-derive the map for every post that has a
 * slot. Posts with no slot keep whatever mark they had locally: they aren't
 * on the board, so nothing on the calendar depends on them.
 */
function rebuildPublishedFromScheduled(rows: ScheduledPost[]): void {
  if (typeof window === "undefined") return
  const byPost = new Map<string, ScheduledPost[]>()
  for (const row of rows) {
    const list = byPost.get(row.corePostId) ?? []
    list.push(row)
    byPost.set(row.corePostId, list)
  }

  for (const [corePostId, postRows] of byPost) {
    const current = readPublishedMap(corePostId)
    const next: PublishedMap = { ...current }
    for (const row of postRows) {
      if (row.publishedAt) {
        next[row.format] = { publishedAt: row.publishedAt }
      } else {
        delete next[row.format]
      }
    }
    const key = PUBLISHED_KEY_PREFIX + corePostId
    if (Object.keys(next).length === 0) {
      if (Object.keys(current).length > 0) removeKey(key)
    } else {
      writeObject(key, next)
    }
  }
}

/**
 * Pull the board from the server and make it the local cache.
 *
 * Call this once per page load (see `<TimingSync/>` in the app shell). It is
 * intentionally forgiving: a signed-out user, an offline laptop or a 500 all
 * leave the existing cache untouched rather than blanking the calendar.
 *
 * First run in a browser that predates 026 finds an empty server board and a
 * populated local one — that is the backfill case, and the local rows are
 * pushed up instead of being overwritten.
 */
export async function syncScheduledFromServer(): Promise<void> {
  if (typeof window === "undefined") return
  try {
    const res = await fetch(SCHEDULE_API, { cache: "no-store" })
    if (!res.ok) return
    const data = (await res.json()) as { scheduled?: unknown }
    const server = Array.isArray(data.scheduled)
      ? (data.scheduled as ScheduledPost[])
      : []

    const alreadyBackfilled = window.localStorage.getItem(BACKFILL_FLAG) === "1"
    const local = readScheduledRaw()

    if (!alreadyBackfilled && server.length === 0 && local.length > 0) {
      mirrorUpsert(local)
      window.localStorage.setItem(BACKFILL_FLAG, "1")
      return
    }

    window.localStorage.setItem(BACKFILL_FLAG, "1")
    writeArray(SCHEDULED_KEY, server)
    rebuildPublishedFromScheduled(server)
  } catch (err) {
    mirrorFailed("sync", err)
  }
}

// --- Scheduled posts ------------------------------------------------------

/**
 * Read raw scheduled rows and migrate any legacy entries (rows without an
 * explicit `format`) to `LEGACY_DEFAULT_FORMAT`. We persist the migrated
 * shape immediately so callers downstream don't need to re-migrate, and so
 * the synthetic storage event keeps subscribers in sync.
 */
function readScheduledRaw(): ScheduledPost[] {
  type LegacyScheduledPost = Omit<ScheduledPost, "format"> & {
    format?: FormatId | null
  }
  const raw = readArray<LegacyScheduledPost>(SCHEDULED_KEY)
  if (raw.length === 0) return []

  let migrated = false
  const next: ScheduledPost[] = raw.map((row) => {
    if (row.format) return row as ScheduledPost
    migrated = true
    return { ...row, format: LEGACY_DEFAULT_FORMAT }
  })

  if (migrated) {
    // Persist the migrated shape so the next reader sees it as canonical.
    // We avoid `writeArray` here to skip an extra storage event — callers
    // that triggered this read already expect the same data.
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SCHEDULED_KEY, JSON.stringify(next))
      } catch (err) {
        console.warn(`[timing-storage] failed to persist scheduled migration`, err)
      }
    }
  }

  return next
}

/** Read all scheduled posts. */
export function getScheduledPosts(): ScheduledPost[] {
  return readScheduledRaw()
}

/** Read scheduled posts for a single day key (YYYY-MM-DD). */
export function getScheduledForDate(dateKey: string): ScheduledPost[] {
  return getScheduledPosts().filter((p) => p.scheduledDate === dateKey)
}

/**
 * All scheduled rows for a given core post — one per format. Use this when
 * the caller wants to know "is this post on the calendar at all" without
 * caring which format. For a specific (post, format) pair use
 * `getScheduledByPostAndFormat`.
 *
 * Breaking change (per-format era): this used to return a single row.
 * Callsites that need a single slot should switch to
 * `getScheduledByPostAndFormat`.
 */
export function getScheduledByPostId(corePostId: string): ScheduledPost[] {
  return getScheduledPosts().filter((p) => p.corePostId === corePostId)
}

/** Find the scheduled row for a specific (corePostId, format) — or null. */
export function getScheduledByPostAndFormat(
  corePostId: string,
  format: FormatId,
): ScheduledPost | null {
  return (
    getScheduledPosts().find(
      (p) => p.corePostId === corePostId && p.format === format,
    ) ?? null
  )
}

/** Whether a post has at least one scheduled format. */
export function isScheduled(corePostId: string): boolean {
  return getScheduledPosts().some((p) => p.corePostId === corePostId)
}

/** Whether a specific (post, format) is scheduled. */
export function isFormatScheduled(corePostId: string, format: FormatId): boolean {
  return getScheduledPosts().some(
    (p) => p.corePostId === corePostId && p.format === format,
  )
}

/**
 * Place a (post, format) on a specific date/time, or update its slot if it
 * already has one. Identity is (corePostId, format) — the same post can have
 * multiple slots, one per format.
 *
 * Naming note: this used to be `scheduleFromQueue` because it removed the
 * post from a local "queue" namespace as part of the same write. The queue
 * concept is gone (the panel reads from the server and filters scheduled
 * ids), so this is now just `schedulePost`. The `format` parameter is now
 * required — callers must commit to a format at schedule time.
 */
export function schedulePost(
  corePostId: string,
  format: FormatId,
  date: string,
  time: string = DEFAULT_SCHEDULED_TIME,
  cached?: { hook?: string },
): void {
  const scheduled = getScheduledPosts()
  const existing = scheduled.find(
    (p) => p.corePostId === corePostId && p.format === format,
  )
  const next: ScheduledPost = {
    corePostId,
    format,
    scheduledDate: date,
    scheduledTime: time,
    publishedAt: existing?.publishedAt ?? null,
    hook: cached?.hook ?? existing?.hook,
  }
  const others = scheduled.filter(
    (p) => !(p.corePostId === corePostId && p.format === format),
  )
  writeArray(SCHEDULED_KEY, [...others, next])
  mirrorUpsert([next])
}

/**
 * Remove a (post, format) scheduled slot. Used by "בטלו תזמון" — the post
 * itself still exists; that single format just goes back to "unscheduled"
 * and reappears in the panel automatically.
 *
 * Naming note: this used to be `unscheduleToQueue` because it added the
 * post back to a local "queue" namespace. The queue is gone, so this is
 * now just `unschedulePost`.
 */
export function unschedulePost(corePostId: string, format: FormatId): void {
  const scheduled = getScheduledPosts()
  const filtered = scheduled.filter(
    (p) => !(p.corePostId === corePostId && p.format === format),
  )
  if (filtered.length === scheduled.length) return
  writeArray(SCHEDULED_KEY, filtered)
  mirrorDelete(corePostId, format)
}

/**
 * Hard remove from scheduled + clear all per-post local state. Used when
 * the underlying core post is deleted — there's nothing left to schedule.
 * Removes ALL formats of this post (the post itself is gone).
 */
export function removeFromTiming(corePostId: string): void {
  const scheduled = getScheduledPosts()
  const filtered = scheduled.filter((p) => p.corePostId !== corePostId)
  if (filtered.length !== scheduled.length) {
    writeArray(SCHEDULED_KEY, filtered)
  }
  // Unconditional: the post is gone, so clear the server side even when this
  // browser's cache never had a row for it.
  mirrorDelete(corePostId)
  // Also clear meta and published.
  removeKey(META_KEY_PREFIX + corePostId)
  removeKey(PUBLISHED_KEY_PREFIX + corePostId)
}

// --- Per-post metadata ---------------------------------------------------

/** Read meta for a post (drive/product/trigger). Empty object if missing. */
export function getCorePostMeta(corePostId: string): CorePostMeta {
  const obj = readObject<CorePostMeta>(META_KEY_PREFIX + corePostId)
  return obj ?? {}
}

/** Patch meta — merges with what's there, doesn't overwrite untouched keys. */
export function setCorePostMeta(corePostId: string, patch: CorePostMeta): void {
  const current = getCorePostMeta(corePostId)
  writeObject(META_KEY_PREFIX + corePostId, { ...current, ...patch })
}

/**
 * Read the effective per-format meta for a (post, format), falling back to
 * the post-level legacy fields when the format has no own value.
 *
 * Why a getter and not a raw `meta.byFormat[format]` access?
 *   1. Fallback to legacy post-level fields lives in ONE place — every
 *      surface (Sheet, future calendar tile, future automation hook) sees
 *      the same effective value without each one re-implementing the
 *      "byFormat ?? post-level" merge.
 *   2. Lets us evolve the storage shape without touching call sites: when
 *      the post-level fields finally retire, only this function changes.
 *
 * Returns an object — never null — so callers can `.driveUrl` / `.triggerWord`
 * without nullish-checking the wrapper.
 */
export function getFormatMeta(
  corePostId: string,
  format: FormatId,
): CorePostFormatMeta {
  const meta = getCorePostMeta(corePostId)
  const slice = meta.byFormat?.[format] ?? {}
  return {
    driveUrl: slice.driveUrl ?? meta.driveUrl,
    triggerWord: slice.triggerWord ?? meta.triggerWord,
    templateId: slice.templateId,
    captionPosition: slice.captionPosition,
    captionOn: slice.captionOn,
  }
}

/**
 * Patch the per-format slice for a (post, format). Merges with the existing
 * slice — keys in `patch` set as `undefined` are stripped, so callers can
 * "clear back to fallback" by passing `undefined` (e.g. user emptied the
 * input and we want the post-level value to take over again).
 *
 * Always preserves untouched keys in `byFormat` for OTHER formats. The
 * post-level legacy fields are NEVER mutated here.
 */
export function setFormatMeta(
  corePostId: string,
  format: FormatId,
  patch: Partial<CorePostFormatMeta>,
): void {
  const current = getCorePostMeta(corePostId)
  const currentSlice = current.byFormat?.[format] ?? {}
  const nextSlice: CorePostFormatMeta = { ...currentSlice }

  // Apply patch: undefined means "clear this key, fall back to post-level".
  for (const key of Object.keys(patch) as Array<keyof CorePostFormatMeta>) {
    const val = patch[key]
    if (val === undefined) {
      delete nextSlice[key]
    } else {
      // The value came off the SAME key of `patch`, so it is the right type
      // by construction — TS just can't carry that through a union-typed key
      // once the fields stop all being plain strings (`captionPosition` is a
      // literal union). Assigning per-key keeps that provable at every call
      // site, which a widened field type would not.
      Object.assign(nextSlice, { [key]: val })
    }
  }

  // If the slice is now empty AND it existed before, drop the key so storage
  // stays tidy and `byFormat` reflects "no overrides for this format".
  const nextByFormat: Partial<Record<FormatId, CorePostFormatMeta>> = {
    ...(current.byFormat ?? {}),
  }
  if (Object.keys(nextSlice).length === 0) {
    delete nextByFormat[format]
  } else {
    nextByFormat[format] = nextSlice
  }

  writeObject(META_KEY_PREFIX + corePostId, {
    ...current,
    byFormat: Object.keys(nextByFormat).length > 0 ? nextByFormat : undefined,
  })
}

// --- Published mark ------------------------------------------------------

/**
 * Read the per-format published map for a post. Migrates a legacy
 * single-shape payload (`{publishedAt}`) into the per-format shape
 * (`{talking_head: {publishedAt}}`) and persists the migrated payload so
 * downstream readers see it as canonical.
 */
function readPublishedMap(corePostId: string): PublishedMap {
  const key = PUBLISHED_KEY_PREFIX + corePostId
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    // Legacy shape detection: a flat `{publishedAt: string}` object.
    if (
      typeof (parsed as { publishedAt?: unknown }).publishedAt === "string" &&
      !Object.values(parsed as Record<string, unknown>).some(
        (v) => v && typeof v === "object",
      )
    ) {
      const legacyAt = (parsed as { publishedAt: string }).publishedAt
      const migrated: PublishedMap = {
        [LEGACY_DEFAULT_FORMAT]: { publishedAt: legacyAt },
      }
      try {
        window.localStorage.setItem(key, JSON.stringify(migrated))
      } catch (err) {
        console.warn(`[timing-storage] failed to persist published migration`, err)
      }
      return migrated
    }

    // Already per-format shape — pass through, but keep only well-formed entries.
    const out: PublishedMap = {}
    for (const [fmt, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        val &&
        typeof val === "object" &&
        typeof (val as { publishedAt?: unknown }).publishedAt === "string"
      ) {
        out[fmt] = { publishedAt: (val as { publishedAt: string }).publishedAt }
      }
    }
    return out
  } catch (err) {
    console.warn(`[timing-storage] failed to read ${key}`, err)
    return {}
  }
}

/** All published marks for a post, keyed by format. */
export function getPublishedMap(corePostId: string): PublishedMap {
  return readPublishedMap(corePostId)
}

/** Read the published mark for a specific (post, format). null if not marked. */
export function getPublishedMark(
  corePostId: string,
  format: FormatId,
): PublishedMark | null {
  const map = readPublishedMap(corePostId)
  return map[format] ?? null
}

/** Whether ANY format of this post is marked published. */
export function isAnyFormatPublished(corePostId: string): boolean {
  return Object.keys(readPublishedMap(corePostId)).length > 0
}

/** Mark a specific (post, format) as published with `now` timestamp. */
export function markPublished(corePostId: string, format: FormatId): void {
  const now = new Date().toISOString()
  const current = readPublishedMap(corePostId)
  const next: PublishedMap = { ...current, [format]: { publishedAt: now } }
  writeObject(PUBLISHED_KEY_PREFIX + corePostId, next)

  // Also stamp the matching scheduled row so calendar reads stay in sync
  // without a double lookup.
  const scheduled = getScheduledPosts()
  const idx = scheduled.findIndex(
    (p) => p.corePostId === corePostId && p.format === format,
  )
  if (idx >= 0) {
    const updated = [...scheduled]
    updated[idx] = { ...updated[idx], publishedAt: now }
    writeArray(SCHEDULED_KEY, updated)
    mirrorUpsert([updated[idx]])
  }
}

/** Unmark — used for "ביטול סימון פרסום" on a specific format. */
export function unmarkPublished(corePostId: string, format: FormatId): void {
  const current = readPublishedMap(corePostId)
  if (!(format in current)) {
    // Nothing to unmark — but still clear the scheduled stamp if present
    // to keep state consistent.
  } else {
    const next: PublishedMap = { ...current }
    delete next[format]
    if (Object.keys(next).length === 0) {
      removeKey(PUBLISHED_KEY_PREFIX + corePostId)
    } else {
      writeObject(PUBLISHED_KEY_PREFIX + corePostId, next)
    }
  }

  const scheduled = getScheduledPosts()
  const idx = scheduled.findIndex(
    (p) => p.corePostId === corePostId && p.format === format,
  )
  if (idx >= 0) {
    const updated = [...scheduled]
    updated[idx] = { ...updated[idx], publishedAt: null }
    writeArray(SCHEDULED_KEY, updated)
    mirrorUpsert([updated[idx]])
  }
}

// --- Pure helpers (no I/O outside of the storage reads above) ------------

/**
 * Minimum projection of an API core post needed to derive readiness.
 * The Sheet/QueuePanel/ /core_posts pages already shape posts this way.
 */
export type ReadinessPostInput = {
  id: string
  /** Format ids the post has been duplicated into (has a format_variants row). */
  formats: string[]
  /** Subset of `formats` whose variants have at least one media asset. */
  formatsWithMedia?: string[]
  /**
   * Whether the post has a non-empty post-level body. Used as a fallback for
   * "this format is ready because it inherits the global script". Phase 3a
   * promoted format readiness to per-format scripts (`hasBodyByFormat`); when
   * that map is provided, the per-format value takes precedence and this
   * field is only consulted as a last-resort fallback (e.g. legacy callers
   * that don't yet pass per-format bodies).
   */
  hasBody?: boolean
  /**
   * Per-format script presence — `true` if `formatPosts[format]` is a
   * non-empty string. When provided, this is the authoritative signal for
   * "format has a script"; the post-level `hasBody` is only used when the
   * map is absent OR when a specific format isn't present in it.
   */
  hasBodyByFormat?: Partial<Record<FormatId, boolean>>
}

/**
 * Status of a single (post, format) pair. Pure-ish function — does NOT
 * touch the DOM or the network, but DOES read localStorage (CorePostMeta)
 * so the readiness bar stays consistent with whatever the Sheet wrote.
 *
 * Order of precedence (highest first):
 *   1. published  → user marked it as posted
 *   2. scheduled  → has a row in SCHEDULED_KEY for this format
 *   3. ready      → has script AND (has media OR has drive link)
 *   4. empty      → otherwise
 *
 * "Ready" definition (per Hani):
 *   - The format must be present in `post.formats` (i.e. duplicated).
 *   - AND it has a script (per-format body, post-level body as fallback).
 *   - AND it has media (in `formatsWithMedia`) OR a drive URL
 *     (per-format `meta.byFormat[format].driveUrl`, post-level
 *     `meta.driveUrl` as fallback).
 *
 * The drive URL check mirrors `isReadyForScheduling` so a user can park
 * media in Drive and still schedule without uploading to our store.
 */
export function getFormatReadiness(
  post: ReadinessPostInput,
  format: FormatId,
): FormatReadiness {
  if (getPublishedMark(post.id, format)) return "published"
  if (isFormatScheduled(post.id, format)) return "scheduled"

  const isDuplicated = post.formats.includes(format)
  if (!isDuplicated) return "empty"

  // Per-format script first; fall back to post-level body for callers that
  // haven't been updated to pass `hasBodyByFormat` yet (Phase 3a transition).
  const perFormatBody = post.hasBodyByFormat?.[format]
  const hasBody =
    perFormatBody !== undefined ? perFormatBody : !!post.hasBody
  if (!hasBody) return "empty"

  const hasMedia = (post.formatsWithMedia ?? []).includes(format)
  if (hasMedia) return "ready"

  // Drive URL fallback — per-format slice, then post-level legacy.
  const meta = getCorePostMeta(post.id)
  const formatDriveUrl =
    meta.byFormat?.[format]?.driveUrl ?? meta.driveUrl ?? ""
  if (formatDriveUrl.trim().length > 0) return "ready"

  // Format was duplicated and has a script, but no media or drive URL —
  // it's "started but not yet shippable". Per Hani: this should look
  // distinct from "empty" (which means "never duplicated") so the user
  // can tell the difference at a glance.
  return "incomplete"
}

/**
 * "Is this post ready to be scheduled at all?" — used by the QueuePanel's
 * READY filter. A post counts as schedulable if at least one of its formats
 * passes a low bar:
 *
 *   - the post body is non-empty (so there's something to express), AND
 *   - the format has at least one media asset OR a drive_url override.
 *
 * `product_id` and `trigger_word` are NOT required here — they're funnel
 * metadata, not "is the content shootable" gating.
 *
 * Implementation note: this helper consciously skips the per-format media
 * check when a `driveUrl` is present in CorePostMeta — the user is allowed
 * to schedule by promising "media lives in my drive" without uploading it
 * to our store.
 */
export function isReadyForScheduling(post: ReadinessPostInput): boolean {
  if (!post.hasBody) return false

  const formatsWithMedia = post.formatsWithMedia ?? []
  if (formatsWithMedia.length > 0) return true

  // Drive URL fallback — only checked when no native media exists.
  const meta = getCorePostMeta(post.id)
  if (meta.driveUrl && meta.driveUrl.trim().length > 0) return true

  return false
}

/**
 * "Does this post have an external media link?" — a Drive / Canva / any other
 * media URL the user parked instead of uploading to our store. The `driveUrl`
 * field is the generic external-link slot (named for the original Drive case,
 * but it holds any pasted media URL).
 *
 * Checks the post-level legacy field AND every per-format slice, so a link
 * pasted into a single format still counts. Used by the floating schedule bar
 * to decide whether the post has anything publishable — a post with no media
 * (no upload, no link) has nothing to schedule, so the bar stays hidden.
 */
export function hasExternalMediaLink(corePostId: string): boolean {
  const meta = getCorePostMeta(corePostId)
  if (meta.driveUrl && meta.driveUrl.trim().length > 0) return true
  const slices = meta.byFormat ? Object.values(meta.byFormat) : []
  return slices.some((slice) => !!slice?.driveUrl && slice.driveUrl.trim().length > 0)
}

// --- Storage keys --------------------------------------------------------

/**
 * Storage keys — exported so callers can target them with `storage` events.
 * Per-post keys (meta / published) use PREFIX + id; consumers should match
 * with `e.key?.startsWith(...)`.
 */
export const TIMING_KEYS = {
  scheduled: SCHEDULED_KEY,
  metaPrefix: META_KEY_PREFIX,
  publishedPrefix: PUBLISHED_KEY_PREFIX,
} as const
