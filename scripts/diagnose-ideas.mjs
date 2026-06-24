// One-shot diagnostic for the IDEAS pipeline — mirrors /api/ideas/diagnose
// but runs server-side with the service-role key, so no browser login needed.
// Read-only. Usage: node scripts/diagnose-ideas.mjs <email>
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
const email = process.argv[2]
if (!email) {
  console.error("Usage: node scripts/diagnose-ideas.mjs <email>")
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listErr) { console.error("listUsers failed:", listErr.message); process.exit(1) }
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) { console.log(JSON.stringify({ found: false, email }, null, 2)); process.exit(0) }

const [{ data: userRow }, { data: creatorsRaw }] = await Promise.all([
  admin.from("users").select("apify_api_key").eq("id", user.id).maybeSingle(),
  admin.from("user_top_creators").select("handle, platform, url").eq("user_id", user.id),
])

const apifyToken = userRow?.apify_api_key || null
const creators = creatorsRaw ?? []
const multiPlatform = creators.filter((c) => c.platform !== "linkedin")
const handles = multiPlatform.map((c) => c.handle.replace(/^@/, "").trim())

if (!apifyToken) {
  console.log(JSON.stringify({ has_apify_key: false, creators,
    note: "No Apify key configured — IG/YT/TT scraping is skipped in the ideas pipeline." }, null, 2))
  process.exit(0)
}
if (handles.length === 0) {
  console.log(JSON.stringify({ has_apify_key: true, creators,
    note: "No non-LinkedIn creators to test." }, null, 2))
  process.exit(0)
}

async function callApifyRaw(actor, input, token) {
  const started = Date.now()
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.timeout(90_000) },
    )
    const elapsed_ms = Date.now() - started
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, status: res.status, elapsed_ms, error: body.slice(0, 500), items: [] }
    }
    return { ok: true, status: res.status, elapsed_ms, items: await res.json() }
  } catch (err) {
    return { ok: false, status: 0, elapsed_ms: Date.now() - started, error: String(err?.message || err), items: [] }
  }
}

const [ig, yt, tt] = await Promise.all([
  callApifyRaw("apify~instagram-profile-scraper", { usernames: handles, resultsLimit: 15 }, apifyToken),
  callApifyRaw("streamers~youtube-scraper", {
    startUrls: handles.map((h) => ({ url: `https://www.youtube.com/@${h}/videos` })), maxResults: 15,
  }, apifyToken),
  callApifyRaw("clockworks~free-tiktok-scraper", { profiles: handles, resultsPerPage: 15 }, apifyToken),
])

const igHandles = new Set(ig.items.map((i) => String(i.username || i.ownerUsername || "").toLowerCase()).filter(Boolean))
const igPostCount = ig.items.reduce((s, i) => s + ((i.latestPosts || []).length), 0)
const ytChannelNames = new Set(yt.items.map((i) => String(i.channelName || "").toLowerCase()).filter(Boolean))
const ytChannelUrls = [...new Set(yt.items.map((i) => String(i.channelUrl || i.inputUrl || "")).filter(Boolean))].slice(0, 10)
const ttHandles = new Set(tt.items.map((i) => String(i.authorMeta?.name || "").toLowerCase()).filter(Boolean))

const matchReport = multiPlatform.map((c) => {
  const h = c.handle.replace(/^@/, "").toLowerCase().trim()
  return {
    handle: c.handle,
    declared_platform: c.platform,
    instagram_match: igHandles.has(h),
    youtube_match_by_name: [...ytChannelNames].some((n) => n === h || n.replace(/\s+/g, "") === h || n.includes(h)),
    youtube_match_by_url: ytChannelUrls.some((u) => u.toLowerCase().includes(`@${h}`)),
    tiktok_match: ttHandles.has(h),
  }
})

const quotaExhausted = []
if (ig.status === 402) quotaExhausted.push("instagram")
if (yt.status === 402) quotaExhausted.push("youtube")
if (tt.status === 402) quotaExhausted.push("tiktok")

const summary =
  quotaExhausted.length === 3 ? "🚫 מכסת Apify נגמרה בכל 3 הפלטפורמות. חדשי ב-console.apify.com/billing."
  : quotaExhausted.length > 0 ? `⚠️ מכסת Apify נגמרה ב-[${quotaExhausted.join(", ")}]. האחרות עובדות.`
  : ig.items.length + yt.items.length + tt.items.length === 0 ? "⚠️ כל 3 ה-actors החזירו 0 פוסטים — ראי שגיאות למטה."
  : `✅ Apify מחזיר תוצאות. IG profiles: ${ig.items.length} (${igPostCount} posts), YT: ${yt.items.length}, TT: ${tt.items.length}.`

console.log(JSON.stringify({
  summary,
  email: user.email,
  has_apify_key: true,
  apify_token_prefix: apifyToken.slice(0, 12) + "…",
  quota_exhausted_on: quotaExhausted,
  creators_configured: creators.length,
  creators,
  handles_queried: handles,
  apify: {
    instagram: { ok: ig.ok, status: ig.status, elapsed_ms: ig.elapsed_ms, raw_profile_count: ig.items.length, nested_post_count: igPostCount, unique_handles: [...igHandles], error: ig.error },
    youtube: { ok: yt.ok, status: yt.status, elapsed_ms: yt.elapsed_ms, raw_count: yt.items.length, unique_channel_names: [...ytChannelNames].slice(0, 20), sample_channel_urls: ytChannelUrls, error: yt.error },
    tiktok: { ok: tt.ok, status: tt.status, elapsed_ms: tt.elapsed_ms, raw_count: tt.items.length, unique_handles: [...ttHandles], error: tt.error },
  },
  match_report: matchReport,
}, null, 2))
