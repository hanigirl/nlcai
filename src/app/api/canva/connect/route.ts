import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { authorizeUrl, CANVA_OAUTH_COOKIE, isCanvaConfigured, newAuthRequest } from "@/lib/canva"

/**
 * Start connecting Canva. The media panel opens THIS URL directly in a popup
 * (same origin, so it can be opened synchronously in the click handler and
 * the popup blocker leaves it alone), and we bounce straight to Canva's
 * consent screen.
 *
 * The PKCE verifier and CSRF state ride in a short-lived httpOnly cookie —
 * never readable by page JS — and come back to /api/canva/callback.
 *
 * GET /api/canva/connect  ->  302 to canva.com
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isCanvaConfigured()) {
    return new NextResponse("החיבור לקנבה עדיין לא הוגדר.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  const { verifier, challenge, state } = newAuthRequest()
  const redirectUri = `${req.nextUrl.origin}/api/canva/callback`

  const res = NextResponse.redirect(authorizeUrl({ challenge, state, redirectUri }))
  res.cookies.set(CANVA_OAUTH_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/canva",
    maxAge: 10 * 60,
  })
  return res
}
