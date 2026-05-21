import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Server-validated onboarding completion. Sets user_metadata.onboarding_completed=true
// ONLY after confirming the critical identity fields actually have content in
// the DB. Previously this flag was set client-side at the end of step 4 with no
// gate — users who bypassed earlier steps (via the now-blocked ?step= param or
// the now-removed "אשלים בהגדרות" escape) still got marked as complete with
// blank rows. The middleware already redirects incomplete users, but this
// endpoint stops the bad flag from being written in the first place.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const [coreRes, audRes] = await Promise.all([
    supabase
      .from("core_identities")
      .select("who_i_am, niche, how_i_sound")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("audience_identities")
      .select("daily_pains, emotional_pains, fears, daily_desires, emotional_desires")
      .eq("user_id", user.id)
      .maybeSingle(),
  ])

  const hasText = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0

  const core = coreRes.data as
    | { who_i_am: string | null; niche: string | null; how_i_sound: string | null }
    | null
  const aud = audRes.data as
    | {
        daily_pains: string | null
        emotional_pains: string | null
        fears: string | null
        daily_desires: string | null
        emotional_desires: string | null
      }
    | null

  const missing: string[] = []
  if (!core || !hasText(core.who_i_am)) missing.push("who_i_am")
  if (!core || !hasText(core.niche)) missing.push("niche")
  if (!core || !hasText(core.how_i_sound)) missing.push("how_i_sound")
  if (!aud || !hasText(aud.daily_pains)) missing.push("daily_pains")
  if (!aud || !hasText(aud.emotional_pains)) missing.push("emotional_pains")
  if (!aud || !hasText(aud.fears)) missing.push("fears")
  if (!aud || !hasText(aud.daily_desires)) missing.push("daily_desires")
  if (!aud || !hasText(aud.emotional_desires)) missing.push("emotional_desires")

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "incomplete",
        message: "לא ניתן לסיים — חסרים נתונים חיוניים. השלימו את שלבי הזהות הקודמים.",
        missing,
      },
      { status: 400 }
    )
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    data: { onboarding_completed: true },
  })
  if (updateErr) {
    return NextResponse.json(
      {
        error: "flag_update_failed",
        message: `לא הצלחנו לעדכן את הסטטוס: ${updateErr.message}`,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
