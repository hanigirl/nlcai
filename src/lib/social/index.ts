/**
 * The switch.
 *
 * When nlcai stops borrowing the founders' HighLevel account and starts using
 * its own Meta app, this file is the change: add `MetaPublisher`, flip the
 * default, done. Nothing above it — no route, no component, no calendar code —
 * mentions a vendor, so nothing above it moves.
 *
 * What that day actually costs, in order of pain:
 *   1. Every user reconnects her Instagram once. Unavoidable: OAuth tokens
 *      belong to whoever owns the app. A notification, not a migration.
 *   2. A publish worker. HighLevel holds the clock for us today; Meta has no
 *      scheduling at all, so we would need a cron reading the `queued` rows in
 *      `scheduled_posts` and calling publish at the slot minute. There is no
 *      cron in this project yet — that is the one genuinely new piece.
 *   3. Business verification plus app review, roughly a month of queueing.
 *      Worth starting long before the code is ready, since it is a queue
 *      rather than work.
 *
 * The upside on the far side: Meta's publishing API is free at any volume,
 * while every third-party charges per connected account — a per-user cost that
 * grows exactly when the product succeeds.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SocialProvider } from "@/lib/supabase/types"
import { HighLevelPublisher } from "./highlevel"
import type { SocialPublisher } from "./types"

export * from "./types"

/**
 * Env-driven so the switch can be staged per environment — point staging at
 * `meta` and let it prove itself before production follows.
 */
function configuredProvider(): SocialProvider {
  return process.env.SOCIAL_PROVIDER === "meta" ? "meta" : "highlevel"
}

/**
 * @param db service-role client — publishing runs server-side, outside any
 *           user session, so it needs to read rows RLS would hide.
 */
export function getSocialPublisher(db: SupabaseClient<Database>): SocialPublisher {
  const provider = configuredProvider()

  if (provider === "meta") {
    // Deliberately not stubbed with a silent fallback to HighLevel: posting to
    // the wrong provider is worse than not posting.
    throw new Error(
      "SOCIAL_PROVIDER=meta is set but MetaPublisher is not implemented yet"
    )
  }

  return new HighLevelPublisher(db)
}
