import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getSocialPublisher, SocialPublishError } from "@/lib/social"

/**
 * Begin connecting an Instagram account.
 *
 * Returns a URL for the browser to open in a popup. The provider runs the
 * Instagram consent screen there and reports the result back by posting a
 * message to the opener — see `instagram-connect.tsx` for the listener.
 *
 * Verified against the live endpoint (2026-08-13): it answers 302 straight to
 * Facebook's consent dialog with no Authorization header, so a plain
 * `window.open` on this URL is the whole flow. HighLevel's own docs say to
 * "open the API in a window with appropriate headers", which is impossible in
 * a browser and misleading — the call genuinely needs no auth.
 *
 * The user never sees a HighLevel interface and never gets an account there.
 * The sub-account behind this is created for her by `ensureTenant`, and she
 * has no login to it.
 *
 * POST /api/social/connect  ->  { url }
 */
export async function POST() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // User-scoped client on purpose: every row this touches is the caller's
    // own, so RLS stays switched on. The service role is for the publish
    // worker, which runs without a session.
    const publisher = getSocialPublisher(supabase)
    const { url } = await publisher.startConnect(user.id, "instagram")
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof SocialPublishError) {
      return NextResponse.json(
        { error: err.code, message: err.userActionable ? err.message : "משהו השתבש. ננסה שוב עוד רגע." },
        { status: err.userActionable ? 400 : 500 },
      )
    }
    console.error("[api/social/connect]", err)
    return NextResponse.json({ error: "connect_failed" }, { status: 500 })
  }
}
