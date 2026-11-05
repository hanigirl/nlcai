import { NextResponse, type NextRequest } from "next/server"

/**
 * Maintenance mode — the whole app goes dark while the database moves
 * (Supabase Tokyo → Frankfurt, 2026-11). While it's on, nothing may read or
 * write the database, so:
 *   - every page renders the /maintenance screen (HTTP 503 + Retry-After)
 *   - every /api/* route answers 503 { error: "maintenance" } without its
 *     handler ever running — including the ones outside callers hit on a
 *     schedule (the newsletter agent, the allowlist sheet sync)
 *
 * Env (set on the deployment, then redeploy — Vercel only applies env changes
 * to new deployments):
 *   MAINTENANCE_MODE=1             on ("true" works too). Unset = off, and the
 *                                  app behaves exactly as it does without this.
 *   MAINTENANCE_BYPASS_TOKEN=...   optional. Opening any URL with
 *                                  ?maintenance_bypass=<token> drops an
 *                                  httpOnly cookie and reloads the same URL
 *                                  without the param; that browser then skips
 *                                  maintenance entirely (pages AND API), so the
 *                                  owner can smoke-test the live app before
 *                                  reopening it.
 *
 * Deliberately import-free beyond next/server: this runs in middleware before
 * any Supabase client exists, and the maintenance page imports the flag from
 * here, so nothing in this file may touch the database or auth.
 */

export const MAINTENANCE_PATH = "/maintenance"
export const MAINTENANCE_BYPASS_PARAM = "maintenance_bypass"
export const MAINTENANCE_BYPASS_COOKIE = "nlc_maintenance_bypass"
const RETRY_AFTER_SECONDS = "3600"
// Long enough to cover the whole window; the cookie is only ever consulted
// while the flag is on, so a leftover one is inert once maintenance ends.
const BYPASS_COOKIE_MAX_AGE = 60 * 60 * 24

export function isMaintenanceMode(): boolean {
  const flag = process.env.MAINTENANCE_MODE?.trim().toLowerCase()
  return flag === "1" || flag === "true"
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
}

// Length-checked, constant-time comparison. Middleware runs on the edge
// runtime, where node:crypto's timingSafeEqual isn't available.
function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/**
 * The first thing middleware does. Returns the response to send when the
 * request must not go any further, or null to carry on as normal — which is
 * always the case when MAINTENANCE_MODE is off.
 */
export function maintenanceGate(request: NextRequest): NextResponse | null {
  if (!isMaintenanceMode()) return null

  const { pathname } = request.nextUrl

  // Next internals and static files are already outside the matcher; this is
  // the belt to that pair of braces, so the maintenance page can always load
  // its own CSS, fonts and logo.
  if (pathname.startsWith("/_next/")) return null

  const bypassToken = process.env.MAINTENANCE_BYPASS_TOKEN?.trim()
  if (bypassToken) {
    const offered = request.nextUrl.searchParams.get(MAINTENANCE_BYPASS_PARAM)
    if (offered !== null && tokensMatch(offered, bypassToken)) {
      const clean = request.nextUrl.clone()
      clean.searchParams.delete(MAINTENANCE_BYPASS_PARAM)
      const res = NextResponse.redirect(clean)
      res.cookies.set(MAINTENANCE_BYPASS_COOKIE, bypassToken, {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: BYPASS_COOKIE_MAX_AGE,
      })
      res.headers.set("Cache-Control", "no-store")
      return res
    }
    const cookie = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value
    if (cookie && tokensMatch(cookie, bypassToken)) return null
  }

  const headers = { "Retry-After": RETRY_AFTER_SECONDS }

  // API routes, and any non-GET page request (form posts, server actions):
  // refuse outright. No handler runs.
  if (isApiPath(pathname) || (request.method !== "GET" && request.method !== "HEAD")) {
    return NextResponse.json(
      { error: "maintenance" },
      { status: 503, headers: { ...headers, "Cache-Control": "no-store" } },
    )
  }

  // Every page — /maintenance itself included — renders the maintenance
  // screen under the URL that was asked for. Middleware runs once per request,
  // so rewriting /maintenance onto itself can't loop.
  const url = request.nextUrl.clone()
  url.pathname = MAINTENANCE_PATH
  url.search = ""
  return NextResponse.rewrite(url, { status: 503, headers })
}
