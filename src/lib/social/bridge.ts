/**
 * The bridge: a calendar slot becomes a queued Instagram post, and stays one.
 *
 * Until this file, the calendar and the publishing pipeline never met. The
 * board wrote `scheduled_posts`; `src/lib/social` could queue a post; nothing
 * called one from the other, so a post on the board was a date and nothing
 * else (Hani, 2026-10-15).
 *
 * ---- The rules this file enforces ----
 *
 * 1. The board is the source of truth. The instant sent to the provider is
 *    always computed from the row's own date + hour (Israel time), never from
 *    the weekly posting routine, never from anything a suggestion engine
 *    proposed. Whatever moves the row moves the provider; nothing else does.
 *
 * 2. "Queued" means the provider gave us an id and, read back, holds the
 *    board's time. Every other outcome is `failed` with a reason she can act
 *    on, or `pending` while a call is in flight. Never a quiet in-between.
 *
 * 3. One slot, one provider post. A row with a provider id is moved, never
 *    re-created; a row being worked on is locked (`pending`), so a double
 *    click, a retry and a fast second drag cannot create two posts.
 *
 * 4. Nothing leaves the queue without the provider confirming it. Removing a
 *    slot, deleting its post, or disconnecting the account cancels at the
 *    provider first; if that cancel fails, the slot stays on the board,
 *    marked, rather than vanishing from her view while still going out.
 *
 * Everything runs with the caller's user-scoped client: every row it touches
 * is hers, so RLS stays on.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  Database,
  ScheduledPostRow,
  SocialAccountRow,
} from "@/lib/supabase/types"
import { assembleScheduledPost } from "./assemble"
import { getSocialPublisher } from "./index"
import {
  PUBLISH_FLOOR_MS,
  decodePublishError,
  encodePublishError,
  type PublishErrorCode,
  type PublishState,
} from "./publish-state"
import { slotToInstant } from "./slot-time"
import { SocialPublishError, type SocialPublisher } from "./types"

type Db = SupabaseClient<Database>

/** A `pending` lock older than this belongs to a request that died. */
const LOCK_STALE_MS = 2 * 60 * 1000

/** A read-back that disagrees by more than this is a mismatch, not rounding. */
const READBACK_TOLERANCE_MS = 60 * 1000

/** After the slot time, how long before "still waiting" becomes "יצא לפרסום". */
const SENT_GRACE_MS = 15 * 60 * 1000

const SLOT_COLUMNS =
  "id, user_id, core_post_id, format, scheduled_date, scheduled_time, published_at, social_account_id, provider_post_id, publish_status, publish_error, publish_synced_at"

type SlotRow = Pick<
  ScheduledPostRow,
  | "id"
  | "user_id"
  | "core_post_id"
  | "format"
  | "scheduled_date"
  | "scheduled_time"
  | "published_at"
  | "social_account_id"
  | "provider_post_id"
  | "publish_status"
  | "publish_error"
  | "publish_synced_at"
>

type SlotPatch = Partial<
  Pick<
    ScheduledPostRow,
    | "social_account_id"
    | "provider_post_id"
    | "publish_status"
    | "publish_error"
    | "publish_synced_at"
    | "published_at"
  >
>

const GENERIC_FAILURE = "משהו השתבש מול אינסטגרם, והפוסט לא תוזמן. אפשר לנסות שוב."

export const slotKey = (corePostId: string, format: string) => `${corePostId}:${format}`

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** The wire state for a row — what every card reads. */
export function toPublishState(
  row: Pick<
    SlotRow,
    "scheduled_date" | "scheduled_time" | "published_at" | "publish_status" | "publish_error"
  >,
  extra?: Partial<PublishState>,
): PublishState {
  let publishAt: string | null = null
  try {
    publishAt = slotToInstant(row.scheduled_date, row.scheduled_time).toISOString()
  } catch {
    // An unreadable slot simply has no instant to show.
  }

  if (row.published_at) {
    return { status: "published", publishAt, publishedAt: row.published_at, ...extra }
  }

  const err = decodePublishError(row.publish_error)
  return {
    status: row.publish_status ?? "idle",
    code: err?.code ?? null,
    message: err?.message ?? null,
    publishAt,
    publishedAt: null,
    ...extra,
  }
}

async function loadSlot(
  db: Db,
  userId: string,
  corePostId: string,
  format: string,
): Promise<SlotRow | null> {
  const { data, error } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .eq("core_post_id", corePostId)
    .eq("format", format)
    .maybeSingle()
  // A failed read is not "no row". Treating it as one would answer "board
  // only" for a slot that may well be queued (found on 2026-10-18, when the
  // database dropped mid-test and every slot read back as idle).
  if (error) throw new BridgeReadError(error.message)
  return (data as SlotRow | null) ?? null
}

/** The database didn't answer. Never mistaken for "nothing there". */
class BridgeReadError extends Error {
  constructor(detail: string) {
    super(`scheduled_posts/social_accounts read failed: ${detail}`)
    this.name = "BridgeReadError"
  }
}

/**
 * The account a new slot publishes to.
 *
 * One Instagram account per user today. A lapsed connection is returned
 * rather than skipped, so the caller can say "reconnect" instead of
 * pretending the user never connected at all.
 */
export async function activeAccount(db: Db, userId: string): Promise<SocialAccountRow | null> {
  const { data, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "revoked")
    .order("connected_at", { ascending: false })
  if (error) throw new BridgeReadError(error.message)
  const rows = (data ?? []) as SocialAccountRow[]
  return rows.find((r) => r.status === "connected") ?? rows[0] ?? null
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** Patch one row. Returns false when the row is gone (deleted mid-flight). */
async function patchSlot(db: Db, row: Pick<SlotRow, "id" | "user_id">, patch: SlotPatch) {
  const { data, error } = await db
    .from("scheduled_posts")
    .update(patch as never)
    .eq("id", row.id)
    .eq("user_id", row.user_id)
    .select("id")
  if (error) {
    console.error("[social/bridge] could not write slot state", row.id, error.message)
    return false
  }
  return ((data ?? []) as unknown[]).length > 0
}

function failurePatch(code: PublishErrorCode, message: string): SlotPatch {
  return {
    publish_status: "failed",
    publish_error: encodePublishError(code, message),
    publish_synced_at: new Date().toISOString(),
  }
}

/**
 * Take the row lock. Only one request at a time may talk to the provider
 * about a given slot — the difference between a double click and two posts.
 */
async function claimSlot(db: Db, row: SlotRow): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString()
  const { data } = await db
    .from("scheduled_posts")
    .update({
      publish_status: "pending",
      publish_synced_at: new Date().toISOString(),
    } as never)
    .eq("id", row.id)
    .eq("user_id", row.user_id)
    .or(`publish_status.neq.pending,publish_synced_at.is.null,publish_synced_at.lt.${staleBefore}`)
    .select("id")
  return ((data ?? []) as unknown[]).length > 0
}

/** Map anything thrown on the way to the provider into a code + message she can read. */
function describe(err: unknown, where: string): { code: PublishErrorCode; message: string } {
  if (err instanceof SocialPublishError) {
    if (!err.userActionable) {
      // The one she is told nothing specific about is the one we must log.
      console.error(`[social/bridge][${where}] ${err.code}: ${err.message}`)
      return { code: "provider_error", message: GENERIC_FAILURE }
    }
    return { code: err.code, message: err.message }
  }
  console.error(`[social/bridge][${where}]`, err)
  return { code: "provider_error", message: GENERIC_FAILURE }
}

/**
 * The provider said the account itself is gone. Flip the connection so the
 * badge above the calendar turns red, and mark every queued slot on it —
 * they are all going to fail the same way, and she should see that now, not
 * one by one at each slot minute.
 */
async function markAccountLost(db: Db, userId: string, accountId: string) {
  await db
    .from("social_accounts")
    .update({ status: "needs_reconnect" } as never)
    .eq("id", accountId)
    .eq("user_id", userId)
  await db
    .from("scheduled_posts")
    .update(
      failurePatch(
        "needs_reconnect",
        "החיבור לאינסטגרם פג. הפוסט לא יתפרסם עד שתחברו מחדש.",
      ) as never,
    )
    .eq("user_id", userId)
    .eq("social_account_id", accountId)
    .in("publish_status", ["queued", "sent"])
}

// ---------------------------------------------------------------------------
// the sync
// ---------------------------------------------------------------------------

export type SyncMode =
  /** Create if new, move if it exists. What a board write does. */
  | "sync"
  /** The content changed since it was queued: replace the provider's copy. */
  | "update"

/**
 * Bring the provider in line with one board row.
 *
 * Call after every write to the row (save, drag, date change) and from the
 * card's retry / update actions. Safe to call twice: a second concurrent call
 * finds the row locked and returns "pending", and the first one re-reads the
 * row before letting go so it always ends on the latest date.
 */
export async function syncSlot(
  db: Db,
  userId: string,
  corePostId: string,
  format: string,
  mode: SyncMode = "sync",
): Promise<PublishState> {
  try {
    return await syncSlotInner(db, userId, corePostId, format, mode)
  } catch (err) {
    // Only reachable when we couldn't even read the row or the account, so
    // there is nothing to write the failure into. Say it on the wire instead
    // of answering with a state we don't know.
    describe(err, "sync-read")
    return {
      status: "failed",
      code: "provider_error",
      message: "לא הצלחנו לבדוק את מצב התזמון. אפשר לנסות שוב.",
    }
  }
}

async function syncSlotInner(
  db: Db,
  userId: string,
  corePostId: string,
  format: string,
  mode: SyncMode,
): Promise<PublishState> {
  let row = await loadSlot(db, userId, corePostId, format)
  if (!row) return { status: "idle" }

  // Gone out already. Nothing to move, and nothing she'd want re-posted.
  if (row.published_at || row.publish_status === "published") return toPublishState(row)

  const account = await activeAccount(db, userId)

  // No account: the board is a planning board, exactly as before. Not an
  // error and not blocked — the card says "won't publish" on its own.
  if (!account) {
    if (row.publish_status !== "idle" || row.publish_error) {
      await patchSlot(db, row, { publish_status: "idle", publish_error: null })
      row = { ...row, publish_status: "idle", publish_error: null }
    }
    return toPublishState(row)
  }

  if (account.status !== "connected") {
    const patch = failurePatch(
      "needs_reconnect",
      "החיבור לאינסטגרם פג. הפוסט לא יתפרסם עד שתחברו מחדש.",
    )
    await patchSlot(db, row, patch)
    return toPublishState({ ...row, ...patch } as SlotRow)
  }

  if (!(await claimSlot(db, row))) {
    // Someone else is talking to the provider about this slot right now.
    return toPublishState({ ...row, publish_status: "pending", publish_error: null })
  }

  const publisher = getSocialPublisher(db)
  let providerPostId = row.provider_post_id
  // "update" needs no path of its own: a move is a full replace at the
  // provider (see `reschedulePost`), so re-pushing in place sends the current
  // caption and media. Kept as a distinct mode so callers say what they mean.
  void mode

  try {
    // Re-read-and-repeat: the board can change while we are mid-call (a
    // second drag lands, finds the lock, and leaves). Converge on whatever
    // the row says when we are done, at most a few rounds.
    for (let round = 0; round < 3; round++) {
      const publishAt = slotToInstant(row.scheduled_date, row.scheduled_time)

      if (publishAt.getTime() - Date.now() < PUBLISH_FLOOR_MS) {
        // A queued post must not keep its old time when the board says
        // something it can't honour — that is a post going out at a time she
        // already moved it away from.
        if (providerPostId) {
          await publisher.cancelPost(userId, providerPostId)
          providerPostId = null
        }
        const patch: SlotPatch = {
          ...failurePatch(
            "too_soon",
            "השעה שנבחרה כבר עברה או קרובה מדי, ולכן הפוסט לא תוזמן. צריך לבחור מועד מאוחר יותר.",
          ),
          provider_post_id: null,
        }
        await patchSlot(db, row, patch)
        return toPublishState({ ...row, ...patch } as SlotRow)
      }

      if (providerPostId) {
        try {
          const input = await assembleScheduledPost({
            db,
            userId,
            corePostId,
            format,
            socialAccountId: account.id,
            scheduledDate: row.scheduled_date,
            scheduledTime: row.scheduled_time,
          })
          await publisher.reschedulePost(input, providerPostId)
        } catch (err) {
          // The move failed, so the provider still holds the OLD time. Leaving
          // it there means a post going out when she said it shouldn't. Pull
          // it, and say so.
          const { code, message } = describe(err, "reschedule")
          try {
            await publisher.cancelPost(userId, providerPostId)
            const patch: SlotPatch = {
              ...failurePatch(
                code,
                code === "provider_error"
                  ? "לא הצלחנו להזיז את הפוסט באינסטגרם. כדי שלא יצא בשעה הקודמת, הוצאנו אותו מהתור. אפשר לנסות שוב."
                  : `${message} כדי שהפוסט לא יצא בשעה הקודמת, הוצאנו אותו מהתור.`,
              ),
              provider_post_id: null,
            }
            await patchSlot(db, row, patch)
            return toPublishState({ ...row, ...patch } as SlotRow)
          } catch (cancelErr) {
            describe(cancelErr, "reschedule-cancel")
            const patch = failurePatch(
              "cancel_failed",
              "לא הצלחנו להזיז את הפוסט, והוא עדיין בתור במועד הקודם. אפשר לנסות שוב.",
            )
            await patchSlot(db, row, patch)
            return toPublishState({ ...row, ...patch } as SlotRow)
          }
        }
      } else {
        const input = await assembleScheduledPost({
          db,
          userId,
          corePostId,
          format,
          socialAccountId: account.id,
          scheduledDate: row.scheduled_date,
          scheduledTime: row.scheduled_time,
        })
        const created = await publisher.schedulePost(input)
        providerPostId = created.providerPostId

        // Write the id the moment we have it: an id we lose is a post we can
        // never move or cancel again.
        const stillThere = await patchSlot(db, row, {
          provider_post_id: providerPostId,
          social_account_id: account.id,
        })
        if (!stillThere) {
          // Either the slot was removed while we were creating it, or the id
          // couldn't be saved. Both leave a post we could never move or
          // cancel again — so it comes out of her queue now.
          await publisher.cancelPost(userId, providerPostId)
          providerPostId = null
          if (await loadSlot(db, userId, corePostId, format)) {
            throw new SocialPublishError("could not persist provider id", "provider_error", false)
          }
          return { status: "idle" }
        }
      }

      // Read it back. "The call didn't fail" is not the same as "the provider
      // holds this time".
      const held = await publisher.getPost(userId, providerPostId)
      if (held.outcome === "missing") {
        // Cancelled somewhere else. The board still wants it: queue it afresh.
        providerPostId = null
        await patchSlot(db, row, { provider_post_id: null })
        continue
      }
      if (
        held.outcome !== "scheduled" ||
        !held.scheduledAt ||
        Math.abs(held.scheduledAt.getTime() - publishAt.getTime()) > READBACK_TOLERANCE_MS
      ) {
        console.error(
          "[social/bridge] read-back mismatch",
          row.id,
          publishAt.toISOString(),
          held.outcome,
          held.scheduledAt?.toISOString(),
        )
        const patch = failurePatch(
          "provider_mismatch",
          "אינסטגרם לא אישרה את המועד שעל הלוח. אפשר לנסות שוב.",
        )
        await patchSlot(db, row, patch)
        return toPublishState({ ...row, ...patch } as SlotRow)
      }

      // Did the board move while we were busy? Then go round again.
      const fresh = await loadSlot(db, userId, corePostId, format)
      if (!fresh) {
        await publisher.cancelPost(userId, providerPostId)
        return { status: "idle" }
      }
      const moved =
        fresh.scheduled_date !== row.scheduled_date || fresh.scheduled_time !== row.scheduled_time
      row = fresh
      if (moved) continue

      const patch: SlotPatch = {
        provider_post_id: providerPostId,
        social_account_id: account.id,
        publish_status: "queued",
        publish_error: null,
        publish_synced_at: new Date().toISOString(),
      }
      await patchSlot(db, row, patch)
      return toPublishState({ ...row, ...patch } as SlotRow)
    }

    // Three rounds and the board is still moving under us. Stop chasing and
    // let the next write settle it, but don't claim anything we haven't seen.
    const patch = failurePatch("provider_error", "התזמון השתנה כמה פעמים ברצף. אפשר לנסות שוב.")
    await patchSlot(db, row, { ...patch, provider_post_id: providerPostId })
    return toPublishState({ ...row, ...patch } as SlotRow)
  } catch (err) {
    if (err instanceof SocialPublishError && err.accountLost) {
      await markAccountLost(db, userId, account.id)
    }
    const { code, message } = describe(err, "sync")
    const patch: SlotPatch = { ...failurePatch(code, message), provider_post_id: providerPostId }
    await patchSlot(db, row, patch)
    return toPublishState({ ...row, ...patch } as SlotRow)
  }
}

// ---------------------------------------------------------------------------
// leaving the queue
// ---------------------------------------------------------------------------

/** Rows that still have something sitting at the provider. */
function holdsProviderPost(row: SlotRow): boolean {
  return !!row.provider_post_id && !row.published_at && row.publish_status !== "published"
}

/**
 * Cancel at the provider, for every slot matching the filter, BEFORE the
 * caller deletes or detaches them.
 *
 * Returns what could not be cancelled. Those rows must not be deleted: a row
 * that disappears from the board while its post is still queued is the worst
 * outcome available — it goes out, and she has nowhere left to see it.
 */
export async function cancelSlots(
  db: Db,
  userId: string,
  filter: { corePostId?: string; format?: string | null; socialAccountId?: string },
): Promise<{ cancelled: number; stuck: SlotRow[] }> {
  let q = db.from("scheduled_posts").select(SLOT_COLUMNS).eq("user_id", userId)
  if (filter.corePostId) q = q.eq("core_post_id", filter.corePostId)
  if (filter.format) q = q.eq("format", filter.format)
  if (filter.socialAccountId) q = q.eq("social_account_id", filter.socialAccountId)
  const { data } = await q
  const rows = ((data ?? []) as SlotRow[]).filter(holdsProviderPost)
  if (rows.length === 0) return { cancelled: 0, stuck: [] }

  const publisher = getSocialPublisher(db)
  const stuck: SlotRow[] = []
  let cancelled = 0
  for (const row of rows) {
    try {
      await publisher.cancelPost(userId, row.provider_post_id as string)
      await patchSlot(db, row, {
        provider_post_id: null,
        publish_status: "idle",
        publish_error: null,
        publish_synced_at: new Date().toISOString(),
      })
      cancelled++
    } catch (err) {
      describe(err, "cancel")
      await patchSlot(
        db,
        row,
        failurePatch(
          "cancel_failed",
          "לא הצלחנו להוציא את הפוסט מהתור באינסטגרם, והוא עדיין עלול להתפרסם. אפשר לנסות שוב.",
        ),
      )
      stuck.push(row)
    }
  }
  return { cancelled, stuck }
}

/** How many slots would be pulled from the queue if this account went away. */
export async function countQueuedForAccount(db: Db, userId: string, socialAccountId: string) {
  const { data } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .eq("social_account_id", socialAccountId)
  return ((data ?? []) as SlotRow[]).filter(holdsProviderPost).length
}

/**
 * After a (re)connect: the slots that failed only because there was no live
 * connection get another go, so "לחבר מחדש" actually restores the queue
 * rather than just turning the badge green.
 */
export async function resumeAfterConnect(db: Db, userId: string): Promise<number> {
  const { data } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .eq("publish_status", "failed")
  const rows = ((data ?? []) as SlotRow[]).filter((r) => {
    const code = decodePublishError(r.publish_error)?.code
    return code === "needs_reconnect" || code === "not_connected"
  })
  let resumed = 0
  for (const r of rows) {
    const state = await syncSlot(db, userId, r.core_post_id, r.format)
    if (state.status === "queued") resumed++
  }
  return resumed
}

// ---------------------------------------------------------------------------
// what happened since
// ---------------------------------------------------------------------------

/**
 * Bring the board's view of the queue up to date. Called when the calendar
 * opens.
 *
 *   - Slots whose time has passed: read the outcome back from the provider —
 *     published (with the permalink), failed (with a reason), or, when the
 *     provider says nothing yet, "יצא לפרסום". Never "פורסם" on a guess.
 *   - Slots still waiting: if the caption or media changed after they were
 *     queued, flag them. The provider holds the old copy, and publishing a
 *     stale version quietly is exactly what she asked us not to do.
 *   - A connection that lapsed: every queued slot on it is marked.
 *
 * Returns the state of every row it looked at, keyed `corePostId:format`.
 */
export async function refreshPublishStates(
  db: Db,
  userId: string,
): Promise<Record<string, PublishState>> {
  const out: Record<string, PublishState> = {}

  const { data } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .in("publish_status", ["queued", "sent", "pending", "published"])
  const rows = (data ?? []) as SlotRow[]
  if (rows.length === 0) return out

  const account = await activeAccount(db, userId)
  let publisher: SocialPublisher | null = null
  const getPublisher = () => (publisher ??= getSocialPublisher(db))
  const now = Date.now()

  // Content-change check needs the variants' and assets' edit times.
  const waiting = rows.filter((r) => r.publish_status === "queued" && r.publish_synced_at)
  const editedAt = await lastContentEdits(db, waiting)

  // Permalinks aren't stored (no column for them yet), so a published row is
  // re-read for its link — capped, newest first, to keep the page load cheap.
  let permalinkReads = 0

  for (const row of rows) {
    const key = slotKey(row.core_post_id, row.format)
    let instant: number
    try {
      instant = slotToInstant(row.scheduled_date, row.scheduled_time).getTime()
    } catch {
      out[key] = toPublishState(row)
      continue
    }

    try {
      if (row.publish_status === "published") {
        if (row.provider_post_id && permalinkReads < 10 && now - instant < 30 * 86400_000) {
          permalinkReads++
          const held = await getPublisher().getPost(userId, row.provider_post_id)
          out[key] = toPublishState(row, { permalink: held.permalink ?? null })
        } else {
          out[key] = toPublishState(row)
        }
        continue
      }

      if (row.publish_status === "pending") {
        const lockedAt = row.publish_synced_at ? Date.parse(row.publish_synced_at) : 0
        if (now - lockedAt > LOCK_STALE_MS) {
          // A request died mid-call. Ask the provider what it actually holds
          // instead of guessing in either direction.
          if (row.provider_post_id) {
            await syncSlot(db, userId, row.core_post_id, row.format)
            const after = await loadSlot(db, userId, row.core_post_id, row.format)
            out[key] = after ? toPublishState(after) : { status: "idle" }
          } else {
            const patch = failurePatch("provider_error", "לא ברור אם הפוסט נכנס לתור. אפשר לנסות שוב.")
            await patchSlot(db, row, patch)
            out[key] = toPublishState({ ...row, ...patch } as SlotRow)
          }
        } else {
          out[key] = toPublishState(row)
        }
        continue
      }

      // queued / sent
      if (account && account.status !== "connected" && row.publish_status === "queued") {
        const patch = failurePatch(
          "needs_reconnect",
          "החיבור לאינסטגרם פג. הפוסט לא יתפרסם עד שתחברו מחדש.",
        )
        await patchSlot(db, row, patch)
        out[key] = toPublishState({ ...row, ...patch } as SlotRow)
        continue
      }

      if (instant <= now && row.provider_post_id) {
        const held = await getPublisher().getPost(userId, row.provider_post_id)
        if (held.outcome === "published") {
          const publishedAt = (held.publishedAt ?? new Date()).toISOString()
          const patch: SlotPatch = {
            publish_status: "published",
            publish_error: null,
            published_at: publishedAt,
            publish_synced_at: new Date().toISOString(),
          }
          await patchSlot(db, row, patch)
          out[key] = toPublishState({ ...row, ...patch } as SlotRow, {
            permalink: held.permalink ?? null,
          })
          continue
        }
        if (held.outcome === "failed") {
          console.error("[social/bridge] provider reported a failed publish", row.id, held.error)
          const patch = failurePatch(
            "provider_error",
            "אינסטגרם לא פרסמה את הפוסט במועד. אפשר לבחור מועד חדש ולנסות שוב.",
          )
          await patchSlot(db, row, patch)
          out[key] = toPublishState({ ...row, ...patch } as SlotRow)
          continue
        }
        if (now - instant > SENT_GRACE_MS && row.publish_status !== "sent") {
          // Past its time, no word either way. Say what we know — it left —
          // and let her confirm it by hand.
          await patchSlot(db, row, { publish_status: "sent", publish_error: null })
          out[key] = toPublishState({ ...row, publish_status: "sent", publish_error: null })
          continue
        }
        out[key] = toPublishState(row)
        continue
      }

      if (row.publish_status === "queued" && row.publish_synced_at) {
        const edited = editedAt.get(row.id)
        const changed = edited !== undefined && edited > Date.parse(row.publish_synced_at)
        const flagged = decodePublishError(row.publish_error)?.code === "content_changed"
        if (changed && !flagged) {
          const error = encodePublishError(
            "content_changed",
            "הכיתוב או המדיה השתנו מאז התזמון, ובאינסטגרם עדיין מחכה הגרסה הקודמת.",
          )
          await patchSlot(db, row, { publish_error: error })
          out[key] = toPublishState({ ...row, publish_error: error })
          continue
        }
      }

      out[key] = toPublishState(row)
    } catch (err) {
      // A refresh that can't reach the provider changes nothing — the row
      // keeps the last state we actually know.
      describe(err, "refresh")
      out[key] = toPublishState(row)
    }
  }

  return out
}

/** Latest edit time of each slot's caption or media, keyed by slot row id. */
async function lastContentEdits(db: Db, rows: SlotRow[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (rows.length === 0) return result

  const postIds = [...new Set(rows.map((r) => r.core_post_id))]
  const { data: variants } = await db
    .from("format_variants")
    .select("id, core_post_id, format, updated_at")
    .in("core_post_id", postIds)
  const vlist = (variants ?? []) as { id: string; core_post_id: string; format: string; updated_at: string }[]
  if (vlist.length === 0) return result

  const { data: assets } = await db
    .from("media_assets")
    .select("format_variant_id, updated_at")
    .in(
      "format_variant_id",
      vlist.map((v) => v.id),
    )
  const assetEdit = new Map<string, number>()
  for (const a of (assets ?? []) as { format_variant_id: string; updated_at: string }[]) {
    const t = Date.parse(a.updated_at)
    if (t > (assetEdit.get(a.format_variant_id) ?? 0)) assetEdit.set(a.format_variant_id, t)
  }

  for (const row of rows) {
    const v = vlist.find((x) => x.core_post_id === row.core_post_id && x.format === row.format)
    if (!v) continue
    result.set(row.id, Math.max(Date.parse(v.updated_at), assetEdit.get(v.id) ?? 0))
  }
  return result
}
