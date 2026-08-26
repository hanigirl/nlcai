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
 * The margin does not make the race impossible, only rare. Fully closing it
 * needs a row lock the JS client cannot express — worth revisiting if the
 * publish worker ever runs at real concurrency.
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

/**
 * A valid agency access token, refreshing first if it is close to expiring.
 *
 * The write happens before the token is returned — see the hazard note above.
 */
export async function getAgencyToken(): Promise<{ token: string; companyId: string }> {
  const db = createAdminClient()
  const row = await loadCredentials()

  const expiresAt = new Date(row.expires_at).getTime()
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return { token: row.access_token, companyId: row.company_id }
  }

  const { clientId, clientSecret } = credentials()
  const token = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    user_type: "Company",
  })

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
