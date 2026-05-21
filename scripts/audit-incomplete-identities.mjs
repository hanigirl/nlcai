// One-shot audit — count users whose home page would currently surface
// the profile-health "missing"/"parse_failed" banner. Read-only.
//
// The home page checks the same three fields the server's
// /api/profile/health route does: core.who_i_am, core.niche, core.how_i_sound
// (any one filled → "has content"). And for audience:
// daily_pains, emotional_pains, fears, daily_desires, emotional_desires.
//
// Outputs a per-user breakdown of who's affected and by what.
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

// Tiny inline .env.local loader so the script runs without `dotenv`.
try {
  const env = readFileSync(".env.local", "utf8")
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, key, rawVal] = m
    const val = rawVal.replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env.local — fall through to env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// All users
const allUsers = []
let page = 1
while (true) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) {
    console.error("listUsers failed:", error.message)
    process.exit(1)
  }
  allUsers.push(...data.users)
  if (data.users.length < 1000) break
  page++
}

// All core + audience rows in two queries
const [coreRes, audienceRes, mediaRes] = await Promise.all([
  admin.from("core_identities").select("user_id, who_i_am, niche, how_i_sound"),
  admin.from("audience_identities").select("user_id, daily_pains, emotional_pains, fears, daily_desires, emotional_desires"),
  admin.from("user_media").select("user_id, category").in("category", ["style_file", "audience_file"]),
])

const coreByUser = new Map((coreRes.data ?? []).map((r) => [r.user_id, r]))
const audByUser = new Map((audienceRes.data ?? []).map((r) => [r.user_id, r]))
const mediaByUser = new Map()
for (const m of mediaRes.data ?? []) {
  if (!mediaByUser.has(m.user_id)) mediaByUser.set(m.user_id, new Set())
  mediaByUser.get(m.user_id).add(m.category)
}

const hasText = (v) => typeof v === "string" && v.trim().length > 0

const affected = []
for (const u of allUsers) {
  // Skip users who never started onboarding at all — they're not "stranded",
  // they just haven't signed up yet for real.
  const core = coreByUser.get(u.id)
  if (!core) continue

  const styleHasContent = [core.who_i_am, core.niche, core.how_i_sound].some(hasText)
  const aud = audByUser.get(u.id)
  const audienceHasContent = aud && [aud.daily_pains, aud.emotional_pains, aud.fears, aud.daily_desires, aud.emotional_desires].some(hasText)

  if (styleHasContent && audienceHasContent) continue

  const media = mediaByUser.get(u.id) ?? new Set()
  affected.push({
    email: u.email,
    id: u.id,
    created: u.created_at,
    onboarding_completed: !!u.user_metadata?.onboarding_completed,
    styleIssue: styleHasContent
      ? null
      : (media.has("style_file") ? "parse_failed" : "missing"),
    audienceIssue: audienceHasContent
      ? null
      : (media.has("audience_file") ? "parse_failed" : "missing"),
    coreFields: {
      who_i_am: hasText(core.who_i_am),
      niche: hasText(core.niche),
      how_i_sound: hasText(core.how_i_sound),
    },
    audienceFields: aud
      ? {
          daily_pains: hasText(aud.daily_pains),
          emotional_pains: hasText(aud.emotional_pains),
          fears: hasText(aud.fears),
          daily_desires: hasText(aud.daily_desires),
          emotional_desires: hasText(aud.emotional_desires),
        }
      : "no_row",
  })
}

const totalUsers = allUsers.length
const totalWithCore = coreByUser.size
const affectedCount = affected.length

console.log("\n=== AUDIT SUMMARY ===")
console.log(`Total auth users:          ${totalUsers}`)
console.log(`Users with core_identities row: ${totalWithCore}`)
console.log(`Users home page would crash/banner: ${affectedCount}`)
console.log("")

if (affectedCount > 0) {
  // Categorize
  const styleMissing = affected.filter((a) => a.styleIssue === "missing").length
  const styleParseFailed = affected.filter((a) => a.styleIssue === "parse_failed").length
  const audMissing = affected.filter((a) => a.audienceIssue === "missing").length
  const audParseFailed = affected.filter((a) => a.audienceIssue === "parse_failed").length

  console.log("Issue breakdown:")
  console.log(`  style: missing (no file, no manual)   ${styleMissing}`)
  console.log(`  style: parse_failed (file but empty)  ${styleParseFailed}`)
  console.log(`  audience: missing                     ${audMissing}`)
  console.log(`  audience: parse_failed                ${audParseFailed}`)
  console.log("")
  console.log("Affected users (newest first):")
  affected
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .forEach((a) => {
      const tags = [
        a.styleIssue ? `style=${a.styleIssue}` : null,
        a.audienceIssue ? `audience=${a.audienceIssue}` : null,
        a.onboarding_completed ? "flag=true" : "flag=false",
      ].filter(Boolean)
      console.log(`  ${a.email.padEnd(40)}  ${tags.join("  ")}`)
    })
}
