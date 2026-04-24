import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"

// ── Types ──────────────────────────────────────────────
interface SerperResult { title: string; link: string; snippet: string; date?: string }
interface CreatorCandidate { handle: string; platform: string }
interface VerifiedCreator { handle: string; platform: string; followers: number; formatted: string; bio: string; profileUrl: string }
interface ContentItem { creator: string; platform: string; url: string; caption: string; hashtags: string[] }

type CreatorPlatform = "instagram" | "youtube" | "tiktok"
// A normalized post from Apify — same shape across the three platforms so the
// per-creator platform-picking logic can treat them uniformly.
interface ApifyPost {
  handle: string
  platform: CreatorPlatform
  url: string
  caption: string
  hashtags: string[]
  engagement: number // likes + comments (views deliberately excluded — cross-platform comparable)
}

// ── Helpers ────────────────────────────────────────────
class SearchQuotaExceededError extends Error {
  constructor() { super("SEARCH_QUOTA_EXCEEDED") }
}

class ApifyQuotaExceededError extends Error {
  constructor() { super("APIFY_QUOTA_EXCEEDED") }
}

async function searchWeb(query: string, num = 10): Promise<SerperResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num }),
  })
  // 402/403 from Serper = lifetime free credits exhausted (or key revoked).
  // Surface as a distinct error so the UI can show a quota-specific message.
  if (res.status === 402 || res.status === 403) {
    throw new SearchQuotaExceededError()
  }
  if (!res.ok) return []
  const data = await res.json()
  return (data.organic ?? []).map((r: Record<string, string>) => ({
    title: r.title, link: r.link, snippet: r.snippet, date: r.date,
  }))
}

// One shared caller for all three Apify actors. Uses the run-sync-get-dataset-items
// endpoint so we get parsed dataset items back in a single round-trip (no polling).
// 402 → the user's own Apify free-tier credit is exhausted; surfaced as a
// distinct error so the UI can show the Hebrew quota banner.
// The token is per-user (BYOK) — passed in by the caller after a successful
// getUserApiKey(supabase, "apify_api_key") lookup.
async function callApify<T>(actor: string, input: Record<string, unknown>, token: string): Promise<T[]> {
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
    if (res.status === 402) throw new ApifyQuotaExceededError()
    if (!res.ok) {
      console.error(`Apify ${actor} failed: ${res.status} ${await res.text().catch(() => "")}`)
      return []
    }
    return (await res.json()) as T[]
  } catch (err) {
    if (err instanceof ApifyQuotaExceededError) throw err
    console.error(`Apify ${actor} error:`, err)
    return []
  }
}

async function fetchInstagramPosts(handles: string[], token: string): Promise<ApifyPost[]> {
  if (handles.length === 0) return []
  // apify~instagram-profile-scraper returns one PROFILE per handle, with a nested
  // latestPosts[] array. We unwrap and flatten. resultsLimit controls posts-per-profile;
  // we keep top 3 per creator downstream so 5 is plenty (and keeps CU burn low).
  type RawPost = { url?: string; caption?: string; likesCount?: number; commentsCount?: number; hashtags?: string[]; ownerUsername?: string }
  type RawProfile = { username?: string; latestPosts?: RawPost[] }
  const profiles = await callApify<RawProfile>("apify~instagram-profile-scraper", {
    usernames: handles.map((h) => h.replace(/^@/, "").trim()),
    resultsLimit: 5,
  }, token)
  const out: ApifyPost[] = []
  for (const prof of profiles) {
    const owner = (prof.username || "").toLowerCase()
    if (!owner || !prof.latestPosts) continue
    for (const p of prof.latestPosts) {
      if (!p.url) continue
      out.push({
        handle: (p.ownerUsername || owner).toLowerCase(),
        platform: "instagram",
        url: p.url,
        caption: p.caption ?? "",
        hashtags: p.hashtags ?? [],
        engagement: (p.likesCount ?? 0) + (p.commentsCount ?? 0),
      })
    }
  }
  return out
}

async function fetchYoutubePosts(handles: string[], token: string): Promise<ApifyPost[]> {
  if (handles.length === 0) return []
  type Raw = {
    channelName?: string
    channelUrl?: string
    inputUrl?: string
    title?: string
    description?: string
    url?: string
    likes?: number
    commentsCount?: number
  }
  const cleanHandles = handles.map((h) => h.replace(/^@/, "").trim().toLowerCase())
  const items = await callApify<Raw>("streamers~youtube-scraper", {
    startUrls: cleanHandles.map((h) => ({ url: `https://www.youtube.com/@${h}/videos` })),
    maxResults: 5,
  }, token)
  return items
    .filter((i) => i.url)
    .map((i) => {
      // YT actor returns channelName as display name ("Dan Shur"), which rarely
      // equals the @handle. Prefer channelUrl/inputUrl which contain `/@handle`.
      // Fall back to channelName only as last resort.
      const channelUrl = (i.channelUrl || i.inputUrl || "").toLowerCase()
      const urlMatch = channelUrl.match(/\/@([\w.-]+)/)
      let matched: string | null = urlMatch ? urlMatch[1] : null

      if (!matched && i.channelName) {
        const normName = i.channelName.replace(/^@/, "").toLowerCase()
        const normNoSpace = normName.replace(/\s+/g, "")
        matched =
          cleanHandles.find((h) => h === normName || h === normNoSpace) ??
          cleanHandles.find((h) => normName.includes(h) || normNoSpace.includes(h)) ??
          null
      }
      // If still no match but we only sent 1 handle, attribute to it — it's the
      // only channel we asked for, so any returned video belongs to it.
      if (!matched && cleanHandles.length === 1) matched = cleanHandles[0]

      if (!matched) return null

      const caption = `${i.title ?? ""}${i.description ? " — " + i.description.slice(0, 400) : ""}`.trim()
      return {
        handle: matched,
        platform: "youtube" as const,
        url: i.url!,
        caption,
        hashtags: [],
        engagement: (i.likes ?? 0) + (i.commentsCount ?? 0),
      } as ApifyPost
    })
    .filter((p): p is ApifyPost => p !== null)
}

async function fetchTiktokPosts(handles: string[], token: string): Promise<ApifyPost[]> {
  if (handles.length === 0) return []
  type Raw = { authorMeta?: { name?: string }; webVideoUrl?: string; text?: string; diggCount?: number; commentCount?: number; hashtags?: Array<{ name?: string } | string> }
  const items = await callApify<Raw>("clockworks~free-tiktok-scraper", {
    profiles: handles.map((h) => h.replace(/^@/, "").trim()),
    resultsPerPage: 5,
  }, token)
  return items
    .filter((i) => i.authorMeta?.name && i.webVideoUrl)
    .map((i) => ({
      handle: i.authorMeta!.name!.toLowerCase(),
      platform: "tiktok" as const,
      url: i.webVideoUrl!,
      caption: i.text ?? "",
      hashtags: (i.hashtags ?? []).map((h) => (typeof h === "string" ? h : h.name ?? "")).filter(Boolean),
      engagement: (i.diggCount ?? 0) + (i.commentCount ?? 0),
    }))
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ""
    const html = await res.text()
    // Strip HTML tags, keep text
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 15000) // limit size
  } catch { return "" }
}

async function fetchInstagramProfile(handle: string): Promise<{ followers: number; bio: string } | null> {
  try {
    const clean = handle.replace(/^@/, "").trim()
    if (!clean) return null
    const res = await fetch(`https://www.instagram.com/${clean}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      redirect: "follow", signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const followMatch = html.match(/([\d,.KkMm]+)\s*Followers/i)
    if (!followMatch) return null
    const raw = followMatch[1].replace(/,/g, "")
    let followers = parseInt(raw, 10)
    if (/[Mm]/.test(raw)) followers = parseFloat(raw) * 1_000_000
    else if (/[Kk]/.test(raw)) followers = parseFloat(raw) * 1_000
    const bioMatch = html.match(/<meta\s+(?:property="og:description"|name="description")\s+content="([^"]*)"/)
      || html.match(/<meta\s+content="([^"]*)"\s+(?:property="og:description"|name="description")/)
    return { followers, bio: bioMatch?.[1]?.slice(0, 200) || "" }
  } catch { return null }
}

async function fetchReelCaption(url: string): Promise<{ caption: string; hashtags: string[] } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      redirect: "follow", signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const descMatch = html.match(/<meta\s+(?:property="og:description"|name="description")\s+content="([^"]*)"/)
      || html.match(/<meta\s+content="([^"]*)"\s+(?:property="og:description"|name="description")/)
    const description = descMatch?.[1] || ""
    const caption = description
      .replace(/^\d[\d,.KkMm]*\s*(likes?|Likes?),?\s*\d[\d,.KkMm]*\s*(comments?|Comments?)\s*[-–—]\s*/, "")
      .replace(/^\d[\d,.KkMm]*\s*(likes?|Likes?)\s*[-–—]\s*/, "")
      .trim()
    return { caption, hashtags: [...description.matchAll(/#(\w+)/g)].map((m) => m[1]) }
  } catch { return null }
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

async function verifyYouTube(handle: string): Promise<{ followers: number; bio: string } | null> {
  const results = await searchWeb(`site:youtube.com/@${handle}`, 1)
  if (results.length === 0) return null
  const text = `${results[0].title} ${results[0].snippet}`
  const match = text.match(/([\d,.KkMm]+)\s*subscribers/i)
  if (!match) return null
  const raw = match[1].replace(/,/g, "")
  let followers = parseInt(raw, 10)
  if (/[Mm]/.test(raw)) followers = parseFloat(raw) * 1_000_000
  else if (/[Kk]/.test(raw)) followers = parseFloat(raw) * 1_000
  return { followers, bio: results[0].snippet.slice(0, 200) }
}

const MIN_FOLLOWERS = 10_000

// ── Main ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let previousIdeas: string[] = []
    let previousUrls: string[] = []
    let existingCategories: string[] = []
    let favoritedIdeas: { text: string; source: string; category?: string }[] = []
    try {
      const body = await req.json()
      previousIdeas = body.previousIdeas ?? []
      previousUrls = body.previousUrls ?? []
      existingCategories = body.existingCategories ?? []
      favoritedIdeas = body.favoritedIdeas ?? []
    } catch { /* no body */ }
    // URL dedup: every content URL the user has been shown (creator posts + trend
    // links). Never expires — once shown, excluded forever on this device.
    const normalizeUrl = (u: string) => u.toLowerCase().replace(/\/+$/, "").trim()
    const seenUrls = new Set(previousUrls.filter(Boolean).map(normalizeUrl))

    const [{ data: coreIdentity }, { data: audienceIdentity }] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
    ])
    if (!coreIdentity) return NextResponse.json({ error: "Core identity not found." }, { status: 400 })
    if (!audienceIdentity || !audienceIdentity.daily_pains) return NextResponse.json({ error: "audience_missing" }, { status: 400 })

    let apiKey: string
    try {
      apiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "anthropic_not_connected") return NextResponse.json({ error: "anthropic_not_connected" }, { status: 400 })
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const niche = coreIdentity.niche
    const whoIAm = coreIdentity.who_i_am || ""
    const client = new Anthropic({ apiKey })

    // ══════════════════════════════════════════════
    // LOAD USER-SPECIFIED TOP CREATORS — the ONLY source of creators.
    // If the user gave us a list, we search those creators' viral content.
    // If not, we skip creators entirely and build ideas from trends only.
    // ══════════════════════════════════════════════
    const { data: userCreators } = await supabase
      .from("user_top_creators")
      .select("handle, platform, url")
      .eq("user_id", user.id)

    const verifiedCreators: VerifiedCreator[] = (userCreators ?? []).map((c) => {
      const row = c as { handle: string; platform: string; url: string }
      return {
        handle: row.handle,
        platform: row.platform,
        followers: 0, // unknown — user-curated, we trust them regardless
        formatted: "",
        bio: "",
        profileUrl: row.url,
      }
    })
    const hasCreators = verifiedCreators.length > 0
    console.log(`Ideas API: ${hasCreators ? `${verifiedCreators.length} user creators` : "no user creators — trends-only mode"}`)


    // ══════════════════════════════════════════════
    // STEP 5: Pull recent posts for each user-specified creator from ALL THREE
    // platforms (Instagram, YouTube, TikTok), score engagement, pick the one
    // the creator is strongest on right now, and use that platform's top posts
    // as the raw material for ideas. This overrides the "platform" the user
    // originally saved in user_top_creators — that was just their entry point.
    //
    // LinkedIn stays on Serper (worse Apify coverage, rare in user_top_creators).
    // ══════════════════════════════════════════════
    const contentItems: ContentItem[] = []

    if (hasCreators) {
      const topCreators = verifiedCreators.slice(0, 10)
      const multiPlatformCreators = topCreators.filter((c) => c.platform !== "linkedin")
      const linkedinCreators = topCreators.filter((c) => c.platform === "linkedin")
      // IG + TikTok handles are usually shared across platforms, so we query every
      // non-LinkedIn creator on both. YouTube handles are NOT shared (YT uses
      // channel-specific @handles), so if we query IG handles on YT we get
      // unrelated trending videos back (a known Apify fallback). Only query YT
      // for creators the user explicitly declared as "youtube".
      const apifyHandles = multiPlatformCreators.map((c) => c.handle)
      const youtubeHandles = multiPlatformCreators.filter((c) => c.platform === "youtube").map((c) => c.handle)

      // BYOK — each user brings their own Apify token. If they haven't
      // connected one yet, we skip IG/YT/TT silently: LinkedIn via Serper
      // and trend-only ideas still produce useful output, and the onboarding /
      // settings UI nudges them to connect.
      let apifyToken: string | null = null
      try {
        apifyToken = await getUserApiKey(supabase, "apify_api_key")
      } catch {
        apifyToken = null
      }

      if (apifyToken) {
        console.log(`Ideas API Step 5: apify token present — IG/TT handles: [${apifyHandles.join(", ")}] | YT handles (declared youtube only): [${youtubeHandles.join(", ") || "none"}]`)
      } else {
        console.log("Ideas API Step 5: user has no Apify token — skipping cross-platform creator search (LinkedIn + trends will still run)")
      }
      // allSettled instead of all — one actor hitting 402 (quota) must NOT kill
      // the other two. We track quota exhaustion separately and only fail the
      // whole request if ALL three hit quota and contentItems stays empty.
      const quotaExhaustedOn: CreatorPlatform[] = []
      const platformError: Partial<Record<CreatorPlatform, string>> = {}
      const safeFetch = async <T extends ApifyPost>(
        platform: CreatorPlatform,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn()
        } catch (err) {
          if (err instanceof ApifyQuotaExceededError) {
            quotaExhaustedOn.push(platform)
            console.error(`Ideas API Step 5: ${platform} hit Apify quota (402) — continuing with other platforms`)
            return []
          }
          platformError[platform] = err instanceof Error ? err.message : String(err)
          console.error(`Ideas API Step 5: ${platform} fetch failed:`, err)
          return []
        }
      }
      const [igPosts, ytPosts, ttPosts] = apifyToken
        ? await Promise.all([
            safeFetch("instagram", () => fetchInstagramPosts(apifyHandles, apifyToken!)),
            safeFetch("youtube", () => fetchYoutubePosts(youtubeHandles, apifyToken!)),
            safeFetch("tiktok", () => fetchTiktokPosts(apifyHandles, apifyToken!)),
          ])
        : [[], [], []] as [ApifyPost[], ApifyPost[], ApifyPost[]]
      if (apifyToken) {
        const uniq = (posts: ApifyPost[]) => Array.from(new Set(posts.map((p) => p.handle)))
        console.log(`Ideas API Step 5: apify returned — IG ${igPosts.length} posts [${uniq(igPosts).join(", ")}] | YT ${ytPosts.length} posts [${uniq(ytPosts).join(", ")}] | TT ${ttPosts.length} posts [${uniq(ttPosts).join(", ")}]`)
        if (quotaExhaustedOn.length > 0) {
          console.warn(`Ideas API Step 5: quota exhausted on [${quotaExhaustedOn.join(", ")}]`)
        }
      }
      // If every apify actor we actually called hit quota, surface a clear error
      // up the stack so the UI can tell the user to top up Apify. We count YT
      // only if we actually queried it (i.e. the user has declared youtube creators).
      const attemptedPlatforms = apifyToken
        ? (youtubeHandles.length > 0 ? 3 : 2)
        : 0
      if (attemptedPlatforms > 0 && quotaExhaustedOn.length === attemptedPlatforms) {
        throw new ApifyQuotaExceededError()
      }

      // Group by (handle → platform → posts[])
      const byCreator = new Map<string, Map<CreatorPlatform, ApifyPost[]>>()
      for (const p of [...igPosts, ...ytPosts, ...ttPosts]) {
        const handleKey = p.handle.toLowerCase()
        if (!byCreator.has(handleKey)) byCreator.set(handleKey, new Map())
        const platMap = byCreator.get(handleKey)!
        if (!platMap.has(p.platform)) platMap.set(p.platform, [])
        platMap.get(p.platform)!.push(p)
      }

      // For each creator: max engagement per platform → winning platform → posts sorted desc.
      // We build ONE list per creator (full depth, engagement-sorted) so we can round-robin later.
      const creatorLists: ContentItem[][] = []
      for (const c of multiPlatformCreators) {
        const handleKey = c.handle.replace(/^@/, "").toLowerCase()
        const platMap = byCreator.get(handleKey)
        if (!platMap || platMap.size === 0) {
          console.log(`Ideas API Step 5: no Apify posts for @${c.handle} on any platform — skipping`)
          continue
        }
        let winner: CreatorPlatform | null = null
        let winnerScore = -1
        for (const [platform, posts] of platMap) {
          const maxEng = posts.reduce((m, p) => Math.max(m, p.engagement), 0)
          if (maxEng > winnerScore) {
            winnerScore = maxEng
            winner = platform
          }
        }
        if (!winner) continue
        c.platform = winner // update so the prompt to Claude reflects the discovered platform
        const sorted = platMap.get(winner)!.sort((a, b) => b.engagement - a.engagement)
        creatorLists.push(sorted.map((p) => ({
          creator: c.handle,
          platform: winner!,
          url: p.url,
          caption: p.caption,
          hashtags: p.hashtags,
        })))
        console.log(`Ideas API Step 5: @${c.handle} strongest on ${winner} (${winnerScore} eng) — ${sorted.length} posts available`)
      }

      // LinkedIn still goes through Serper — narrow coverage on Apify side.
      // Collect as a separate creator list so LinkedIn creators also participate in round-robin.
      const linkedinLists = await Promise.all(
        linkedinCreators.map(async (c) => {
          const results = await searchWeb(`site:linkedin.com/posts ${c.handle}`, 3)
          return results.slice(0, 2).map((r) => ({
            creator: c.handle,
            platform: "linkedin" as const,
            url: r.link,
            caption: r.snippet,
            hashtags: [] as string[],
          }))
        })
      )
      for (const list of linkedinLists) if (list.length > 0) creatorLists.push(list)

      // Round-robin interleave across creators so the ordered list is:
      //   A#1 (viral), B#1, C#1, A#2, B#2, C#2, ...
      // Each creator's list is already engagement-sorted; creator order follows the
      // DB insertion order in user_top_creators (which is the user's own priority).
      const interleaved: ContentItem[] = []
      const maxDepth = creatorLists.reduce((m, l) => Math.max(m, l.length), 0)
      for (let d = 0; d < maxDepth; d++) {
        for (const list of creatorLists) {
          if (list[d]) interleaved.push(list[d])
        }
      }
      // URL-dedup against everything the user has ever been shown on this device.
      for (const item of interleaved) {
        if (!seenUrls.has(normalizeUrl(item.url))) contentItems.push(item)
      }
      const droppedAsSeen = interleaved.length - contentItems.length
      console.log(`Ideas API Step 5: interleaved ${interleaved.length} posts from ${creatorLists.length} creators → ${contentItems.length} fresh after URL dedup (dropped ${droppedAsSeen} as already-seen)`)
    }

    console.log(`Ideas API Step 5: ${contentItems.length} fresh content items from user creators`)

    // ══════════════════════════════════════════════
    // STEP 5b: Search for trends.
    // Pull more trend results when the user has no creators — trends are the
    // only source of ideas in that mode, so we need enough material for 9 ideas.
    // ══════════════════════════════════════════════
    if (!process.env.SERPER_API_KEY) {
      return NextResponse.json({ error: "search_not_configured" }, { status: 500 })
    }

    const trendQueries = hasCreators
      ? [
          searchWeb(`${niche} trending 2026`, 6),
          searchWeb(`${niche} new tool method 2026`, 6),
        ]
      : [
          searchWeb(`${niche} trending 2026`, 10),
          searchWeb(`${niche} new tool method 2026`, 10),
          searchWeb(`${niche} viral topic discussion 2026`, 10),
          searchWeb(`${niche} latest news breakthrough 2026`, 10),
        ]
    let trendResults: SerperResult[] = []
    try {
      const trendResultsRaw = (await Promise.all(trendQueries)).flat()
      const dedupWithinBatch = new Set<string>()
      trendResults = trendResultsRaw.filter((r) => {
        if (dedupWithinBatch.has(r.link)) return false
        dedupWithinBatch.add(r.link)
        // Also drop trend links the user has already been shown on this device.
        if (seenUrls.has(normalizeUrl(r.link))) return false
        return true
      })
    } catch (err) {
      if (err instanceof SearchQuotaExceededError) throw err
      console.error("Ideas API: trend search failed", err)
      return NextResponse.json({ error: "trend_search_failed" }, { status: 502 })
    }

    // Upfront validation — fail fast before calling Claude if we have no raw material.
    if (!hasCreators && trendResults.length === 0) {
      // If the user has no creators and all trend URLs were already seen, this is
      // the "everything's exhausted" case.
      const code = seenUrls.size > 0 ? "no_fresh_content" : "no_trends_found"
      return NextResponse.json({ error: code }, { status: 404 })
    }
    if (hasCreators && contentItems.length === 0 && trendResults.length === 0) {
      // Creator content + trends both empty. If seenUrls is non-empty, user has
      // simply exhausted everything we can currently pull — surface that specifically.
      const code = seenUrls.size > 0 ? "no_fresh_content" : "no_creator_content"
      return NextResponse.json({ error: code }, { status: 404 })
    }

    // ══════════════════════════════════════════════
    // BUILD CONTEXT
    // ══════════════════════════════════════════════
    const creatorsSection = verifiedCreators.map((c) =>
      `- @${c.handle} (${c.platform}) — ${c.formatted} עוקבים — ${c.profileUrl}${c.bio ? `\n  ${c.bio}` : ""}`
    ).join("\n")

    const contentSection = contentItems.map((c) => {
      let line = `- @${c.creator} (${c.platform}) — ${c.url}`
      if (c.caption) line += `\n  "${c.caption}"`
      if (c.hashtags.length > 0) line += `\n  ${c.hashtags.map((h) => `#${h}`).join(" ")}`
      return line
    }).join("\n\n")

    const trendsSection = trendResults.map((r) =>
      `- [${r.title}](${r.link})\n  ${r.snippet}`
    ).join("\n")

    const audienceSection = `
## קהל היעד
- כאבים יומיומיים: ${audienceIdentity.daily_pains}
- כאבים רגשיים: ${audienceIdentity.emotional_pains}
- פחדים: ${audienceIdentity.fears}
- אמונות מגבילות: ${audienceIdentity.limiting_beliefs}
- רצונות: ${audienceIdentity.daily_desires}`

    const previousSection = previousIdeas.length > 0
      ? `\n## ⚠️ רעיונות שכבר נוצרו בעבר (${previousIdeas.length} רעיונות) — חובה לא לחזור עליהם!
**אסור** להחזיר רעיון שדומה לאחד מהרעיונות למטה. גם אם זה אותו יוצר, חייב להיות תוכן שונה לחלוטין מנושא שונה לחלוטין.
${previousIdeas.map((t, i) => `${i + 1}. ${t}`).join("\n")}

**הרעיונות החדשים שתחזיר חייבים להיות חדשים לחלוטין — לא להזכיר את אותם נושאים, אותם רילסים, או אותם פוסטים.**`
      : ""

    const favoritesSection = favoritedIdeas.length > 0
      ? `\n## ⭐ רעיונות שהמשתמשת סימנה כמועדפים (${favoritedIdeas.length})
המשתמשת אהבה את הרעיונות האלה — תן עדיפות לרעיונות חדשים מאותם **יוצרים** ועל אותם **נושאים/קטגוריות**:
${favoritedIdeas.map((f, i) => `${i + 1}. [${f.category || "ללא קטגוריה"}] ${f.source} — ${f.text.slice(0, 100)}`).join("\n")}

**הנחיות:**
- העדף **אותם יוצרים** ברשימה למעלה (אם הם קיימים ביוצרים מאומתים)
- העדף **אותן קטגוריות/נושאים** שהמשתמשת אהבה
- אבל אל תחזור על אותם רעיונות — תביא רעיונות חדשים מאותם יוצרים על נושאים דומים אבל שונים`
      : ""

    // ══════════════════════════════════════════════
    // STEP 6: Stream ideas from Claude.
    // Creators always come first. Trends only fill the remainder when we don't have
    // enough fresh creator content to reach 9 ideas.
    //  - contentItems ≥ 9 → 9 creators, 0 trends
    //  - 0 < contentItems < 9 → N creators, (9-N) trends
    //  - contentItems === 0 → 9 trends (fallback)
    // ══════════════════════════════════════════════
    const creatorQuota = Math.min(9, contentItems.length)
    const trendQuota = 9 - creatorQuota
    console.log(`Ideas API Step 6: quota — ${creatorQuota} creators + ${trendQuota} trends (contentItems=${contentItems.length}, trendResults=${trendResults.length}, seenUrls=${seenUrls.size})`)
    const missionSection = hasCreators && contentItems.length > 0
      ? `## יוצרים של המשתמש (פונים רק אליהם!):
${creatorsSection}

## תוכן ויראלי שמצאנו מהיוצרים האלה (caption נקרא! הרשימה כבר ממוינת — ויראליות-ראשונה ומפוזרת בין היוצרים):
${contentSection}
${trendQuota > 0 ? `\n## טרנדים (להשלמה בלבד):\n${trendsSection}\n` : ""}
## המשימה — 9 רעיונות (${creatorQuota} מיוצרים${trendQuota > 0 ? ` + ${trendQuota} מטרנדים` : ""}):

**${creatorQuota} מיוצרים של המשתמש — עדיפות עליונה!**
- **השתמש ברעיונות לפי הסדר שהם מופיעים בסקשן "תוכן ויראלי"** — הם כבר ממוינים ויראליות-ראשונה ומפוזרים בין היוצרים. קח את ה-${creatorQuota} הראשונים שמתאימים.
- אם פוסט ספציפי פרסומי (קורס, מבצע, פרס, קידום עצמי) — דלג עליו והמשך לבא בתור.
- אסור להשתמש ביוצרים שלא ברשימה "יוצרים של המשתמש". **רק יוצרים מהרשימה הזו.**
- source = @שם_היוצר. profileUrl = לינק הפרופיל מהרשימה (תמיד!)
- **url ו-profileUrl הם שני שדות שונים!**
  - url = לינק לתוכן ספציפי (ריל/סרטון/פוסט) — **לא לפרופיל!**
  - profileUrl = לינק לפרופיל של היוצר
- **אסור להמציא** caption/URLs — רק מה שמופיע בסקשן "תוכן ויראלי".
- הנושא חייב לנגוע בכאבי/רצונות הקהל.
${trendQuota > 0 ? `\n**${trendQuota} מטרנדים (רק להשלמה — כשלא מספיק תוכן טרי מהיוצרים):**
- url = לינק מהטרנדים. profileUrl = "". source = "טרנד"
` : ""}
### פורמט ה-text:
**אל תתחיל את ה-text בשם היוצר או בפלטפורמה** — שם היוצר כבר מוצג בתחתית הסטיקי נוט. התחל ישר מהתוכן.
- עם caption: "[סיכום ה-caption: המסקנות והנקודות הספציפיות]."
- עם תגיות: "העלה תוכן בנושא [X]. תגיות: #tag1 #tag2"
- טרנד: "טרנד: [הנושא]. [סיכום מהמאמר]."`
      : `## טרנדים:
${trendsSection}

## המשימה — 9 רעיונות **רק מטרנדים**:

${hasCreators
  ? "לא הצלחנו למשוך תוכן ויראלי מהיוצרים שהמשתמש הגדיר כרגע — אז כל 9 הרעיונות חייבים להיות מבוססים על הטרנדים למעלה."
  : "המשתמש לא הגדיר יוצרים מועדפים, אז כל 9 הרעיונות חייבים להיות מבוססים על הטרנדים למעלה."}

- כל רעיון: source = "טרנד". profileUrl = "". url = הלינק מהטרנדים.
- כל רעיון על נושא שונה — אסור לחזור על אותו טרנד פעמיים.
- הנושא חייב לנגוע בכאבי/רצונות הקהל.
- תסכם ממש מה הטרנד אומר — לא רק כותרת כללית.

### פורמט:
- "טרנד: [הנושא]. [סיכום מהמאמר — נקודות ספציפיות, לא כללי]."`

    const promptContent = `אתה חוקר תוכן. קיבלת מחקר: ${hasCreators ? "רשימת יוצרים שהמשתמש בחר, עם תוכן ויראלי מהפרופילים שלהם, וטרנדים" : "טרנדים בנישה"}.

## מי אני
${whoIAm}

## הנישה שלי
${niche}

## הטון שלי
${coreIdentity.how_i_sound}
${audienceSection}
${previousSection}
${favoritesSection}

${missionSection}

**אסור:**
- להמציא caption/מעורבות/URLs${hasCreators ? "\n- לכלול יוצרים שלא ברשימה שהמשתמש סיפק" : ""}
- **תוכן פרסומי/מכירתי/קידומי** — דלג על כל תוכן שהוא: פרסומת למוצר, קידום קורס, הנחה/מבצע, "הירשם עכשיו", זכייה בפרס, שיתוף פעולה ממומן, סטודיו שמקדם את עצמו. **רק תוכן חינוכי, מקצועי, טיפים, או השראתי**
- לכלול את אותו טרנד פעמיים — כל רעיון על נושא אחר

${existingCategories.length > 0 ? `### קטגוריות קיימות:\n${existingCategories.map((c) => `- "${c}"`).join("\n")}` : "### קטגוריות:\ncategory (1-3 מילים) לכל רעיון."}

JSONL:
{"text":"...","source":"...","url":"...","profileUrl":"...","category":"..."}`

    // Build lookup maps to fix source/url/profileUrl mismatches
    // Strategy: TRUST the source name, FIX the URLs to match it
    const handleToCreator = new Map<string, VerifiedCreator>()
    for (const c of verifiedCreators) {
      handleToCreator.set(c.handle.toLowerCase(), c)
    }
    const contentUrlToCreator = new Map<string, string>()
    const creatorsWithContent = new Set<string>()
    for (const ci of contentItems) {
      contentUrlToCreator.set(ci.url.toLowerCase().replace(/\/+$/, ""), ci.creator)
      creatorsWithContent.add(ci.creator.toLowerCase())
    }

    function fixSourceUrlMatch(p: { text: string; source: string; url: string; profileUrl: string; category: string }) {
      const sourceHandle = (p.source || "").replace(/^@/, "").toLowerCase().trim()
      let correctedProfileUrl = p.profileUrl || ""
      let correctedUrl = p.url || ""

      // Source is "טרנד" — no creator to match, skip
      if (p.source === "טרנד" || p.source.toLowerCase() === "trend") {
        return p
      }

      const knownCreator = handleToCreator.get(sourceHandle)

      // 1. Always set profileUrl from our verified data based on source handle
      if (knownCreator) {
        if (correctedProfileUrl.toLowerCase().replace(/\/+$/, "") !== knownCreator.profileUrl.toLowerCase().replace(/\/+$/, "")) {
          console.log(`Ideas API: Fixed profileUrl for "${p.source}" — was "${correctedProfileUrl}" → "${knownCreator.profileUrl}"`)
          correctedProfileUrl = knownCreator.profileUrl
        }
      }

      // 2. If url points to content from a DIFFERENT creator, clear it (don't link wrong content)
      if (correctedUrl) {
        const normUrl = correctedUrl.toLowerCase().replace(/\/+$/, "")
        const contentCreator = contentUrlToCreator.get(normUrl)
        if (contentCreator && contentCreator.toLowerCase() !== sourceHandle) {
          console.log(`Ideas API: Cleared mismatched content url for "${p.source}" — url belonged to "${contentCreator}"`)
          correctedUrl = ""
        }
      }

      return { ...p, profileUrl: correctedProfileUrl, url: correctedUrl }
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let buffer = ""
        let fullText = ""
        const sentTexts = new Set<string>()

        const runStream = async (model: string) => {
          const sr = client.messages.stream({
            model,
            max_tokens: 4096,
            temperature: 1.0,
            messages: [{ role: "user", content: promptContent }],
          })
          for await (const event of sr) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              buffer += event.delta.text
              fullText += event.delta.text

              // Process complete lines (JSONL — each object on its own line)
              const lines = buffer.split("\n")
              buffer = lines.pop() || "" // keep incomplete last line

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith("{")) continue
                try {
                  const p = JSON.parse(trimmed)
                  if (p.text && p.source) {
                    const key = p.text.trim()
                    if (sentTexts.has(key)) {
                      console.log(`Ideas API: SKIPPED duplicate`)
                      continue
                    }
                    // Drop hallucinated creator ideas — if Claude assigned the
                    // idea to a creator we never actually pulled content for,
                    // the text/URL are fabricated. Better to show fewer, real
                    // ideas than fake ones with mismatched links.
                    const srcHandle = p.source.replace(/^@/, "").toLowerCase().trim()
                    const isTrendSource = p.source === "טרנד" || srcHandle === "trend"
                    if (!isTrendSource && !creatorsWithContent.has(srcHandle)) {
                      console.log(`Ideas API: SKIPPED hallucinated idea for "${p.source}" — no content items for this creator`)
                      continue
                    }
                    sentTexts.add(key)
                    // Strip leading "@handle (platform) —" / "@handle (platform)" prefix
                    // if Claude slipped one in — the sticky-note footer already shows
                    // the creator, so it's redundant on the body text.
                    p.text = p.text
                      .replace(/^@?[\w.-]+\s*\((instagram|tiktok|youtube|linkedin)\)\s*[—–-]\s*/i, "")
                      .replace(/^@?[\w.-]+\s*\((instagram|tiktok|youtube|linkedin)\)\s+/i, "")
                      .trim()
                    // Fix source/url/profileUrl mismatches before sending
                    const fixed = fixSourceUrlMatch(p)
                    console.log(`Ideas API: SENT idea ${sentTexts.size}: ${key.slice(0, 40)}`)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      text: fixed.text, source: fixed.source, url: fixed.url || "", profileUrl: fixed.profileUrl || "",
                      category: fixed.category || "", createdAt: new Date().toISOString(),
                    })}\n\n`))
                  }
                } catch { /* incomplete JSON, skip */ }
              }
            }
          }
        }

        const emitNoNewIdeasIfEmpty = () => {
          // Claude finished cleanly but every returned idea was either malformed
          // or a duplicate of previousIdeas — the user would otherwise see a
          // "finished generating" with nothing new. Tell them explicitly.
          if (sentTexts.size === 0) {
            const code = fullText.trim().length === 0 ? "no_ideas_generated" : "all_ideas_duplicate"
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: code })}\n\n`))
          }
        }

        try {
          await runStream(PRIMARY_MODEL)
          console.log(`Ideas API: Stream complete. Total sent: ${sentTexts.size}. Full response length: ${fullText.length}`)
          emitNoNewIdeasIfEmpty()
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        } catch (err) {
          if (isOverloadError(err) && sentTexts.size === 0) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model_fallback: true })}\n\n`))
              await runStream(FALLBACK_MODEL)
              emitNoNewIdeasIfEmpty()
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              controller.close()
              return
            } catch (err2) {
              const msg = err2 instanceof Error ? err2.message : String(err2)
              const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
              const isOverloaded = /overloaded|529|503/.test(msg)
              const errCode = isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : msg
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errCode })}\n\n`))
              controller.close()
              return
            }
          }
          const msg = err instanceof Error ? err.message : String(err)
          const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
          const isOverloaded = /overloaded|529|503/.test(msg)
          const errCode = isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : msg
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errCode })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    })
  } catch (error) {
    if (error instanceof ApifyQuotaExceededError) {
      console.error("Ideas generation error: Apify cross-platform quota exhausted")
      return NextResponse.json({ error: "apify_quota_exceeded" }, { status: 402 })
    }
    if (error instanceof SearchQuotaExceededError) {
      console.error("Ideas generation error: Serper search quota exhausted")
      return NextResponse.json({ error: "search_quota_exceeded" }, { status: 402 })
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Ideas generation error:", msg)
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
    const isOverloaded = /overloaded|529|503/.test(msg)
    const errCode = isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : msg
    return NextResponse.json({ error: errCode }, { status: isCredits ? 402 : isOverloaded ? 503 : 500 })
  }
}
