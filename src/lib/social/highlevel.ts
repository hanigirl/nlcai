/**
 * HighLevel adapter — the only file in the codebase that knows this vendor exists.
 *
 * Why HighLevel at all: the nlcai founders are on Agency Pro, so the account is
 * already paid for. It holds the OAuth relationship with Instagram *and* it
 * holds the clock, which means we do not have to build a publish worker today.
 * The trade is that the Instagram consent screen says "HighLevel", not "nlcai",
 * and the connection is registered to the founders' account rather than to the
 * product — if that relationship ever changes, the publishing pipeline goes
 * with it. That is a business risk, not a technical one, and it is the reason
 * `types.ts` exists as a seam.
 *
 * The user never sees a HighLevel interface: the connect flow opens as a popup
 * from inside nlcai and reports back by posting a message to the opener.
 *
 * ---- Wire-shape confidence ----
 * Endpoint paths, the OAuth popup contract, and the account-attach flow are
 * from HighLevel's published API docs. The create-post *body* field names are
 * not — their docs render that schema behind an interactive widget that does
 * not serve to a plain fetch. Every one of those names is therefore quarantined
 * in `buildPostBody` below and marked, so a live call with a real token
 * corrects them in one place rather than across the file.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  Database,
  SocialAccountRow,
  SocialPlatform,
} from "@/lib/supabase/types"
import { MAX_CAPTION_CHARS, MAX_CAROUSEL_ITEMS } from "./media-spec"
import { getAgencyToken, getLocationToken } from "./highlevel-auth"
import {
  SocialPublishError,
  type ConnectHandoff,
  type ScheduleResult,
  type SchedulePostInput,
  type SocialAccount,
  type SocialPublisher,
} from "./types"

const API_BASE = "https://services.leadconnectorhq.com"

// HighLevel pins behaviour to a dated API version rather than a path segment.
const API_VERSION = "2021-07-28"

/**
 * Instagram limits as HighLevel enforces them. Two of these are stricter than
 * Meta's own and will bite before Meta ever does:
 *
 *  - 25 posts / 24h, where Meta allows 100. Not a ceiling one user reaches,
 *    which is the second reason each user gets her own sub-account: if the
 *    count is per sub-account rather than per Instagram account, a shared
 *    bucket would jam everyone at once.
 *  - Aspect ratio must sit between 4:5 and 1.91:1. So 4:5 is the *tallest*
 *    allowed — anything 9:16 is rejected. Worth checking against what the
 *    carousel and story renderers actually export.
 *
 * We validate here only what is knowable without downloading the bytes; the
 * aspect-ratio rule needs real dimensions and belongs at render time.
 */
const LIMITS = {
  maxCarouselItems: MAX_CAROUSEL_ITEMS,
  maxCaptionChars: MAX_CAPTION_CHARS,
  /** Stories take no caption at all, and no API can add text or stickers to one. */
  storyCaptionChars: 0,
} as const

type GhlFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  query?: Record<string, string | undefined>
  /**
   * The bearer to send.
   *
   * Agency-level calls (creating a sub-account) use the agency token; social
   * planner calls are sub-account-scoped and take a token minted for that
   * specific sub-account. Passing it in rather than resolving it inside keeps
   * the choice visible at every call site, because getting it wrong fails in a
   * way that reads like a permissions bug.
   */
  token: string
}

async function ghlFetch<T>(path: string, opts: GhlFetchOptions): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v)
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Version: API_VERSION,
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")

    // 401 from an agency token is our misconfiguration. A *connection* going
    // stale shows up as 4xx on the posting endpoints instead, which is the
    // case worth telling her about — a lapsed Instagram token is the single
    // most likely reason a scheduled post silently never appears.
    if (res.status === 401 || res.status === 403) {
      throw new SocialPublishError(
        "החיבור לאינסטגרם פג. צריך לחבר מחדש כדי שהפוסטים ימשיכו לצאת.",
        "needs_reconnect"
      )
    }
    if (res.status === 429) {
      throw new SocialPublishError(
        "הגעת למגבלת הפרסומים היומית של אינסטגרם (25 ביממה). הפוסט יידחה למחר.",
        "rate_limited"
      )
    }
    if (res.status === 422) {
      throw new SocialPublishError(
        "אינסטגרם דחתה את המדיה. בדקי שיחס הגובה-רוחב בין 4:5 ל-1.91:1 ושהקובץ קטן מ-8MB.",
        "media_rejected"
      )
    }
    throw new SocialPublishError(
      `HighLevel ${res.status}: ${detail.slice(0, 300)}`,
      "provider_error",
      false
    )
  }

  return (await res.json()) as T
}

/**
 * Every field name here is unverified — see the header note. Keeping them in
 * one function means a token and one live call fixes the whole adapter.
 */
function buildPostBody(input: SchedulePostInput, externalAccountId: string) {
  return {
    accountIds: [externalAccountId],
    summary: input.caption,
    media: input.media.map((m) => ({ url: m.url, type: m.type })),
    type: input.kind,
    // Reel cover. HighLevel documents thumbnail support for reels but not the
    // field name, so this is one of the guesses — omitted entirely rather than
    // sent as null, since a stray null is likelier to be rejected than a
    // missing key.
    ...(input.coverUrl ? { thumbnail: input.coverUrl } : {}),
    // ISO-8601. `publishAt` is already an absolute instant by contract — the
    // calendar's local-day-plus-hour has been resolved before it gets here.
    scheduleDate: input.publishAt.toISOString(),
    status: "scheduled",
  }
}

function validate(input: SchedulePostInput): void {
  if (input.media.length === 0) {
    throw new SocialPublishError("אין מדיה לפרסום.", "media_rejected")
  }
  if (input.media.length > LIMITS.maxCarouselItems) {
    throw new SocialPublishError(
      `קרוסלה באינסטגרם מוגבלת ל-${LIMITS.maxCarouselItems} פריטים.`,
      "media_rejected"
    )
  }
  if (input.kind === "reel" && input.media.length > 1) {
    throw new SocialPublishError("רילז הוא סרטון אחד בלבד.", "media_rejected")
  }

  const limit =
    input.kind === "story" ? LIMITS.storyCaptionChars : LIMITS.maxCaptionChars
  if (input.caption.length > limit) {
    throw new SocialPublishError(
      input.kind === "story"
        ? "סטוריז לא נושא כיתוב. כל טקסט צריך להיות אפוי בתוך התמונה."
        : `הכיתוב ארוך מ-${LIMITS.maxCaptionChars} תווים.`,
      "media_rejected"
    )
  }
}

function toSocialAccount(row: SocialAccountRow): SocialAccount {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    avatarUrl: row.avatar_url,
    status: row.status,
  }
}

export class HighLevelPublisher implements SocialPublisher {
  readonly provider = "highlevel" as const

  /** Service-role client: publishing runs server-side, outside any user session. */
  constructor(private readonly db: SupabaseClient<Database>) {}

  /**
   * One HighLevel sub-account per user, created on demand.
   *
   * This is only possible because the founders are on Agency Pro — sub-account
   * creation over the API is gated to that plan. On the cheaper Unlimited plan
   * the same design still works, but each sub-account has to be opened by hand
   * in the UI first.
   */
  async ensureTenant(userId: string): Promise<void> {
    const { data: existing } = await this.db
      .from("social_tenants")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", this.provider)
      .maybeSingle()

    if (existing) return

    // The agency id comes from the install itself rather than a second env
    // var — one less thing to keep in sync, and it cannot disagree with the
    // credentials it is used alongside.
    const { token, companyId } = await getAgencyToken()

    const { data: userRow } = await this.db
      .from("users")
      .select("email")
      .eq("id", userId)
      .single()
    const user = userRow as { email: string | null } | null

    const created = await ghlFetch<{ id: string }>("/locations/", {
      method: "POST",
      // Agency-scoped: creating a sub-account is not something a sub-account
      // token can do.
      token,
      body: {
        companyId,
        // The sub-account is plumbing the user never sees; naming it after her
        // email is purely so a human debugging in HighLevel's UI can tell the
        // rows apart.
        name: `nlcai — ${user?.email ?? userId}`,
      },
    })

    // `as never` per the repo convention (see api/schedule/route.ts) — this
    // supabase-js version widens write payloads to `never` under the
    // Database generic.
    await this.db.from("social_tenants").insert({
      user_id: userId,
      provider: this.provider,
      external_tenant_id: created.id,
    } as never)
  }

  private async tenantId(userId: string): Promise<string> {
    const { data } = await this.db
      .from("social_tenants")
      .select("external_tenant_id")
      .eq("user_id", userId)
      .eq("provider", this.provider)
      .maybeSingle()

    const tenant = data as { external_tenant_id: string } | null
    if (!tenant) {
      throw new SocialPublishError("עדיין לא חיברת חשבון אינסטגרם.", "not_connected")
    }
    return tenant.external_tenant_id
  }

  /**
   * The URL opens in a popup. HighLevel runs the Instagram consent screen and,
   * when it closes, posts a message to the opener carrying `accountId` — that
   * value is what `finishConnect` takes. The window listener belongs in the UI:
   *
   *   window.addEventListener("message", (e) => {
   *     if (e.data?.page === "social_media_posting") { ...e.data.accountId }
   *   })
   */
  async startConnect(
    userId: string,
    platform: SocialPlatform
  ): Promise<ConnectHandoff> {
    await this.ensureTenant(userId)
    const locationId = await this.tenantId(userId)

    return {
      url: `${API_BASE}/social-media-posting/oauth/${platform}/start?locationId=${encodeURIComponent(
        locationId
      )}&userId=${encodeURIComponent(userId)}`,
    }
  }

  /**
   * Attach the chosen account to the user's sub-account, then mirror it here.
   *
   * Upserting rather than inserting is what makes reconnection work: a user
   * whose token lapsed comes back through the same path and lands on the same
   * row, flipping `needs_reconnect` back to `connected`.
   */
  async finishConnect(
    userId: string,
    platform: SocialPlatform,
    externalAccountId: string
  ): Promise<SocialAccount> {
    const locationId = await this.tenantId(userId)

    const attached = await ghlFetch<{
      results?: { id?: string; name?: string; avatar?: string }
    }>(
      `/social-media-posting/oauth/${locationId}/${platform}/accounts/${encodeURIComponent(
        externalAccountId
      )}`,
      { method: "POST", token: await getLocationToken(locationId) }
    )

    const { data, error } = await this.db
      .from("social_accounts")
      .upsert(
        {
          user_id: userId,
          provider: this.provider,
          platform,
          external_account_id: externalAccountId,
          external_tenant_id: locationId,
          handle: attached.results?.name ?? null,
          avatar_url: attached.results?.avatar ?? null,
          status: "connected",
        } as never,
        { onConflict: "user_id,provider,platform,external_account_id" }
      )
      .select()
      .single()

    if (error) {
      throw new SocialPublishError(
        `failed to persist connected account: ${error.message}`,
        "provider_error",
        false
      )
    }

    return toSocialAccount(data as SocialAccountRow)
  }

  async listAccounts(userId: string): Promise<SocialAccount[]> {
    const { data } = await this.db
      .from("social_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", this.provider)
      .neq("status", "revoked")

    return ((data ?? []) as SocialAccountRow[]).map(toSocialAccount)
  }

  /**
   * Marked revoked rather than deleted: `scheduled_posts.social_account_id`
   * points here, and a disconnect should not quietly erase the record of where
   * already-published posts went.
   */
  async disconnect(userId: string, socialAccountId: string): Promise<void> {
    await this.db
      .from("social_accounts")
      .update({ status: "revoked" } as never)
      .eq("id", socialAccountId)
      .eq("user_id", userId)
  }

  private async accountRow(
    userId: string,
    socialAccountId: string
  ): Promise<SocialAccountRow> {
    const { data } = await this.db
      .from("social_accounts")
      .select("*")
      .eq("id", socialAccountId)
      .eq("user_id", userId)
      .maybeSingle()

    if (!data) {
      throw new SocialPublishError("חשבון האינסטגרם לא מחובר.", "not_connected")
    }
    const row = data as SocialAccountRow
    if (row.status !== "connected") {
      throw new SocialPublishError(
        "החיבור לאינסטגרם פג. צריך לחבר מחדש.",
        "needs_reconnect"
      )
    }
    return row
  }

  async schedulePost(input: SchedulePostInput): Promise<ScheduleResult> {
    validate(input)

    const account = await this.accountRow(input.userId, input.socialAccountId)
    const locationId = account.external_tenant_id ?? (await this.tenantId(input.userId))

    const created = await ghlFetch<{ id?: string; _id?: string }>(
      `/social-media-posting/${locationId}/posts`,
      {
        method: "POST",
        body: buildPostBody(input, account.external_account_id),
        token: await getLocationToken(locationId),
      }
    )

    const providerPostId = created.id ?? created._id
    if (!providerPostId) {
      // Without an id we can never move or cancel this post again — better to
      // fail loudly now than to leave an unreachable item in the queue.
      throw new SocialPublishError(
        "HighLevel accepted the post but returned no id",
        "provider_error",
        false
      )
    }

    return { providerPostId }
  }

  async reschedulePost(
    userId: string,
    providerPostId: string,
    publishAt: Date
  ): Promise<void> {
    const locationId = await this.tenantId(userId)
    await ghlFetch(`/social-media-posting/${locationId}/posts/${providerPostId}`, {
      method: "PUT",
      body: { scheduleDate: publishAt.toISOString() },
      token: await getLocationToken(locationId),
    })
  }

  async cancelPost(userId: string, providerPostId: string): Promise<void> {
    const locationId = await this.tenantId(userId)
    await ghlFetch(`/social-media-posting/${locationId}/posts/${providerPostId}`, {
      method: "DELETE",
      token: await getLocationToken(locationId),
    })
  }
}
