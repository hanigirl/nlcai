import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { CANVA_OAUTH_COOKIE, completeConnect } from "@/lib/canva"

/**
 * Where Canva sends the popup back after "Allow".
 *
 * Answers with a tiny page, not JSON: it tells the opener (the media panel)
 * how it went and closes itself. The message is posted to OUR origin only,
 * and the panel checks the sender's origin too.
 *
 * GET /api/canva/callback?code=...&state=...
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const denied = params.get("error")

  let saved: { verifier?: string; state?: string } = {}
  try {
    saved = JSON.parse(req.cookies.get(CANVA_OAUTH_COOKIE)?.value ?? "{}")
  } catch {}

  let ok = false
  let reason = denied ? "denied" : "failed"

  if (!denied && code && state && saved.verifier && saved.state === state) {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (user) {
      try {
        await completeConnect({
          userId: user.id,
          code,
          verifier: saved.verifier,
          redirectUri: `${req.nextUrl.origin}/api/canva/callback`,
        })
        ok = true
      } catch (err) {
        console.error("[api/canva/callback]", err)
      }
    } else {
      reason = "unauthorized"
    }
  }

  const origin = JSON.stringify(req.nextUrl.origin)
  const payload = JSON.stringify({ source: "nlcai-canva", ok, reason: ok ? null : reason })
  const text = ok ? "קנבה מחוברת. אפשר לסגור את החלון." : "החיבור לקנבה לא הושלם. אפשר לסגור את החלון ולנסות שוב."

  const html = `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><title>Canva</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<p>${text}</p>
<script>
try { if (window.opener) window.opener.postMessage(${payload}, ${origin}) } catch (e) {}
setTimeout(function () { window.close() }, ${ok ? 300 : 2500})
</script></body></html>`

  const res = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  res.cookies.set(CANVA_OAUTH_COOKIE, "", { path: "/api/canva", maxAge: 0 })
  return res
}
