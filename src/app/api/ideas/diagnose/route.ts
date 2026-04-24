import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

// Diagnostic endpoint for the ideas pipeline.
// Run this in the browser when creator posts don't show up to see exactly
// what Apify returned for each platform + which creators actually matched.
//
// GET /api/ideas/diagnose
// returns JSON: { has_apify_key, creators, apify: { instagram|youtube|tiktok }, match_report }

interface CreatorRow { handle: string; platform: string; url: string }

async function callApifyRaw(actor: string, input: Record<string, unknown>, token: string) {
  const started = Date.now()
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(90_000),
      },
    )
    const elapsed_ms = Date.now() - started
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, status: res.status, elapsed_ms, error: body.slice(0, 500), items: [] as unknown[] }
    }
    const items = (await res.json()) as unknown[]
    return { ok: true, status: res.status, elapsed_ms, items }
  } catch (err) {
    return { ok: false, status: 0, elapsed_ms: Date.now() - started, error: err instanceof Error ? err.message : String(err), items: [] as unknown[] }
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let apifyToken: string | null = null
  try {
    apifyToken = await getUserApiKey(supabase, "apify_api_key")
  } catch {
    apifyToken = null
  }

  const { data: creatorsRaw } = await supabase
    .from("user_top_creators")
    .select("handle, platform, url")
    .eq("user_id", user.id)
  const creators: CreatorRow[] = (creatorsRaw ?? []) as CreatorRow[]

  const multiPlatform = creators.filter((c) => c.platform !== "linkedin")
  const handles = multiPlatform.map((c) => c.handle.replace(/^@/, "").trim())

  if (!apifyToken) {
    return NextResponse.json({
      has_apify_key: false,
      creators,
      note: "No Apify key configured — IG/YT/TT creator scraping will be skipped in the ideas pipeline. Add key in Settings > Connections > Apify.",
    })
  }

  if (handles.length === 0) {
    return NextResponse.json({
      has_apify_key: true,
      creators,
      note: "No non-LinkedIn creators to test. Add creators in Settings > Business > Creators.",
    })
  }

  // Run all 3 in parallel, same inputs the real pipeline uses.
  const [ig, yt, tt] = await Promise.all([
    callApifyRaw("apify~instagram-profile-scraper", { usernames: handles, resultsLimit: 15 }, apifyToken),
    callApifyRaw("streamers~youtube-scraper", {
      startUrls: handles.map((h) => ({ url: `https://www.youtube.com/@${h}/videos` })),
      maxResults: 15,
    }, apifyToken),
    callApifyRaw("clockworks~free-tiktok-scraper", { profiles: handles, resultsPerPage: 15 }, apifyToken),
  ])

  // Per-platform summaries
  type Raw = Record<string, unknown>
  // IG profile scraper returns profiles with nested latestPosts[]. The owner
  // handle lives at the profile level (`username`), not on each post.
  const igHandles = new Set(
    (ig.items as Raw[])
      .map((i) => String(i.username || i.ownerUsername || "").toLowerCase())
      .filter(Boolean),
  )
  const igPostCount = (ig.items as Raw[]).reduce((sum, i) => {
    const posts = (i.latestPosts as unknown[] | undefined) ?? []
    return sum + posts.length
  }, 0)
  const ytChannelNames = new Set((yt.items as Raw[]).map((i) => String(i.channelName || "").toLowerCase()).filter(Boolean))
  const ytChannelUrls = Array.from(new Set((yt.items as Raw[]).map((i) => String(i.channelUrl || i.inputUrl || "")).filter(Boolean))).slice(0, 10)
  const ytInputUrls = Array.from(new Set((yt.items as Raw[]).map((i) => String(i.inputUrl || "")).filter(Boolean))).slice(0, 10)
  const ttHandles = new Set((tt.items as Raw[]).map((i) => {
    const author = i.authorMeta as Raw | undefined
    return String(author?.name || "").toLowerCase()
  }).filter(Boolean))

  // Per-creator match report
  const matchReport = multiPlatform.map((c) => {
    const h = c.handle.replace(/^@/, "").toLowerCase().trim()
    const ytMatchedByName = Array.from(ytChannelNames).some((n) => n === h || n.replace(/\s+/g, "") === h || n.includes(h))
    const ytMatchedByUrl = ytChannelUrls.some((u) => u.toLowerCase().includes(`@${h}`))
    return {
      handle: c.handle,
      declared_platform: c.platform,
      instagram_match: igHandles.has(h),
      youtube_match_by_name: ytMatchedByName,
      youtube_match_by_url: ytMatchedByUrl,
      tiktok_match: ttHandles.has(h),
    }
  })

  const quotaExhausted: string[] = []
  if (ig.status === 402) quotaExhausted.push("instagram")
  if (yt.status === 402) quotaExhausted.push("youtube")
  if (tt.status === 402) quotaExhausted.push("tiktok")

  const summary =
    quotaExhausted.length === 3
      ? `🚫 מכסת Apify נגמרה בכל 3 הפלטפורמות (IG + YT + TT). יש לחדש ב-console.apify.com/billing.`
      : quotaExhausted.length > 0
        ? `⚠️ מכסת Apify נגמרה ב-[${quotaExhausted.join(", ")}]. הפלטפורמות האחרות עדיין עובדות.`
        : ig.items.length + yt.items.length + tt.items.length === 0
          ? `⚠️ כל 3 ה-actors החזירו 0 פוסטים — בדקו את השגיאות בכל פלטפורמה למטה.`
          : `✅ Apify מחזיר תוצאות. IG: ${ig.items.length}, YT: ${yt.items.length}, TT: ${tt.items.length}.`

  return NextResponse.json({
    summary,
    has_apify_key: true,
    quota_exhausted_on: quotaExhausted,
    creators,
    handles_queried: handles,
    apify: {
      instagram: {
        ok: ig.ok,
        status: ig.status,
        elapsed_ms: ig.elapsed_ms,
        raw_profile_count: ig.items.length,
        nested_post_count: igPostCount,
        unique_handles: Array.from(igHandles),
        error: "error" in ig ? ig.error : undefined,
      },
      youtube: {
        ok: yt.ok,
        status: yt.status,
        elapsed_ms: yt.elapsed_ms,
        raw_count: yt.items.length,
        unique_channel_names: Array.from(ytChannelNames).slice(0, 20),
        sample_channel_urls: ytChannelUrls,
        sample_input_urls: ytInputUrls,
        error: "error" in yt ? yt.error : undefined,
      },
      tiktok: {
        ok: tt.ok,
        status: tt.status,
        elapsed_ms: tt.elapsed_ms,
        raw_count: tt.items.length,
        unique_handles: Array.from(ttHandles),
        error: "error" in tt ? tt.error : undefined,
      },
    },
    match_report: matchReport,
  })
}
