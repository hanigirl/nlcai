import { NextRequest, NextResponse } from "next/server"
import { isAdminEmail } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { completeInstall } from "@/lib/social/highlevel-auth"
import { SocialPublishError } from "@/lib/social"

/**
 * Where the provider sends us back after the agency owner approves the app.
 *
 * This runs ONCE, ever — it is the product's own install, not a per-user
 * connection. Users connecting their Instagram go through /api/social/connect
 * and never touch this route. The two are deliberately separate paths so the
 * one-off admin grant can't be confused with the everyday user flow.
 *
 * The path is neutral by necessity: the provider rejects redirect URIs whose
 * path contains its own name.
 *
 * GET /api/social/provider/callback?code=...
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim()

  // The provider appends ?error=... when the approver backs out.
  const denied = req.nextUrl.searchParams.get("error")
  if (denied) {
    return NextResponse.json({ error: "install_denied", detail: denied }, { status: 400 })
  }

  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 })
  }

  // Gate on an nlcai admin session. The code alone is a bearer credential, and
  // this endpoint turns it into stored agency-wide tokens — so a stray or
  // replayed link must not be able to overwrite the install on its own. The
  // person completing the install is the one who started it, in this browser.
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "Unauthorized", message: "צריך להיות מחוברת כמנהלת כדי להשלים את ההתקנה." },
      { status: 401 },
    )
  }

  try {
    // Resolves its own service-role client: these credentials are deliberately
    // unreadable to every browser-facing role (034 enables RLS with no policies).
    const { companyId } = await completeInstall(code)

    return NextResponse.json({
      ok: true,
      companyId,
      message: "ההתקנה הושלמה. אפשר לחבר חשבונות אינסטגרם מההגדרות.",
    })
  } catch (err) {
    if (err instanceof SocialPublishError) {
      console.error("[api/social/provider/callback]", err.message)
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 })
    }
    console.error("[api/social/provider/callback]", err)
    return NextResponse.json({ error: "install_failed" }, { status: 500 })
  }
}
