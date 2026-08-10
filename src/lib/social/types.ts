/**
 * The seam.
 *
 * Instagram's API cannot schedule. There is no "publish this Tuesday at 09:00"
 * parameter — that exists for Facebook Pages, not Instagram. Someone has to be
 * awake at 09:00 and press publish. Every scheduling product is a queue plus a
 * clock; what you actually buy from them is the OAuth relationship with the
 * user's account.
 *
 * So this file describes what we need from *whoever* holds that relationship,
 * in terms that mention no vendor. Today that is HighLevel (the nlcai founders
 * are on Agency Pro, so it costs us nothing and it holds the clock too).
 * Tomorrow it may be nlcai's own Meta app — free forever at any volume, and it
 * keeps the user inside the product, at the cost of business verification and
 * app review.
 *
 * Everything above this file — the calendar, the API routes, the UI — must go
 * through `SocialPublisher` and must never learn a vendor's vocabulary. That
 * is what keeps the eventual switch to Meta a one-file change instead of a
 * refactor. The database mirrors the same discipline: `external_*` columns
 * hold opaque ids and nothing above the adapter interprets them.
 *
 * What the switch will genuinely cost, and no abstraction can prevent: every
 * user reconnects her Instagram once. OAuth tokens belong to whoever owns the
 * app, so they cannot be carried across. That is a notification, not a
 * migration.
 */

import type {
  SocialAccountStatus,
  SocialPlatform,
  SocialProvider,
} from "@/lib/supabase/types"

/** A connected destination, as the app thinks of it — no vendor fields. */
export interface SocialAccount {
  /** Our row id. The only id the UI should ever hold. */
  id: string
  platform: SocialPlatform
  handle: string | null
  avatarUrl: string | null
  status: SocialAccountStatus
}

/**
 * One piece of media on its way out.
 *
 * `url` must be publicly reachable — providers fetch the bytes themselves
 * rather than accepting an upload, so a signed URL has to outlive the slot.
 */
export interface SocialMedia {
  url: string
  type: "image" | "video"
}

/** What "publish this" means, stated without reference to any provider. */
export interface SchedulePostInput {
  userId: string
  /** Our `social_accounts.id` — resolved to the vendor's id inside the adapter. */
  socialAccountId: string
  /** The caption. Instagram allows 2,200 characters on posts and reels, 0 on stories. */
  caption: string
  media: SocialMedia[]
  /**
   * When it goes live, as an absolute instant.
   *
   * The calendar stores a local date plus "HH:00" (see migration 026) because
   * "the 5th at 9am" must mean the same wall-clock time for everyone reading
   * the board. Converting that to a real instant is the caller's job — by the
   * time it reaches a provider the ambiguity has to be gone.
   */
  publishAt: Date
  /**
   * `post` covers single images and carousels (up to 10 items).
   * `story` accepts no caption at all and cannot carry text or stickers added
   * by an API — any text has to be baked into the image itself.
   */
  kind: "post" | "reel" | "story"
}

export interface ScheduleResult {
  /** The provider's handle on the queued post. Stored so we can move or cancel it. */
  providerPostId: string
}

/** Where a connect flow should be opened, and what to listen for when it finishes. */
export interface ConnectHandoff {
  /**
   * Open this in a popup, not a redirect — the flow reports back by posting a
   * message to the opener window rather than returning to a callback URL.
   */
  url: string
}

/**
 * A failure the user can act on, separated from the ones only we can.
 *
 * The distinction matters because the failure mode of this whole feature is
 * silence: a lapsed token means the post simply never appears and nobody finds
 * out. Anything marked `userActionable` is something worth interrupting her
 * for — everything else is ours to fix.
 */
export class SocialPublishError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_connected"
      | "needs_reconnect"
      | "media_rejected"
      | "rate_limited"
      | "provider_error",
    readonly userActionable: boolean = true
  ) {
    super(message)
    this.name = "SocialPublishError"
  }
}

/**
 * The contract. One implementation per provider, resolved in `index.ts`.
 *
 * Deliberately narrow: connect an account, queue a post, move it, cancel it.
 * Anything wider starts leaking vendor concepts back into the app.
 */
export interface SocialPublisher {
  readonly provider: SocialProvider

  /**
   * Make sure the user has somewhere to hang connections, creating it if not.
   *
   * For HighLevel this mints a sub-account: one per user rather than one
   * shared bucket, because a shared bucket has no barrier between customers
   * and a single bad lookup posts one woman's content to another woman's
   * Instagram. Providers with no such concept implement this as a no-op.
   */
  ensureTenant(userId: string): Promise<void>

  /** Begin connecting an Instagram account. Returns where to open the flow. */
  startConnect(userId: string, platform: SocialPlatform): Promise<ConnectHandoff>

  /**
   * Finish it, once the popup reports back with the provider's account id.
   * Idempotent: reconnecting an account updates the existing row.
   */
  finishConnect(
    userId: string,
    platform: SocialPlatform,
    externalAccountId: string
  ): Promise<SocialAccount>

  listAccounts(userId: string): Promise<SocialAccount[]>

  disconnect(userId: string, socialAccountId: string): Promise<void>

  /** Hand the post to the provider's queue. */
  schedulePost(input: SchedulePostInput): Promise<ScheduleResult>

  /** The calendar is drag-and-drop, so a moved slot has to move at the provider too. */
  reschedulePost(userId: string, providerPostId: string, publishAt: Date): Promise<void>

  cancelPost(userId: string, providerPostId: string): Promise<void>
}
