/**
 * The agency install's token lifecycle.
 *
 * One OAuth grant, made once by the provider account's owner, that the whole
 * product runs on. Everything here is server-side and service-role only.
 *
 * ---- The one hazard ----
 *
 * Refresh tokens ROTATE. Redeeming one invalidates it and hands back a
 * replacement. Two consequences shape this file:
 *
 *   1. The new pair is written before it is used for anything else. Redeeming
 *      and then failing to persist kills the install permanently — no code
 *      path can recover it, a human has to reinstall the app.
 *   2. Refresh happens on a margin, not on a 401. Waiting for expiry means a
 *      slot boundary with several posts due fires several concurrent
 *      refreshes, all racing on the same rotating token; the winner survives
 *      and the losers are holding an invalidated one.
 *
 * The margin makes the race rare; `getAgencyToken` handles the rest: one
 * refresh per process at a time, a re-read before redeeming, and after a
 * failed redeem a re-read that adopts the pair another instance stored.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { SocialPublishError } from "./types"

const API_BASE = "https://services.leadconnectorhq.com"

/** Refresh this far ahead of expiry. Tokens last ~24h, so this is generous. */
const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000

type CredentialsRow = {
  company_id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  companyId?: string
  locationId?: string
}

/**
 * The standalone token for sub-account management, plus the agency it belongs to.
 *
 * Deliberately separate from the OAuth app below. Verified live against the
 * real credentials (2026-08-13):
 *   - this token answers 200 on /locations/search
 *   - and 401 "The token is not authorized for this scope." on the social
 *     planner
 * The OAuth app is the mirror image. So the split is not a preference, it is
 * what the provider enforces, and collapsing them would break one side.
 */
export function locationsToken(): { token: string; companyId: string } {
  const token = process.env.HIGHLEVEL_PIT
  const companyId = process.env.HIGHLEVEL_COMPANY_ID
  if (!token || !companyId) {
    throw new SocialPublishError(
      "HIGHLEVEL_PIT / HIGHLEVEL_COMPANY_ID are not configured",
      "provider_error",
      false,
    )
  }
  return { token, companyId }
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.HIGHLEVEL_CLIENT_ID
  const clientSecret = process.env.HIGHLEVEL_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new SocialPublishError(
      "HIGHLEVEL_CLIENT_ID / HIGHLEVEL_CLIENT_SECRET are not configured",
      "provider_error",
      false,
    )
  }
  return { clientId, clientSecret }
}

/**
 * The redirect URI must be byte-identical to the one registered on the app —
 * it is sent again at token exchange and compared. The apex host matters:
 * www redirects to the apex, and a redirect mid-flow breaks the match.
 */
export function redirectUri(): string {
  return (
    process.env.HIGHLEVEL_REDIRECT_URI ??
    "https://nextlevelappai.com/api/social/provider/callback"
  )
}

/** HighLevel's token endpoint takes form-encoded bodies, not JSON. */
async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  })

  const json = (await res.json().catch(() => null)) as TokenResponse | null
  if (!res.ok || !json?.access_token || !json?.refresh_token) {
    throw new SocialPublishError(
      `HighLevel token exchange failed (${res.status})`,
      "provider_error",
      false,
    )
  }
  return json
}

function expiryFrom(expiresIn: number | undefined): string {
  // Default to 24h — the documented lifetime — if the field is ever absent.
  return new Date(Date.now() + (expiresIn ?? 86400) * 1000).toISOString()
}

/**
 * Complete the install: swap the authorization code for tokens and store them.
 *
 * `user_type: "Company"` is required, not cosmetic. A Location-level grant
 * cannot create sub-accounts and cannot mint tokens for other sub-accounts, so
 * installing this on a single sub-account instead of the agency produces
 * credentials that look fine and then fail at the first user who signs up.
 */
export async function completeInstall(code: string): Promise<{ companyId: string }> {
  // Always service-role: migration 034 enables RLS with no policies, so a
  // user-scoped client reads nothing here. Resolving it inside rather than
  // accepting one removes a whole class of "why is this empty" bugs.
  const db = createAdminClient()
  const { clientId, clientSecret } = credentials()

  const token = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    user_type: "Company",
  })

  if (!token.companyId) {
    throw new SocialPublishError(
      "ההתקנה בוצעה על תת-חשבון ולא על הסוכנות. צריך להתקין מרמת הסוכנות.",
      "provider_error",
      false,
    )
  }

  const { error } = await db.from("social_provider_credentials").upsert(
    {
      provider: "highlevel",
      company_id: token.companyId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiryFrom(token.expires_in),
    } as never,
    { onConflict: "provider" },
  )

  if (error) {
    throw new SocialPublishError(
      `failed to store install: ${error.message}`,
      "provider_error",
      false,
    )
  }

  return { companyId: token.companyId }
}

/**
 * Has the agency install been completed?
 *
 * Checked BEFORE anything with a side effect. Without this gate, a user who
 * clicks connect on a half-configured deploy gets a real sub-account created
 * for her — an actual record in the provider's account — and only then hits a
 * wall at the attach step. That leaves litter behind and reads to her as a
 * broken product rather than a feature that isn't switched on yet.
 */
export async function isProviderInstalled(): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("social_provider_credentials")
    .select("provider")
    .eq("provider", "highlevel")
    .maybeSingle()
  return !!data
}

async function loadCredentials(): Promise<CredentialsRow> {
  const { data } = await createAdminClient()
    .from("social_provider_credentials")
    .select("company_id, access_token, refresh_token, expires_at")
    .eq("provider", "highlevel")
    .maybeSingle()

  const row = data as CredentialsRow | null
  if (!row) {
    throw new SocialPublishError(
      "האפליקציה עדיין לא הותקנה על חשבון הסוכנות.",
      "provider_error",
      false,
    )
  }
  return row
}

/** Is this row's access token usable for at least `marginMs` more? */
function freshFor(row: CredentialsRow, marginMs: number): boolean {
  const expiresAt = new Date(row.expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > marginMs
}

/** A token another request just stored is good enough if it lives a minute more. */
const USABLE_MARGIN_MS = 60 * 1000

/**
 * One refresh at a time in this process. "Schedule all" fires several PUTs
 * at once; without this each one redeemed the same rotating refresh token,
 * the first won and the rest failed (QA 2026-11-15).
 */
let inflightRefresh: Promise<{ token: string; companyId: string }> | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A valid agency access token, refreshing first if it is close to expiring.
 *
 * Single-flight per process, compare-and-swap across processes: the row is
 * re-read right before redeeming (another instance may have refreshed
 * already), and a redeem that fails re-reads it again — if the refresh token
 * changed under us, another instance won the race and stored a working pair,
 * so that one is used.
 *
 * The write happens before the token is returned — see the hazard note above.
 */
export async function getAgencyToken(): Promise<{ token: string; companyId: string }> {
  const row = await loadCredentials()
  if (freshFor(row, REFRESH_MARGIN_MS)) {
    return { token: row.access_token, companyId: row.company_id }
  }
  if (!inflightRefresh) {
    inflightRefresh = refreshAgencyToken().finally(() => {
      inflightRefresh = null
    })
  }
  return inflightRefresh
}

async function refreshAgencyToken(): Promise<{ token: string; companyId: string }> {
  const db = createAdminClient()
  // Re-read: another instance may have refreshed since our first read.
  const row = await loadCredentials()
  if (freshFor(row, REFRESH_MARGIN_MS)) {
    return { token: row.access_token, companyId: row.company_id }
  }

  const { clientId, clientSecret } = credentials()
  let token: TokenResponse
  try {
    token = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      user_type: "Company",
    })
  } catch (err) {
    // Most likely another instance redeemed this refresh token first. It
    // persists the new pair right after redeeming, so give it a moment and
    // take what it stored.
    for (let i = 0; i < 4; i++) {
      const now = await loadCredentials()
      if (now.refresh_token !== row.refresh_token && freshFor(now, USABLE_MARGIN_MS)) {
        return { token: now.access_token, companyId: now.company_id }
      }
      await sleep(750)
    }
    // Inside the margin but not yet expired: the current token still works.
    if (freshFor(row, USABLE_MARGIN_MS)) {
      console.error("[highlevel-auth] refresh failed; using the current token until it expires", err)
      return { token: row.access_token, companyId: row.company_id }
    }
    throw err
  }

  // Always persist what we just redeemed: it is the live pair now.
  const { error } = await db
    .from("social_provider_credentials")
    .update({
      access_token: token.access_token,
      // The replacement. Losing this line loses the install.
      refresh_token: token.refresh_token,
      expires_at: expiryFrom(token.expires_in),
    } as never)
    .eq("provider", "highlevel")

  if (error) {
    throw new SocialPublishError(
      `refreshed but could not persist — install is at risk: ${error.message}`,
      "provider_error",
      false,
    )
  }

  return { token: token.access_token as string, companyId: row.company_id }
}

/**
 * A token scoped to one sub-account.
 *
 * The social planner endpoints are sub-account-scoped, and this is the
 * documented way to address them from an agency install. These are short-lived
 * and derived on demand rather than stored — they carry no refresh token, so
 * caching them buys little and risks serving an expired one.
 */
export async function getLocationToken(locationId: string): Promise<string> {
  const { token, companyId } = await getAgencyToken()

  const res = await fetch(`${API_BASE}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Version: "2021-07-28",
      Accept: "application/json",
    },
    body: new URLSearchParams({ companyId, locationId }).toString(),
  })

  const json = (await res.json().catch(() => null)) as TokenResponse | null
  if (!res.ok || !json?.access_token) {
    throw new SocialPublishError(
      `could not mint a sub-account token (${res.status})`,
      "provider_error",
      false,
    )
  }
  return json.access_token
}
