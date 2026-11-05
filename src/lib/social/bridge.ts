/**
 * The bridge: a calendar slot becomes queued posts on her networks, and stays
 * them.
 *
 * Until 2026-10-15 the calendar and the publishing pipeline never met. Until
 * 2026-11-05 a slot went to exactly one place, Instagram. Now a slot goes to
 * every connected network that fits its format (Hani's call), each one a
 * TARGET row (migration 042) with its own provider id, status and error. The
 * slot row keeps the roll-up, so everything that reads one status per slot
 * keeps working.
 *
 * ---- The rules this file enforces ----
 *
 * 1. The board is the source of truth. The instant sent to the provider is
 *    always computed from the slot's own date + hour (Israel time). Whatever
 *    moves the slot moves every target; nothing else does.
 *
 * 2. "Queued" means the provider gave us an id and, read back, holds the
 *    board's time. Every other outcome is `failed` with a reason she can act
 *    on, or `pending` while a call is in flight. Per target.
 *
 * 3. One target, one provider post. A target with a provider id is moved,
 *    never re-created; a target being worked on is locked (`pending`), so a
 *    double click, a retry and a fast second drag cannot create two posts.
 *
 * 4. Nothing leaves the queue without the provider confirming it. Removing a
 *    slot, deleting its post, taking a network off it, or disconnecting the
 *    account cancels at the provider first; if that cancel fails, the slot
 *    stays on the board, marked.
 *
 * 5. The set of networks is decided once, when the slot is first sent: every
 *    connected network that fits the format, minus the ones she took off. A
 *    network connected LATER is not added to posts already scheduled — she
 *    adds it per post from the preview. Posting old plans to a brand-new
 *    channel because she connected it is not something she asked for.
 *
 * Everything runs with the caller's user-scoped client: every row it touches
 * is hers, so RLS stays on.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  Database,
  ScheduledPostRow,
  ScheduledPostTargetRow,
  SocialAccountRow,
  SocialPlatform,
} from "@/lib/supabase/types"
import { assembleScheduledPost } from "./assemble"
import { getSocialPublisher } from "./index"
import { NETWORK_LABEL, PUBLISH_PLATFORMS, inNetwork, networkFitsFormat, toNetwork } from "./networks"
import {
  PUBLISH_FLOOR_MS,
  decodePublishError,
  encodePublishError,
  rollupTargets,
  type PublishErrorCode,
  type PublishState,
  type TargetPublishState,
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

const TARGET_COLUMNS =
  "id, user_id, scheduled_post_id, platform, social_account_id, opted_out, provider_post_id, publish_status, publish_error, publish_synced_at, published_at"

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

type TargetRow = Pick<
  ScheduledPostTargetRow,
  | "id"
  | "user_id"
  | "scheduled_post_id"
  | "platform"
  | "social_account_id"
  | "opted_out"
  | "provider_post_id"
  | "publish_status"
  | "publish_error"
  | "publish_synced_at"
  | "published_at"
>

type TargetPatch = Partial<
  Pick<
    ScheduledPostTargetRow,
    | "social_account_id"
    | "opted_out"
    | "provider_post_id"
    | "publish_status"
    | "publish_error"
    | "publish_synced_at"
    | "published_at"
  >
>

const genericFailure = (p: SocialPlatform) =>
  `משהו השתבש מול ${NETWORK_LABEL[p]}, והפוסט לא תוזמן שם. אפשר לנסות שוב.`

export const slotKey = (corePostId: string, format: string) => `${corePostId}:${format}`

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** The wire state for a slot row (the roll-up) — what every card reads. */
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

/** One target as the wire carries it. */
function toTargetState(
  t: TargetRow,
  handle: string | null | undefined,
  extra?: Partial<TargetPublishState>,
): TargetPublishState {
  const err = decodePublishError(t.publish_error)
  const published = !!t.published_at || t.publish_status === "published"
  return {
    platform: t.platform,
    status: published ? "published" : t.publish_status,
    code: published ? null : (err?.code ?? null),
    message: published ? null : (err?.message ?? null),
    publishedAt: t.published_at,
    optedOut: t.opted_out,
    handle: handle ?? null,
    ...extra,
  }
}

/** The database didn't answer. Never mistaken for "nothing there". */
class BridgeReadError extends Error {
  constructor(detail: string) {
    super(`scheduled_posts/targets read failed: ${detail}`)
    this.name = "BridgeReadError"
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

/**
 * Her accounts, one per network: the live one, or the lapsed one when that is
 * all there is (so the caller can say "reconnect" rather than "not connected").
 */
async function accountsByPlatform(db: Db, userId: string): Promise<Map<SocialPlatform, SocialAccountRow>> {
  const { data, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "revoked")
    .order("connected_at", { ascending: false })
  if (error) throw new BridgeReadError(error.message)
  const out = new Map<SocialPlatform, SocialAccountRow>()
  for (const row of (data ?? []) as SocialAccountRow[]) {
    const have = out.get(row.platform)
    if (!have || (have.status !== "connected" && row.status === "connected")) out.set(row.platform, row)
  }
  return out
}

/**
 * A slot's targets. Adopts a pre-042 slot on first touch: one queued on
 * Instagram through the old columns gets its Instagram target here, carrying
 * the provider id, so it is moved and cancelled like any other.
 */
async function loadTargets(db: Db, slot: SlotRow): Promise<TargetRow[]> {
  const { data, error } = await db
    .from("scheduled_post_targets")
    .select(TARGET_COLUMNS)
    .eq("user_id", slot.user_id)
    .eq("scheduled_post_id", slot.id)
  if (error) throw new BridgeReadError(error.message)
  const rows = (data ?? []) as TargetRow[]

  const legacy = slot.provider_post_id || slot.social_account_id
  if (legacy && !rows.some((r) => r.platform === "instagram")) {
    const { data: adopted } = await db
      .from("scheduled_post_targets")
      .upsert(
        {
          user_id: slot.user_id,
          scheduled_post_id: slot.id,
          platform: "instagram",
          social_account_id: slot.social_account_id,
          provider_post_id: slot.provider_post_id,
          publish_status: slot.publish_status,
          publish_error: slot.publish_error,
          publish_synced_at: slot.publish_synced_at,
          published_at: slot.publish_status === "published" ? slot.published_at : null,
        } as never,
        { onConflict: "scheduled_post_id,platform", ignoreDuplicates: true },
      )
      .select(TARGET_COLUMNS)
    rows.push(...((adopted ?? []) as TargetRow[]))
  }
  return rows.sort((a, b) => PUBLISH_PLATFORMS.indexOf(a.platform) - PUBLISH_PLATFORMS.indexOf(b.platform))
}

/**
 * The networks this slot goes to.
 *
 * First send: one target per connected network that fits the format, the
 * excluded ones written as opted out (so a later sync doesn't add them back).
 * After that the set is what it is (rule 5), except that a target whose
 * account was replaced by a reconnect follows the live account.
 */
async function ensureTargets(
  db: Db,
  slot: SlotRow,
  accounts: Map<SocialPlatform, SocialAccountRow>,
  exclude: SocialPlatform[] = [],
): Promise<TargetRow[]> {
  const existing = await loadTargets(db, slot)

  if (existing.length === 0) {
    const fresh = PUBLISH_PLATFORMS.filter((p) => accounts.has(p) && networkFitsFormat(p, slot.format)).map(
      (p) => ({
        user_id: slot.user_id,
        scheduled_post_id: slot.id,
        platform: p,
        social_account_id: accounts.get(p)!.id,
        opted_out: exclude.includes(p),
      }),
    )
    if (fresh.length === 0) return []
    const { data, error } = await db
      .from("scheduled_post_targets")
      .upsert(fresh as never, { onConflict: "scheduled_post_id,platform", ignoreDuplicates: true })
      .select(TARGET_COLUMNS)
    if (error) throw new BridgeReadError(error.message)
    // A concurrent request may have inserted them first; read what's there.
    return (data ?? []).length === fresh.length ? ((data ?? []) as TargetRow[]) : loadTargets(db, slot)
  }

  for (const t of existing) {
    const live = accounts.get(t.platform)
    if (live && live.id !== t.social_account_id && !t.provider_post_id) {
      await patchTarget(db, t, { social_account_id: live.id })
      t.social_account_id = live.id
    }
  }
  return existing
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** Patch one target. Returns false when the row is gone (deleted mid-flight). */
async function patchTarget(db: Db, row: Pick<TargetRow, "id" | "user_id">, patch: TargetPatch) {
  const { data, error } = await db
    .from("scheduled_post_targets")
    .update(patch as never)
    .eq("id", row.id)
    .eq("user_id", row.user_id)
    .select("id")
  if (error) {
    console.error("[social/bridge] could not write target state", row.id, error.message)
    return false
  }
  return ((data ?? []) as unknown[]).length > 0
}

function failurePatch(code: PublishErrorCode, message: string): TargetPatch {
  return {
    publish_status: "failed",
    publish_error: encodePublishError(code, message),
    publish_synced_at: new Date().toISOString(),
  }
}

/**
 * Take the target's lock. Only one request at a time may talk to the provider
 * about a given target — the difference between a double click and two posts.
 */
async function claimTarget(db: Db, row: TargetRow): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString()
  const { data } = await db
    .from("scheduled_post_targets")
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
function describe(err: unknown, where: string, platform: SocialPlatform): { code: PublishErrorCode; message: string } {
  if (err instanceof SocialPublishError) {
    if (!err.userActionable) {
      // The one she is told nothing specific about is the one we must log.
      console.error(`[social/bridge][${where}][${platform}] ${err.code}: ${err.message}`)
      return { code: "provider_error", message: genericFailure(platform) }
    }
    return { code: err.code, message: err.message }
  }
  console.error(`[social/bridge][${where}][${platform}]`, err)
  return { code: "provider_error", message: genericFailure(platform) }
}

const lapsedMessage = (p: SocialPlatform) => `החיבור ${toNetwork(p)} פג. הפוסט לא יעלה לשם עד שתחברו מחדש.`

/**
 * The provider said the account itself is gone. Flip the connection so the
 * badge turns red, and mark every queued target on it — they are all going to
 * fail the same way, and she should see that now, not one by one.
 */
async function markAccountLost(db: Db, userId: string, account: Pick<SocialAccountRow, "id" | "platform">) {
  await db
    .from("social_accounts")
    .update({ status: "needs_reconnect" } as never)
    .eq("id", account.id)
    .eq("user_id", userId)
  const { data } = await db
    .from("scheduled_post_targets")
    .update(failurePatch("needs_reconnect", lapsedMessage(account.platform)) as never)
    .eq("user_id", userId)
    .eq("social_account_id", account.id)
    .in("publish_status", ["queued", "sent"])
    .select("scheduled_post_id")
  for (const id of new Set(((data ?? []) as { scheduled_post_id: string }[]).map((r) => r.scheduled_post_id))) {
    await rollupSlot(db, userId, id)
  }
}

/**
 * Write the roll-up of a slot's targets onto the slot row, and answer the
 * full wire state (roll-up + per-network). `published_at` on the slot is set
 * only when EVERY active target went out — and never cleared here, since a
 * hand-ticked "פורסם" lives in the same column.
 */
async function rollupSlot(
  db: Db,
  userId: string,
  slotId: string,
  extras?: Map<string, Partial<TargetPublishState>>,
): Promise<{ key: string; state: PublishState } | null> {
  const { data: slotData } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("id", slotId)
    .eq("user_id", userId)
    .maybeSingle()
  const slot = slotData as SlotRow | null
  if (!slot) return null

  const { data } = await db
    .from("scheduled_post_targets")
    .select(TARGET_COLUMNS)
    .eq("user_id", userId)
    .eq("scheduled_post_id", slotId)
  const targets = ((data ?? []) as TargetRow[]).sort(
    (a, b) => PUBLISH_PLATFORMS.indexOf(a.platform) - PUBLISH_PLATFORMS.indexOf(b.platform),
  )
  const handles = await handlesFor(db, userId, targets)
  const wire = targets.map((t) => toTargetState(t, handles.get(t.social_account_id ?? ""), extras?.get(t.id)))
  const roll = rollupTargets(wire, (p) => NETWORK_LABEL[p])

  const patch: Partial<ScheduledPostRow> = {
    publish_status: roll.status,
    publish_error: roll.code && roll.message ? encodePublishError(roll.code, roll.message) : null,
    publish_synced_at: new Date().toISOString(),
  }
  if (roll.status === "published" && !slot.published_at) patch.published_at = roll.publishedAt ?? new Date().toISOString()
  await db.from("scheduled_posts").update(patch as never).eq("id", slot.id).eq("user_id", userId)

  const merged = { ...slot, ...patch } as SlotRow
  return {
    key: slotKey(slot.core_post_id, slot.format),
    state: toPublishState(merged, { permalink: roll.permalink ?? null, targets: wire }),
  }
}

async function handlesFor(db: Db, userId: string, targets: Pick<TargetRow, "social_account_id">[]) {
  const ids = [...new Set(targets.map((t) => t.social_account_id).filter((x): x is string => !!x))]
  const out = new Map<string, string | null>()
  if (ids.length === 0) return out
  const { data } = await db.from("social_accounts").select("id, handle").eq("user_id", userId).in("id", ids)
  for (const a of (data ?? []) as { id: string; handle: string | null }[]) out.set(a.id, a.handle)
  return out
}

// ---------------------------------------------------------------------------
// the sync
// ---------------------------------------------------------------------------

export type SyncMode =
  /** Create if new, move if it exists. What a board write does. */
  | "sync"
  /** The content changed since it was queued: replace the provider's copy. */
  | "update"

export type SyncOptions = {
  mode?: SyncMode
  /**
   * Networks she took off this post before it was ever sent (the preview of
   * an unscheduled post). Only read the first time the slot's targets are
   * written; after that, opt-outs go through `setTargetOptOut`.
   */
  exclude?: SocialPlatform[]
}

/**
 * Bring every network in line with one board row.
 *
 * Call after every write to the row (save, drag, date change) and from the
 * card's retry / update actions. Safe to call twice: a second concurrent call
 * finds each target locked and leaves it, and the first re-reads the slot
 * before letting go so it always ends on the latest date.
 */
export async function syncSlot(
  db: Db,
  userId: string,
  corePostId: string,
  format: string,
  opts: SyncOptions = {},
): Promise<PublishState> {
  try {
    return await syncSlotInner(db, userId, corePostId, format, opts)
  } catch (err) {
    // Only reachable when we couldn't even read the slot, its targets or the
    // accounts, so there is nothing to write the failure into. Say it on the
    // wire instead of answering with a state we don't know.
    console.error("[social/bridge][sync-read]", err)
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
  opts: SyncOptions,
): Promise<PublishState> {
  const slot = await loadSlot(db, userId, corePostId, format)
  if (!slot) return { status: "idle" }

  const accounts = await accountsByPlatform(db, userId)
  const targets = await ensureTargets(db, slot, accounts, opts.exclude)

  // No networks at all: the board is a planning board, exactly as before. Not
  // an error and not blocked — the card says "won't publish" on its own.
  if (targets.length === 0) {
    if (slot.publish_status !== "idle" || slot.publish_error) {
      await db
        .from("scheduled_posts")
        .update({ publish_status: "idle", publish_error: null } as never)
        .eq("id", slot.id)
        .eq("user_id", userId)
    }
    return toPublishState({ ...slot, publish_status: "idle", publish_error: null })
  }

  // A post marked published by hand is history. Nothing to move.
  if (!slot.published_at) {
    const byId = new Map([...accounts.values()].map((a) => [a.id, a]))
    const publisher = getSocialPublisher(db)
    for (const target of targets) {
      if (target.opted_out || target.published_at || target.publish_status === "published") continue
      const account = (target.social_account_id && byId.get(target.social_account_id)) || accounts.get(target.platform)
      await syncTarget(db, userId, slot, target, account ?? null, publisher)
    }
  }

  return (await rollupSlot(db, userId, slot.id))?.state ?? toPublishState(slot)
}

/** The old single-slot loop, now per network. Writes its outcome to the target row. */
async function syncTarget(
  db: Db,
  userId: string,
  initialSlot: SlotRow,
  target: TargetRow,
  account: SocialAccountRow | null,
  publisher: SocialPublisher,
): Promise<void> {
  const p = target.platform

  if (!account) {
    await patchTarget(
      db,
      target,
      failurePatch("not_connected", `${NETWORK_LABEL[p]} לא מחובר, ולכן הפוסט לא יעלה לשם.`),
    )
    return
  }
  if (account.status !== "connected") {
    await patchTarget(db, target, failurePatch("needs_reconnect", lapsedMessage(p)))
    return
  }
  if (!(await claimTarget(db, target))) return

  let slot = initialSlot
  let providerPostId = target.provider_post_id
  const assemble = () =>
    assembleScheduledPost({
      db,
      userId,
      corePostId: slot.core_post_id,
      format: slot.format,
      socialAccountId: account.id,
      platform: p,
      scheduledDate: slot.scheduled_date,
      scheduledTime: slot.scheduled_time,
    })

  try {
    // Re-read-and-repeat: the board can change while we are mid-call. Converge
    // on whatever the slot says when we are done, at most a few rounds.
    for (let round = 0; round < 3; round++) {
      const publishAt = slotToInstant(slot.scheduled_date, slot.scheduled_time)

      if (publishAt.getTime() - Date.now() < PUBLISH_FLOOR_MS) {
        // A queued post must not keep its old time when the board says
        // something it can't honour.
        if (providerPostId) {
          await publisher.cancelPost(userId, providerPostId)
          providerPostId = null
        }
        await patchTarget(db, target, {
          ...failurePatch(
            "too_soon",
            "השעה שנבחרה כבר עברה או קרובה מדי, ולכן הפוסט לא תוזמן. צריך לבחור מועד מאוחר יותר.",
          ),
          provider_post_id: null,
        })
        return
      }

      if (providerPostId) {
        try {
          await publisher.reschedulePost(await assemble(), providerPostId)
        } catch (err) {
          // The move failed, so the provider still holds the OLD time. Pull
          // it, and say so.
          const { code, message } = describe(err, "reschedule", p)
          try {
            await publisher.cancelPost(userId, providerPostId)
            await patchTarget(db, target, {
              ...failurePatch(
                code,
                code === "provider_error"
                  ? `לא הצלחנו להזיז את הפוסט ${inNetwork(p)}. כדי שלא יצא בשעה הקודמת, הוצאנו אותו מהתור. אפשר לנסות שוב.`
                  : `${message} כדי שהפוסט לא יצא בשעה הקודמת, הוצאנו אותו מהתור.`,
              ),
              provider_post_id: null,
            })
          } catch (cancelErr) {
            describe(cancelErr, "reschedule-cancel", p)
            await patchTarget(
              db,
              target,
              failurePatch(
                "cancel_failed",
                `לא הצלחנו להזיז את הפוסט ${inNetwork(p)}, והוא עדיין בתור במועד הקודם. אפשר לנסות שוב.`,
              ),
            )
          }
          return
        }
      } else {
        const created = await publisher.schedulePost(await assemble())
        providerPostId = created.providerPostId

        // Write the id the moment we have it: an id we lose is a post we can
        // never move or cancel again.
        const stillThere = await patchTarget(db, target, {
          provider_post_id: providerPostId,
          social_account_id: account.id,
        })
        if (!stillThere) {
          // The slot (and its targets) went while we were creating it, or the
          // id couldn't be saved. Either way it comes out of her queue now.
          await publisher.cancelPost(userId, providerPostId)
          providerPostId = null
          if (await loadSlot(db, userId, slot.core_post_id, slot.format)) {
            throw new SocialPublishError("could not persist provider id", "provider_error", false)
          }
          return
        }
      }

      // Read it back. "The call didn't fail" is not "the provider holds this time".
      const held = await publisher.getPost(userId, providerPostId)
      if (held.outcome === "missing") {
        // Cancelled somewhere else. The board still wants it: queue it afresh.
        providerPostId = null
        await patchTarget(db, target, { provider_post_id: null })
        continue
      }
      if (
        held.outcome !== "scheduled" ||
        !held.scheduledAt ||
        Math.abs(held.scheduledAt.getTime() - publishAt.getTime()) > READBACK_TOLERANCE_MS
      ) {
        console.error(
          "[social/bridge] read-back mismatch",
          target.id,
          p,
          publishAt.toISOString(),
          held.outcome,
          held.scheduledAt?.toISOString(),
        )
        await patchTarget(
          db,
          target,
          failurePatch("provider_mismatch", `${NETWORK_LABEL[p]} לא אישרה את המועד שעל הלוח. אפשר לנסות שוב.`),
        )
        return
      }

      // Did the board move while we were busy? Then go round again.
      const fresh = await loadSlot(db, userId, slot.core_post_id, slot.format)
      if (!fresh) {
        await publisher.cancelPost(userId, providerPostId)
        return
      }
      const moved = fresh.scheduled_date !== slot.scheduled_date || fresh.scheduled_time !== slot.scheduled_time
      slot = fresh
      if (moved) continue

      await patchTarget(db, target, {
        provider_post_id: providerPostId,
        social_account_id: account.id,
        publish_status: "queued",
        publish_error: null,
        publish_synced_at: new Date().toISOString(),
      })
      return
    }

    // Three rounds and the board is still moving under us. Stop chasing.
    await patchTarget(db, target, {
      ...failurePatch("provider_error", "התזמון השתנה כמה פעמים ברצף. אפשר לנסות שוב."),
      provider_post_id: providerPostId,
    })
  } catch (err) {
    if (err instanceof SocialPublishError && err.accountLost) {
      await markAccountLost(db, userId, account)
    }
    const { code, message } = describe(err, "sync", p)
    await patchTarget(db, target, { ...failurePatch(code, message), provider_post_id: providerPostId })
  }
}

// ---------------------------------------------------------------------------
// the per-post network choice
// ---------------------------------------------------------------------------

/**
 * Take one network off one post, or put it back.
 *
 * Off: cancel at the provider first (rule 4). If that fails, the network stays
 * on and says so. On: the target is re-armed and synced like any new one.
 * Works for a network that was never on this post too (connected after it was
 * scheduled) — that is how she adds it.
 */
export async function setTargetOptOut(
  db: Db,
  userId: string,
  corePostId: string,
  format: string,
  platform: SocialPlatform,
  optOut: boolean,
): Promise<PublishState> {
  try {
    const slot = await loadSlot(db, userId, corePostId, format)
    if (!slot) return { status: "idle" }
    if (!networkFitsFormat(platform, format)) {
      return (await rollupSlot(db, userId, slot.id))?.state ?? toPublishState(slot)
    }
    const accounts = await accountsByPlatform(db, userId)
    const targets = await ensureTargets(db, slot, accounts)
    let target = targets.find((t) => t.platform === platform)

    if (!target) {
      const { data, error } = await db
        .from("scheduled_post_targets")
        .upsert(
          {
            user_id: userId,
            scheduled_post_id: slot.id,
            platform,
            social_account_id: accounts.get(platform)?.id ?? null,
            opted_out: optOut,
          } as never,
          { onConflict: "scheduled_post_id,platform" },
        )
        .select(TARGET_COLUMNS)
        .single()
      if (error) throw new BridgeReadError(error.message)
      target = data as TargetRow
    }

    if (optOut) {
      if (target.provider_post_id && !target.published_at && target.publish_status !== "published") {
        try {
          await getSocialPublisher(db).cancelPost(userId, target.provider_post_id)
        } catch (err) {
          describe(err, "opt-out-cancel", platform)
          await patchTarget(
            db,
            target,
            failurePatch(
              "cancel_failed",
              `לא הצלחנו להוציא את הפוסט מהתור ${inNetwork(platform)}, והוא עדיין עלול להתפרסם שם. אפשר לנסות שוב.`,
            ),
          )
          return (await rollupSlot(db, userId, slot.id))?.state ?? toPublishState(slot)
        }
      }
      await patchTarget(db, target, {
        opted_out: true,
        provider_post_id: null,
        publish_status: "idle",
        publish_error: null,
        publish_synced_at: new Date().toISOString(),
      })
      return (await rollupSlot(db, userId, slot.id))?.state ?? toPublishState(slot)
    }

    await patchTarget(db, target, { opted_out: false, publish_status: "idle", publish_error: null })
    return syncSlot(db, userId, corePostId, format)
  } catch (err) {
    console.error("[social/bridge][opt-out]", err)
    return {
      status: "failed",
      code: "provider_error",
      message: "לא הצלחנו לעדכן לאן הפוסט עולה. אפשר לנסות שוב.",
    }
  }
}

// ---------------------------------------------------------------------------
// leaving the queue
// ---------------------------------------------------------------------------

/** Targets that still have something sitting at the provider. */
function holdsProviderPost(row: Pick<TargetRow, "provider_post_id" | "published_at" | "publish_status">): boolean {
  return !!row.provider_post_id && !row.published_at && row.publish_status !== "published"
}

/**
 * Cancel at the provider, for every target matching the filter, BEFORE the
 * caller deletes or detaches them.
 *
 * Returns the slots that could not be fully cancelled. Those must not be
 * deleted: a slot that disappears from the board while one of its posts is
 * still queued is the worst outcome available — it goes out, and she has
 * nowhere left to see it.
 */
export async function cancelSlots(
  db: Db,
  userId: string,
  filter: { corePostId?: string; format?: string | null; socialAccountId?: string },
): Promise<{ cancelled: number; stuck: SlotRow[] }> {
  let targets: TargetRow[] = []
  const slotsById = new Map<string, SlotRow>()

  if (filter.socialAccountId) {
    // Pre-042 slots on this account get their target first, so they're seen.
    const { data: legacy } = await db
      .from("scheduled_posts")
      .select(SLOT_COLUMNS)
      .eq("user_id", userId)
      .eq("social_account_id", filter.socialAccountId)
    for (const s of (legacy ?? []) as SlotRow[]) await loadTargets(db, s)

    const { data } = await db
      .from("scheduled_post_targets")
      .select(TARGET_COLUMNS)
      .eq("user_id", userId)
      .eq("social_account_id", filter.socialAccountId)
    targets = (data ?? []) as TargetRow[]
  } else {
    let q = db.from("scheduled_posts").select(SLOT_COLUMNS).eq("user_id", userId)
    if (filter.corePostId) q = q.eq("core_post_id", filter.corePostId)
    if (filter.format) q = q.eq("format", filter.format)
    const { data } = await q
    for (const s of (data ?? []) as SlotRow[]) {
      slotsById.set(s.id, s)
      targets.push(...(await loadTargets(db, s)))
    }
  }

  targets = targets.filter(holdsProviderPost)
  if (targets.length === 0) return { cancelled: 0, stuck: [] }

  const publisher = getSocialPublisher(db)
  const stuckSlotIds = new Set<string>()
  const touched = new Set<string>()
  let cancelled = 0
  for (const t of targets) {
    touched.add(t.scheduled_post_id)
    try {
      await publisher.cancelPost(userId, t.provider_post_id as string)
      await patchTarget(db, t, {
        provider_post_id: null,
        publish_status: "idle",
        publish_error: null,
        publish_synced_at: new Date().toISOString(),
      })
      cancelled++
    } catch (err) {
      describe(err, "cancel", t.platform)
      await patchTarget(
        db,
        t,
        failurePatch(
          "cancel_failed",
          `לא הצלחנו להוציא את הפוסט מהתור ${inNetwork(t.platform)}, והוא עדיין עלול להתפרסם. אפשר לנסות שוב.`,
        ),
      )
      stuckSlotIds.add(t.scheduled_post_id)
    }
  }
  for (const id of touched) await rollupSlot(db, userId, id)

  const stuck: SlotRow[] = []
  for (const id of stuckSlotIds) {
    const known = slotsById.get(id)
    if (known) stuck.push(known)
    else {
      const { data } = await db.from("scheduled_posts").select(SLOT_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle()
      if (data) stuck.push(data as SlotRow)
    }
  }
  return { cancelled, stuck }
}

/** How many posts would be pulled from the queue if this account went away. */
export async function countQueuedForAccount(db: Db, userId: string, socialAccountId: string) {
  const { data, error } = await db
    .from("scheduled_post_targets")
    .select("provider_post_id, published_at, publish_status")
    .eq("user_id", userId)
    .eq("social_account_id", socialAccountId)
  if (error) {
    // Before 042 is applied: fall back to the slot columns.
    const { data: legacy } = await db
      .from("scheduled_posts")
      .select("provider_post_id, published_at, publish_status")
      .eq("user_id", userId)
      .eq("social_account_id", socialAccountId)
    return ((legacy ?? []) as TargetRow[]).filter(holdsProviderPost).length
  }
  return ((data ?? []) as TargetRow[]).filter(holdsProviderPost).length
}

/**
 * After a (re)connect: the targets that failed only because there was no live
 * connection get another go, so "חיבור מחדש" actually restores the queue
 * rather than just turning the badge green.
 */
export async function resumeAfterConnect(db: Db, userId: string): Promise<number> {
  const { data } = await db
    .from("scheduled_post_targets")
    .select(TARGET_COLUMNS)
    .eq("user_id", userId)
    .eq("publish_status", "failed")
    .eq("opted_out", false)
  const slotIds = new Set(
    ((data ?? []) as TargetRow[])
      .filter((t) => {
        const code = decodePublishError(t.publish_error)?.code
        return code === "needs_reconnect" || code === "not_connected"
      })
      .map((t) => t.scheduled_post_id),
  )
  // Pre-042 slots that failed the same way, not adopted yet.
  const { data: legacy } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .eq("publish_status", "failed")
  for (const s of (legacy ?? []) as SlotRow[]) {
    const code = decodePublishError(s.publish_error)?.code
    if (code === "needs_reconnect" || code === "not_connected") slotIds.add(s.id)
  }
  if (slotIds.size === 0) return 0

  const { data: slots } = await db
    .from("scheduled_posts")
    .select("id, core_post_id, format")
    .eq("user_id", userId)
    .in("id", [...slotIds])
  let resumed = 0
  for (const s of (slots ?? []) as Pick<SlotRow, "id" | "core_post_id" | "format">[]) {
    const state = await syncSlot(db, userId, s.core_post_id, s.format)
    if (state.status === "queued") resumed++
  }
  return resumed
}

/**
 * Per-network state for a set of slots, for the board's GET. Answers an empty
 * map — never throws — so the board still loads if 042 hasn't been applied.
 */
export async function loadTargetStates(
  db: Db,
  userId: string,
  slotIds: string[],
): Promise<Map<string, TargetPublishState[]>> {
  const out = new Map<string, TargetPublishState[]>()
  if (slotIds.length === 0) return out
  const { data, error } = await db
    .from("scheduled_post_targets")
    .select(TARGET_COLUMNS)
    .eq("user_id", userId)
    .in("scheduled_post_id", slotIds)
  if (error) return out
  const rows = ((data ?? []) as TargetRow[]).sort(
    (a, b) => PUBLISH_PLATFORMS.indexOf(a.platform) - PUBLISH_PLATFORMS.indexOf(b.platform),
  )
  const handles = await handlesFor(db, userId, rows)
  for (const t of rows) {
    const list = out.get(t.scheduled_post_id) ?? []
    list.push(toTargetState(t, handles.get(t.social_account_id ?? "")))
    out.set(t.scheduled_post_id, list)
  }
  return out
}

// ---------------------------------------------------------------------------
// what happened since
// ---------------------------------------------------------------------------

/**
 * Bring the board's view of the queue up to date. Called when the calendar
 * opens.
 *
 *   - Targets whose time has passed: read the outcome back from the provider —
 *     published (with the permalink), failed (with a reason), or, when the
 *     provider says nothing yet, "יצא לפרסום". Never "פורסם" on a guess.
 *   - Targets still waiting: if the caption or media changed after they were
 *     queued, flag them. The provider holds the old copy.
 *   - A connection that lapsed: every queued target on it is marked.
 *
 * Returns the roll-up (with per-network detail) of every slot it looked at,
 * keyed `corePostId:format`.
 */
export async function refreshPublishStates(
  db: Db,
  userId: string,
): Promise<Record<string, PublishState>> {
  const out: Record<string, PublishState> = {}
  const LIVE = ["queued", "sent", "pending", "published"]

  // Adopt pre-042 slots still in flight, so they are read like the rest.
  const { data: legacy } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .not("provider_post_id", "is", null)
    .in("publish_status", LIVE)
  for (const s of (legacy ?? []) as SlotRow[]) await loadTargets(db, s)

  const { data: tdata } = await db
    .from("scheduled_post_targets")
    .select(TARGET_COLUMNS)
    .eq("user_id", userId)
    .eq("opted_out", false)
    .in("publish_status", LIVE)
  const targets = (tdata ?? []) as TargetRow[]
  if (targets.length === 0) return out

  const { data: sdata } = await db
    .from("scheduled_posts")
    .select(SLOT_COLUMNS)
    .eq("user_id", userId)
    .in("id", [...new Set(targets.map((t) => t.scheduled_post_id))])
  const slots = new Map(((sdata ?? []) as SlotRow[]).map((s) => [s.id, s]))

  const accounts = await accountsByPlatform(db, userId)
  const byId = new Map([...accounts.values()].map((a) => [a.id, a]))
  let publisher: SocialPublisher | null = null
  const getPublisher = () => (publisher ??= getSocialPublisher(db))
  const now = Date.now()

  const editedAt = await lastContentEdits(db, [...slots.values()])
  const extras = new Map<string, Partial<TargetPublishState>>()
  // Permalinks aren't stored, so a published target is re-read for its link —
  // capped, to keep the page load cheap.
  let permalinkReads = 0

  for (const t of targets) {
    const slot = slots.get(t.scheduled_post_id)
    if (!slot) continue
    let instant: number
    try {
      instant = slotToInstant(slot.scheduled_date, slot.scheduled_time).getTime()
    } catch {
      continue
    }

    try {
      if (t.publish_status === "published") {
        if (t.provider_post_id && permalinkReads < 10 && now - instant < 30 * 86400_000) {
          permalinkReads++
          const held = await getPublisher().getPost(userId, t.provider_post_id)
          extras.set(t.id, { permalink: held.permalink ?? null })
        }
        continue
      }

      if (t.publish_status === "pending") {
        const lockedAt = t.publish_synced_at ? Date.parse(t.publish_synced_at) : 0
        if (now - lockedAt > LOCK_STALE_MS) {
          // A request died mid-call. Ask the provider what it actually holds.
          if (t.provider_post_id) {
            await syncSlot(db, userId, slot.core_post_id, slot.format)
          } else {
            await patchTarget(db, t, failurePatch("provider_error", "לא ברור אם הפוסט נכנס לתור. אפשר לנסות שוב."))
          }
        }
        continue
      }

      // queued / sent
      const account = t.social_account_id ? byId.get(t.social_account_id) : undefined
      if (account && account.status !== "connected" && t.publish_status === "queued") {
        await patchTarget(db, t, failurePatch("needs_reconnect", lapsedMessage(t.platform)))
        continue
      }

      if (instant <= now && t.provider_post_id) {
        const held = await getPublisher().getPost(userId, t.provider_post_id)
        if (held.outcome === "published") {
          await patchTarget(db, t, {
            publish_status: "published",
            publish_error: null,
            published_at: (held.publishedAt ?? new Date()).toISOString(),
            publish_synced_at: new Date().toISOString(),
          })
          extras.set(t.id, { permalink: held.permalink ?? null })
          continue
        }
        if (held.outcome === "failed") {
          console.error("[social/bridge] provider reported a failed publish", t.id, t.platform, held.error)
          await patchTarget(
            db,
            t,
            failurePatch(
              "provider_error",
              `הפוסט לא עלה ${inNetwork(t.platform)} במועד. אפשר לבחור מועד חדש ולנסות שוב.`,
            ),
          )
          continue
        }
        if (now - instant > SENT_GRACE_MS && t.publish_status !== "sent") {
          // Past its time, no word either way. Say what we know — it left.
          await patchTarget(db, t, { publish_status: "sent", publish_error: null })
        }
        continue
      }

      if (t.publish_status === "queued" && t.publish_synced_at) {
        const edited = editedAt.get(slot.id)
        const changed = edited !== undefined && edited > Date.parse(t.publish_synced_at)
        const flagged = decodePublishError(t.publish_error)?.code === "content_changed"
        if (changed && !flagged) {
          await patchTarget(db, t, {
            publish_error: encodePublishError(
              "content_changed",
              `הכיתוב או המדיה השתנו מאז התזמון, ו${inNetwork(t.platform)} עדיין מחכה הגרסה הקודמת.`,
            ),
          })
        }
      }
    } catch (err) {
      // A refresh that can't reach the provider changes nothing — the target
      // keeps the last state we actually know.
      describe(err, "refresh", t.platform)
    }
  }

  for (const slotId of slots.keys()) {
    const r = await rollupSlot(db, userId, slotId, extras)
    if (r) out[r.key] = r.state
  }
  return out
}

/** Latest edit time of each slot's caption or media, keyed by slot row id. */
async function lastContentEdits(
  db: Db,
  rows: Pick<SlotRow, "id" | "core_post_id" | "format">[],
): Promise<Map<string, number>> {
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
