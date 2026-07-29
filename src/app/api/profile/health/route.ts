import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"

// Surface profile-completeness issues to the home page banner. Returns:
//   styleFileIssue / audienceFileIssue — non-null when the identity is
//     unusable for AI generation. `reason: "parse_failed"` means a file
//     exists in user_media but the structured fields are blank (so the
//     parser couldn't extract them). `reason: "missing"` means neither
//     a file nor manual entry has produced any content yet.
//   hasProducts / hasCreators — straight existence booleans for the
//     improvement-suggestion tier.
export async function GET() {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const [coreRes, audienceRes, mediaRes, productsCount, creatorsCount] = await Promise.all([
      supabase
        .from("core_identities")
        .select("who_i_am, niche, how_i_sound, raw_file_text")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("audience_identities")
        .select("daily_pains, emotional_pains, fears, daily_desires, emotional_desires, raw_file_text")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("user_media")
        .select("category")
        .eq("user_id", user.id)
        .in("category", ["style_file", "audience_file"]),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("user_top_creators")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ])

    type Core = { who_i_am?: string | null; niche?: string | null; how_i_sound?: string | null; raw_file_text?: string | null }
    type Aud = { daily_pains?: string | null; emotional_pains?: string | null; fears?: string | null; daily_desires?: string | null; emotional_desires?: string | null; raw_file_text?: string | null }
    const core = (coreRes.data ?? {}) as Core
    const audience = (audienceRes.data ?? {}) as Aud
    const mediaList = ((mediaRes.data ?? []) as { category: string }[])

    const hasStyleFile = mediaList.some((m) => m.category === "style_file")
    const hasAudienceFile = mediaList.some((m) => m.category === "audience_file")

    const styleHasContent = [core.who_i_am, core.niche, core.how_i_sound].some(
      (v) => typeof v === "string" && v.trim().length > 0,
    )
    const audienceHasContent = [
      audience.daily_pains,
      audience.emotional_pains,
      audience.fears,
      audience.daily_desires,
      audience.emotional_desires,
    ].some((v) => typeof v === "string" && v.trim().length > 0)

    const styleFileIssue = styleHasContent
      ? null
      : { reason: hasStyleFile ? "parse_failed" : "missing" }
    const audienceFileIssue = audienceHasContent
      ? null
      : { reason: hasAudienceFile ? "parse_failed" : "missing" }

    return NextResponse.json({
      enabled: true,
      styleFileIssue,
      audienceFileIssue,
      hasProducts: (productsCount.count ?? 0) > 0,
      hasCreators: (creatorsCount.count ?? 0) > 0,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[api/profile/health]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
