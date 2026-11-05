import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getSocialPublisher, SocialPublishError } from "@/lib/social"
import { isProviderInstalled } from "@/lib/social/highlevel-auth"
import { isSocialPlatform } from "@/lib/social/networks"
import { canUseMultinetwork } from "@/lib/scheduling-access"

/**
 * Begin connecting an account — Instagram, YouTube or LinkedIn.
 *
 * Body `{ platform }`, defaulting to Instagram so the old client keeps working.
 * YouTube's start path is `youtube`, not `google` (that one is Google Business
 * Profile) — verified live 2026-11-05.
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
 * POST /api/social/connect { platform? }  ->  { url }
 */
export async function POST(req: Request) {
  let platform: "instagram" | "youtube" | "linkedin" = "instagram"
  try {
    const body = (await req.json()) as { platform?: unknown }
    if (body?.platform !== undefined) {
      if (!isSocialPlatform(body.platform)) {
        return NextResponse.json({ error: "unknown platform" }, { status: 400 })
      }
      platform = body.platform
    }
  } catch {
    // No body: the pre-042 client, which only ever connected Instagram.
  }

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // YouTube / LinkedIn are Hani-only for now (lib/scheduling-access).
  if (platform !== "instagram" && !canUseMultinetwork(user.email)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 400 })
  }

  // Checked before `startConnect`, which provisions a sub-account as a side
  // effect. On a deploy where the agency install hasn't been completed yet,
  // going ahead would create a real record for her and then fail at attach.
  if (!(await isProviderInstalled())) {
    return NextResponse.json(
      {
        error: "not_installed",
        message: canUseMultinetwork(user.email)
          ? "החיבור לרשתות עדיין לא זמין. נעדכן ברגע שיהיה."
          : "החיבור לאינסטגרם עדיין לא זמין. נעדכן ברגע שיהיה.",
      },
      { status: 503 },
    )
  }

  try {
    // User-scoped client on purpose: every row this touches is the caller's
    // own, so RLS stays switched on. The service role is for the publish
    // worker, which runs without a session.
    const publisher = getSocialPublisher(supabase)
    const { url } = await publisher.startConnect(user.id, platform)
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof SocialPublishError) {
      // See the note in api/social/accounts: the error the user is told
      // nothing about is the one that has to reach the log.
      if (!err.userActionable) {
        console.error(`[api/social/connect] ${err.code}: ${err.message}`)
      }
      return NextResponse.json(
        { error: err.code, message: err.userActionable ? err.message : "משהו השתבש. ננסה שוב עוד רגע." },
        { status: err.userActionable ? 400 : 500 },
      )
    }
    console.error("[api/social/connect]", err)
    return NextResponse.json({ error: "connect_failed" }, { status: 500 })
  }
}
