import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { DEMO_EMAILS, EMBED_MARKER, EMBED_MARKER_MAX_AGE } from "@/lib/phebe-demo"

/**
 * Lets Phebe's demo frame stay signed in as Hani (lib/phebe-demo.ts).
 *
 * A frame on another site never receives SameSite=Lax cookies, so inside
 * Phebe the app looks signed out. Opened from Phebe in a window of its own
 * (first-party, where she is signed in), this page asks her to confirm, then
 * rewrites her sign-in cookies as SameSite=None and sets a marker for 8 hours
 * so refreshes keep them that way. Hani only. ?off=1 → the button ends it.
 *
 * GET shows the confirm page (no change); the change itself is a same-origin
 * POST from that page's button.
 */

const page = (body: string) =>
  new NextResponse(
    `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>חיבור למצגת של פיבי</title>
<body style="font:16px/1.5 Rubik,system-ui,sans-serif;background:#f7f7f7;color:#111;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px;max-width:360px;text-align:center">${body}</main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )

async function who() {
  const supabase = await createClient()
  return getAuthUser(supabase)
}

export async function GET(request: NextRequest) {
  const user = await who()
  if (!user) return page(`<p>צריך להתחבר לאפליקציה בחלון הזה קודם.</p><p><a href="/login">להתחברות</a></p>`)
  if (!user.email || !DEMO_EMAILS.includes(user.email.toLowerCase())) {
    return page(`<p>החיבור למצגת פתוח רק לחשבון של חני.</p>`)
  }
  const off = request.nextUrl.searchParams.get("off") === "1"
  return page(
    off
      ? `<h1 style="font-size:18px">לסיים את החיבור למצגת?</h1>
<form method="post"><input type="hidden" name="off" value="1"><button style="font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#111;color:#fff;cursor:pointer">לסיים</button></form>`
      : `<h1 style="font-size:18px">לחבר את החשבון למצגת של פיבי?</h1>
<p style="color:#555">ככה האפליקציה תופיע מחוברת בתוך פיבי, ל-8 שעות. במצגת עצמה שום דבר לא נשמר.</p>
<form method="post"><button style="font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#111;color:#fff;cursor:pointer">לחבר</button></form>`,
  )
}

export async function POST(request: NextRequest) {
  // Only this page's own button.
  const origin = request.headers.get("origin")
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "cross_site" }, { status: 403 })
  }
  const user = await who()
  if (!user?.email || !DEMO_EMAILS.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 })
  }
  const form = await request.formData().catch(() => null)
  const off = form?.get("off") === "1"

  const res = page(
    off
      ? `<p>החיבור למצגת הסתיים.</p>`
      : `<p>מחובר. אפשר לחזור לפיבי.</p>
<script>try{window.opener&&window.opener.postMessage({type:"nlcai-demo-embed",ready:true},"*")}catch(e){};setTimeout(function(){window.close()},1200)</script>`,
  )
  const secure = request.nextUrl.protocol === "https:"
  // Her sign-in cookies, rewritten with the same value: None while the demo
  // lasts, back to Lax on "off". 400 days, as @supabase/ssr writes them.
  for (const c of request.cookies.getAll()) {
    if (!c.name.startsWith("sb-")) continue
    res.cookies.set(c.name, c.value, {
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
      sameSite: off ? "lax" : "none",
      secure: off ? secure : true,
      httpOnly: false,
    })
  }
  if (off) res.cookies.delete(EMBED_MARKER)
  else {
    res.cookies.set(EMBED_MARKER, "1", {
      path: "/",
      maxAge: EMBED_MARKER_MAX_AGE,
      sameSite: "none",
      secure: true,
      httpOnly: false,
    })
  }
  return res
}
