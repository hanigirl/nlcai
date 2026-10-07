import { createHash, randomBytes } from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractCanvaDesignId } from "@/lib/canva-url"

/**
 * Canva Connect — turn a pasted Canva link into the design's pixels.
 *
 * Canva answers 403 to any server-side fetch of its pages, so the link itself
 * is useless to us. What works is the Connect API acting as the user: she
 * approves nlcai once (OAuth + PKCE, in a popup), and from then on any design
 * she can open in Canva can be exported as a PNG.
 *
 * Server-only: holds the client secret and the user's tokens.
 */

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize"
const API = "https://api.canva.com/rest/v1"

// design:content:read is the scope the export endpoint requires.
const SCOPES = "design:content:read design:meta:read"

/** Holds the PKCE verifier + state between /connect and /callback. */
export const CANVA_OAUTH_COOKIE = "nlcai_canva_oauth"

/** Refresh this long before Canva says the token expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export class CanvaError extends Error {
  constructor(
    /** Machine code the media panel maps to a message. */
    public code:
      | "not_configured"
      | "not_connected"
      | "invalid_canva_link"
      | "canva_no_access"
      | "export_failed"
      | "export_timeout",
    message?: string,
  ) {
    super(message ?? code)
  }
}

// ---------- links ----------

/**
 * Resolve a pasted link to a design id. Short `canva.link/…` share links
 * redirect to the full design URL — and unlike canva.com itself, the
 * shortener answers server-side requests (verified 2026-10-07: 302).
 */
export async function resolveCanvaDesignId(url: string): Promise<string | null> {
  const direct = extractCanvaDesignId(url)
  if (direct) return direct
  if (!/canva\.link\//i.test(url)) return null
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) })
    const location = res.headers.get("location")
    return location ? extractCanvaDesignId(location) : null
  } catch {
    return null
  }
}

// ---------- OAuth ----------

function credentials() {
  const id = process.env.CANVA_CLIENT_ID
  const secret = process.env.CANVA_CLIENT_SECRET
  if (!id || !secret) throw new CanvaError("not_configured")
  return { id, secret }
}

export function isCanvaConfigured(): boolean {
  return !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET
}

/** PKCE pair + CSRF state for one authorize round trip. */
export function newAuthRequest() {
  const verifier = randomBytes(48).toString("base64url") // 64 chars
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const state = randomBytes(24).toString("base64url")
  return { verifier, challenge, state }
}

export function authorizeUrl(opts: { challenge: string; state: string; redirectUri: string }) {
  const { id } = credentials()
  const params = new URLSearchParams({
    code_challenge: opts.challenge,
    code_challenge_method: "s256",
    scope: SCOPES,
    response_type: "code",
    client_id: id,
    state: opts.state,
    redirect_uri: opts.redirectUri,
  })
  return `${AUTHORIZE_URL}?${params}`
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number }

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = credentials()
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    console.error("[canva] token request failed", res.status, json?.error ?? json)
    // An invalid_grant on refresh means the connection is gone (revoked, or a
    // rotated token was lost). The user reconnects; nothing else recovers it.
    throw new CanvaError("not_connected")
  }
  return json as TokenResponse
}

async function saveTokens(userId: string, t: TokenResponse) {
  const admin = createAdminClient()
  const { error } = await admin.from("canva_connections").upsert({
    user_id: userId,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  } as never)
  if (error) throw new Error(`canva_save_tokens: ${error.message}`)
}

/** Callback half of the popup: trade the code for tokens and store them. */
export async function completeConnect(opts: {
  userId: string
  code: string
  verifier: string
  redirectUri: string
}) {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.verifier,
    redirect_uri: opts.redirectUri,
  })
  await saveTokens(opts.userId, t)
}

export async function isCanvaConnected(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("canva_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle()
  return !!data
}

/** A live access token for this user, refreshing (and persisting) if needed. */
async function accessTokenFor(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("canva_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle<{ access_token: string; refresh_token: string; expires_at: string }>()
  if (!data) throw new CanvaError("not_connected")

  if (new Date(data.expires_at).getTime() - REFRESH_MARGIN_MS > Date.now()) {
    return data.access_token
  }

  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: data.refresh_token })
    await saveTokens(userId, t)
    return t.access_token
  } catch (err) {
    // The stored pair is dead — drop it so the panel offers to reconnect
    // instead of failing the same way on every paste.
    if (err instanceof CanvaError && err.code === "not_connected") {
      await admin.from("canva_connections").delete().eq("user_id", userId)
    }
    throw err
  }
}

// ---------- export ----------

/**
 * Export page 1 of a design as PNG and return its bytes.
 *
 * Canva exports are async jobs: create, then poll. The download URL it hands
 * back expires after 24h, which is why the caller copies the bytes into our
 * own storage instead of keeping the URL.
 */
export async function exportDesignPng(userId: string, designId: string): Promise<ArrayBuffer> {
  const token = await accessTokenFor(userId)
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const createRes = await fetch(`${API}/exports`, {
    method: "POST",
    headers,
    body: JSON.stringify({ design_id: designId, format: { type: "png", pages: [1] } }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (createRes.status === 401) throw new CanvaError("not_connected")
  if (createRes.status === 403 || createRes.status === 404) throw new CanvaError("canva_no_access")
  if (!createRes.ok || !created?.job?.id) {
    console.error("[canva] export create failed", createRes.status, created)
    throw new CanvaError("export_failed")
  }

  let job = created.job as { id: string; status: string; urls?: string[]; error?: { code?: string } }
  const deadline = Date.now() + 40_000
  while (job.status === "in_progress") {
    if (Date.now() > deadline) throw new CanvaError("export_timeout")
    await new Promise((r) => setTimeout(r, 1000))
    const res = await fetch(`${API}/exports/${job.id}`, { headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.job) {
      console.error("[canva] export poll failed", res.status, json)
      throw new CanvaError("export_failed")
    }
    job = json.job
  }

  if (job.status !== "success" || !job.urls?.[0]) {
    console.error("[canva] export job failed", job.error)
    throw new CanvaError("export_failed", job.error?.code)
  }

  const file = await fetch(job.urls[0])
  if (!file.ok) throw new CanvaError("export_failed")
  return file.arrayBuffer()
}
