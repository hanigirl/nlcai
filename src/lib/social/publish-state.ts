/**
 * What a calendar slot's publish status looks like on the wire.
 *
 * This file is the read-side contract between the publish bridge (server) and
 * every surface that shows publish status: the calendar card today, the canvas
 * format card and the calendar format preview later. It imports nothing that
 * only runs on the server, so a client component can read it directly.
 *
 * ---- The one rule it encodes (Hani, 2026-10-15) ----
 *
 * A slot is "queued" ("תוזמן") ONLY when the provider handed back an id for
 * it. Until then it is "pending" ("בתהליך"), and when it fails it is "failed"
 * with a reason a person can act on. Nothing in between is allowed to read as
 * scheduled — a user who believes a post is going out, and it isn't, finds out
 * days later from an empty feed.
 *
 * ---- Why there is no separate "published" signal from the provider ----
 *
 * The post we create at the provider is a *parent*. When its time comes, the
 * provider marks the parent deleted and spawns a per-platform child that
 * carries the real outcome: `status: "published"`, the Instagram media id and
 * a permalink — or `status: "failed"` with an error. The parent itself stays
 * `scheduled` with `publishedAt: null` forever, which is the trap the 8.10 test
 * fell into. So "published" is read off the child (see `getPost` in the
 * adapter), never off the parent.
 */

/**
 * Storage values for `scheduled_posts.publish_status`.
 *
 *   idle      — board only. Never sent anywhere (no account, or a slot that
 *               predates the bridge and hasn't been touched since).
 *   pending   — a provider call is in flight. Doubles as the row lock that
 *               stops a double-click from creating two posts.
 *   queued    — the provider holds it, with an id, at the board's time.
 *   sent      — the slot time passed and the provider reported neither
 *               success nor failure yet. Shown as "יצא לפרסום", never as
 *               "פורסם".
 *   published — the provider's child post reported published, or the user
 *               marked it by hand.
 *   failed    — see the error code.
 */
export type PublishStatus = "idle" | "pending" | "queued" | "sent" | "published" | "failed"

/** Why a slot isn't (or is no longer) going out as planned. */
export type PublishErrorCode =
  | "not_connected"
  | "needs_reconnect"
  | "media_rejected"
  | "rate_limited"
  | "too_soon"
  | "provider_error"
  | "provider_mismatch"
  | "content_changed"
  | "cancel_failed"

/** The one next step a card offers for a given failure. */
export type PublishAction = "connect" | "reconnect" | "retry" | "fix_media" | "pick_time" | "update" | "mark_published"

/** The shape every UI reads. Attached to each `ScheduledPost` as `publish`. */
export interface PublishState {
  status: PublishStatus
  code?: PublishErrorCode | null
  /** Hebrew, written for the user, never mentions the provider by name. */
  message?: string | null
  /** The absolute instant the board's date + hour resolves to (Israel time). */
  publishAt?: string | null
  /** When the provider reports it went live. */
  publishedAt?: string | null
  /** Link to the live Instagram post, when the provider gave one. */
  permalink?: string | null
}

/** The action a card shows for a failure. One action, never a menu. */
export function actionFor(state: PublishState | undefined): PublishAction | null {
  if (!state) return null
  if (state.status === "sent") return "mark_published"
  if (state.status === "idle") return "retry"
  if (state.code === "content_changed") return "update"
  if (state.status !== "failed") return null
  switch (state.code) {
    case "not_connected":
      return "connect"
    case "needs_reconnect":
      return "reconnect"
    case "media_rejected":
      return "fix_media"
    case "too_soon":
      return "pick_time"
    default:
      return "retry"
  }
}

/**
 * `publish_error` holds `{ code, message }` as JSON text.
 *
 * The column is free text (033) and a bare message cannot tell the card which
 * action to offer, so the code travels with it. Anything that isn't our JSON —
 * a hand-written note, a pre-bridge value — reads as a generic provider error
 * with the text kept as the message, rather than being thrown away.
 */
export function encodePublishError(code: PublishErrorCode, message: string): string {
  return JSON.stringify({ code, message })
}

export function decodePublishError(
  raw: string | null | undefined,
): { code: PublishErrorCode; message: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown }
    if (typeof parsed?.code === "string" && typeof parsed?.message === "string") {
      return { code: parsed.code as PublishErrorCode, message: parsed.message }
    }
  } catch {
    // fall through
  }
  return { code: "provider_error", message: raw }
}

/** The provider rejects anything under ~6 minutes ahead. 7 clears it with margin. */
export const PUBLISH_FLOOR_MS = 7 * 60 * 1000
