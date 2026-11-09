import type { NextRequest } from "next/server"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Cross-site request guard for /api (security audit 2026-11-09).
 *
 * The app's only CSRF defence used to be SameSite=Lax on the session cookie,
 * and the Phebe demo deliberately switches that to None. So any state-changing
 * /api request a browser sends from another site is refused here:
 * Sec-Fetch-Site "cross-site", or an Origin whose host is not this host.
 *
 * Requests with neither header (server-to-server callers like the newsletter
 * agent or the Apps Script allowlist sync) are not browsers and pass through;
 * they carry their own shared secret.
 */
export function isCrossSiteMutation(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false

  const site = request.headers.get("sec-fetch-site")
  if (site === "cross-site") return true

  const origin = request.headers.get("origin")
  if (!origin) return false
  if (origin === "null") return true
  try {
    return new URL(origin).host !== request.nextUrl.host
  } catch {
    return true
  }
}
