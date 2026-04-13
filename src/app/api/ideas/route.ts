import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

// ── Types ──────────────────────────────────────────────
interface SerperResult { title: string; link: string; snippet: string; date?: string }
interface CreatorCandidate { handle: string; platform: string }
interface VerifiedCreator { handle: string; platform: string; followers: number; formatted: string; bio: string; profileUrl: string }
interface ContentItem { creator: string; platform: string; url: string; caption: string; hashtags: string[] }

// ── Helpers ────────────────────────────────────────────
async function searchWeb(query: string, num = 10): Promise<SerperResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num }),
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.organic ?? []).map((r: Record<string, string>) => ({
    title: r.title, link: r.link, snippet: r.snippet, date: r.date,
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
    let existingCategories: string[] = []
    let favoritedIdeas: { text: string; source: string; category?: string }[] = []
    try {
      const body = await req.json()
      previousIdeas = body.previousIdeas ?? []
      existingCategories = body.existingCategories ?? []
      favoritedIdeas = body.favoritedIdeas ?? []
    } catch { /* no body */ }

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
    // LOAD CACHE as base (always scan for new too)
    // ══════════════════════════════════════════════
    const { data: cachedCreators } = await supabase
      .from("niche_creators")
      .select("handle, platform, followers, bio, profile_url, verified_at")
      .eq("user_id", user.id)
      .eq("niche", niche)

    let verifiedCreators: VerifiedCreator[] = []
    const cachedHandles = new Set<string>()

    if (cachedCreators && cachedCreators.length > 0) {
      verifiedCreators = cachedCreators.map((c: { handle: string; platform: string; followers: number; bio: string; profile_url: string }) => ({
        handle: c.handle, platform: c.platform, followers: c.followers,
        formatted: fmtFollowers(c.followers), bio: c.bio, profileUrl: c.profile_url,
      }))
      for (const c of verifiedCreators) cachedHandles.add(c.handle.toLowerCase())
      console.log(`Ideas API: Loaded ${verifiedCreators.length} creators from cache`)
    }

    // Always scan for NEW creators (skip already cached ones)
    {

    // ══════════════════════════════════════════════
    // STEP 1: Claude suggests known handles
    // ══════════════════════════════════════════════
    const handleMsg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Who are the biggest, most well-known content creators and thought leaders in the field of "${niche}"?

I need two groups:

**Group A — International (10-12 people):**
People who are famous WORLDWIDE in ${niche}. They might be:
- Educators who teach ${niche} on YouTube/Instagram/TikTok
- Industry experts known for their knowledge and experience
- Professionals who worked at top companies (Google, Apple, Spotify, Meta, etc.)
- Authors of popular books/courses in ${niche}
- Speakers at major conferences

**Group B — Israel (3-5 people):**
The top ${niche} creators/educators in Israel, posting in Hebrew or English.

IMPORTANT: For each creator, list them on the platform where they have the MOST followers. Many big creators are huge on YouTube but small on Instagram — list them on YouTube in that case!
If you know they're big on multiple platforms, list them on EACH platform separately.

Return ONLY a JSON array with their exact social media handles:
[{"handle": "exact_username", "platform": "instagram"}, {"handle": "exact_username", "platform": "youtube"}, ...]

Platforms: "instagram", "youtube", "tiktok", "linkedin"
Use exact handles WITHOUT @.`
      }],
    })
    const handleText = handleMsg.content.find((b) => b.type === "text")?.text || "[]"
    const handleCleaned = handleText.replace(/```json\s*/g, "").replace(/```\s*/g, "")
    const handleMatch = handleCleaned.match(/\[[\s\S]*\]/)
    const claudeHandles: CreatorCandidate[] = handleMatch ? JSON.parse(handleMatch[0]) : []

    console.log(`Ideas API Step 1: Claude suggested ${claudeHandles.length} handles`)

    // ══════════════════════════════════════════════
    // STEP 2: Serper finds "top creators" articles — 8 targeted searches
    // ══════════════════════════════════════════════
    const articleSearches = await Promise.all([
      // International
      searchWeb(`who are the most famous ${niche} experts educators worldwide`, 5),
      searchWeb(`top ${niche} influencers instagram to follow 2026`, 5),
      searchWeb(`best ${niche} youtube educators channels 2026`, 5),
      searchWeb(`${niche} thought leaders linkedin most followed`, 5),
      searchWeb(`${niche} tiktok creators educators popular 2026`, 5),
      searchWeb(`most influential ${niche} professionals worked at Google Apple Spotify`, 5),
      searchWeb(`top 10 ${niche} influencers most followers instagram`, 5),
      searchWeb(`${niche} creators with most followers engagement 2026`, 5),
      // Israel
      searchWeb(`${niche} יוצרי תוכן מובילים ישראלים`, 5),
      searchWeb(`Israel ${niche} influencers instagram creators`, 5),
    ])
    const articles = articleSearches.flat()

    console.log(`Ideas API Step 2: Found ${articles.length} articles`)

    // ══════════════════════════════════════════════
    // STEP 3: Fetch full article content + extract handles
    // ══════════════════════════════════════════════
    // Prioritize articles with "top" / "best" / "must follow" in title
    const scoredArticles = articles
      .filter((a) => !a.link.includes("instagram.com") && !a.link.includes("youtube.com") && !a.link.includes("tiktok.com"))
      .map((a) => {
        let score = 0
        const t = a.title.toLowerCase()
        if (/top \d|best \d|must follow|\d+ .*(influencer|creator|designer|expert)/i.test(t)) score += 3
        if (/follow|influential|famous/i.test(t)) score += 1
        return { ...a, score }
      })
      .sort((a, b) => b.score - a.score)
    const topArticles = scoredArticles.slice(0, 7)

    const articleTexts = await Promise.all(topArticles.map((a) => fetchPageText(a.link)))

    // Extract handles from articles
    const articleHandles: CreatorCandidate[] = []
    for (const text of articleTexts) {
      // @username patterns
      const atMatches = text.match(/@[\w.]{3,30}/g) || []
      for (const m of atMatches) {
        const clean = m.replace(/^@/, "")
        if (!["instagram", "tiktok", "youtube", "linkedin", "twitter", "facebook"].includes(clean.toLowerCase())) {
          articleHandles.push({ handle: clean, platform: "instagram" })
        }
      }
      // instagram.com/username patterns
      for (const m of text.matchAll(/instagram\.com\/([\w.]{3,30})/g)) {
        if (!["reel", "p", "explore", "stories", "reels"].includes(m[1])) {
          articleHandles.push({ handle: m[1], platform: "instagram" })
        }
      }
      // youtube.com/@username patterns
      for (const m of text.matchAll(/youtube\.com\/@([\w.-]{3,30})/g)) {
        articleHandles.push({ handle: m[1], platform: "youtube" })
      }
      // tiktok.com/@username patterns
      for (const m of text.matchAll(/tiktok\.com\/@([\w.]{3,30})/g)) {
        articleHandles.push({ handle: m[1], platform: "tiktok" })
      }
      // linkedin.com/in/username patterns
      for (const m of text.matchAll(/linkedin\.com\/in\/([\w-]{3,60})/g)) {
        articleHandles.push({ handle: m[1], platform: "linkedin" })
      }
    }

    // Also ask Claude to extract creator names from article text (catches names without @ or URLs)
    const combinedArticleText = articleTexts.map((t, i) => `Article ${i + 1}: ${t.slice(0, 3000)}`).join("\n\n")
    if (combinedArticleText.length > 100) {
      try {
        const extractMsg = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: `These articles list top ${niche} creators/influencers. Extract ALL creator names and their Instagram handles from the text.

${combinedArticleText.slice(0, 12000)}

Return ONLY a JSON array of Instagram handles (best guess based on names):
[{"handle": "username", "platform": "instagram"}, ...]`
          }],
        })
        const eText = extractMsg.content.find((b) => b.type === "text")?.text || "[]"
        const eCleaned = eText.replace(/```json\s*/g, "").replace(/```\s*/g, "")
        const eMatch = eCleaned.match(/\[[\s\S]*\]/)
        if (eMatch) {
          const extracted: CreatorCandidate[] = JSON.parse(eMatch[0])
          articleHandles.push(...extracted)
        }
      } catch { /* non-fatal */ }
    }

    // STEP 3b: Search Instagram directly for top profiles in the niche
    const igDirectSearches = await Promise.all([
      searchWeb(`site:instagram.com "${niche}" education tutorial followers`, 8),
      searchWeb(`site:instagram.com ${niche} design tips`, 8),
    ])
    for (const r of igDirectSearches.flat()) {
      const m = r.link.match(/instagram\.com\/([\w.]{3,30})\/?$/)
      if (m && !["reel", "p", "explore", "stories", "reels"].includes(m[1])) {
        articleHandles.push({ handle: m[1], platform: "instagram" })
      }
      // Also extract from reel URLs — the creator handle is in the title
      if (r.link.includes("/reel/") || r.link.includes("/p/")) {
        const titleMatch = r.title.match(/^(.+?)\s*[\|@(]/)
        if (titleMatch) {
          const possibleHandle = r.link.match(/instagram\.com\/([\w.]+)\/(?:reel|p)/)
          if (possibleHandle) articleHandles.push({ handle: possibleHandle[1], platform: "instagram" })
        }
      }
    }

    // Merge Claude + article + IG direct handles, dedupe
    const seen = new Set<string>()
    const allCandidates: CreatorCandidate[] = []
    for (const c of [...claudeHandles, ...articleHandles]) {
      const key = `${c.handle.toLowerCase()}:${c.platform}`
      if (!seen.has(key)) {
        seen.add(key)
        allCandidates.push(c)
      }
    }

    console.log(`Ideas API Step 3: ${allCandidates.length} unique candidates (${claudeHandles.length} Claude + ${articleHandles.length} articles)`)

    // ══════════════════════════════════════════════
    // STEP 4: Verify follower counts
    // ══════════════════════════════════════════════

    const checks = await Promise.all(
      allCandidates
        .filter((c) => !cachedHandles.has(c.handle.toLowerCase())) // skip already cached
        .slice(0, 25).map(async (c) => {
        if (c.platform === "instagram") {
          const data = await fetchInstagramProfile(c.handle)
          if (data && data.followers >= MIN_FOLLOWERS) {
            return { handle: c.handle, platform: "instagram", followers: data.followers, formatted: fmtFollowers(data.followers), bio: data.bio, profileUrl: `https://instagram.com/${c.handle}/` }
          }
        } else if (c.platform === "youtube") {
          const data = await verifyYouTube(c.handle)
          if (data && data.followers >= MIN_FOLLOWERS) {
            return { handle: c.handle, platform: "youtube", followers: data.followers, formatted: fmtFollowers(data.followers), bio: data.bio, profileUrl: `https://youtube.com/@${c.handle}` }
          }
        } else if (c.platform === "tiktok") {
          // Can't scrape TikTok directly, use Serper snippet
          const results = await searchWeb(`site:tiktok.com/@${c.handle}`, 1)
          if (results.length > 0) {
            const text = `${results[0].title} ${results[0].snippet}`
            const match = text.match(/([\d,.KkMm]+)\s*(followers|Followers)/i)
            let followers = 0
            if (match) {
              const raw = match[1].replace(/,/g, "")
              followers = parseInt(raw, 10)
              if (/[Mm]/.test(raw)) followers = parseFloat(raw) * 1_000_000
              else if (/[Kk]/.test(raw)) followers = parseFloat(raw) * 1_000
            }
            if (followers >= MIN_FOLLOWERS) {
              return { handle: c.handle, platform: "tiktok", followers, formatted: fmtFollowers(followers), bio: results[0].snippet.slice(0, 200), profileUrl: `https://tiktok.com/@${c.handle}` }
            }
          }
        } else if (c.platform === "linkedin") {
          const results = await searchWeb(`site:linkedin.com/in/${c.handle}`, 1)
          if (results.length > 0) {
            const text = `${results[0].title} ${results[0].snippet}`
            const match = text.match(/([\d,.KkMm]+)\s*(followers|Followers)/i)
            let followers = 0
            if (match) {
              const raw = match[1].replace(/,/g, "")
              followers = parseInt(raw, 10)
              if (/[Mm]/.test(raw)) followers = parseFloat(raw) * 1_000_000
              else if (/[Kk]/.test(raw)) followers = parseFloat(raw) * 1_000
            }
            if (followers >= MIN_FOLLOWERS) {
              return { handle: c.handle, platform: "linkedin", followers, formatted: fmtFollowers(followers), bio: results[0].snippet.slice(0, 200), profileUrl: `https://linkedin.com/in/${c.handle}` }
            }
          }
        }
        return null
      })
    )

    const passedChecks = checks.filter((c): c is VerifiedCreator => c !== null)

    // ══════════════════════════════════════════════
    // STEP 4b: Filter by niche relevance (bio check)
    // ══════════════════════════════════════════════
    if (passedChecks.length > 0) {
      try {
        const relevanceMsg = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: `I have a list of social media creators. I need to know which ones are actually relevant to the niche "${niche}".

For each creator, I'll give you their handle, platform, and bio. Return ONLY the handles that are clearly related to ${niche} based on their bio/description.

Creators:
${passedChecks.map((c) => `- @${c.handle} (${c.platform}): "${c.bio}"`).join("\n")}

Return a JSON array of handles that ARE relevant to "${niche}":
["handle1", "handle2", ...]

Be strict: if the bio doesn't mention anything related to ${niche}, exclude them. Names/handles alone are not enough — the bio must show they actually work in or create content about ${niche}.`
          }],
        })
        const relText = relevanceMsg.content.find((b) => b.type === "text")?.text || "[]"
        const relCleaned = relText.replace(/```json\s*/g, "").replace(/```\s*/g, "")
        const relMatch = relCleaned.match(/\[[\s\S]*\]/)
        if (relMatch) {
          const relevantHandles = new Set<string>(
            (JSON.parse(relMatch[0]) as string[]).map((h: string) => h.toLowerCase().replace(/^@/, ""))
          )
          const beforeCount = passedChecks.length
          const relevant = passedChecks.filter((c) => relevantHandles.has(c.handle.toLowerCase()))
          console.log(`Ideas API Step 4b: Niche filter kept ${relevant.length}/${beforeCount} creators`)
          for (const c of relevant) verifiedCreators.push(c)
        } else {
          // Fallback: keep all if parsing fails
          for (const c of passedChecks) verifiedCreators.push(c)
        }
      } catch {
        // Fallback: keep all if relevance check fails
        for (const c of passedChecks) verifiedCreators.push(c)
      }
    }

    // Count new creators found this time
    const newCreators = verifiedCreators.filter((c) => !cachedHandles.has(c.handle.toLowerCase()))
    console.log(`Ideas API Step 4: ${verifiedCreators.length} total creators (${newCreators.length} new, ${cachedHandles.size} from cache)`)

    // Save new creators to cache (append, don't replace)
    if (newCreators.length > 0) {
      await supabase.from("niche_creators").upsert(
        newCreators.map((c) => ({
          user_id: user.id,
          niche,
          handle: c.handle,
          platform: c.platform,
          followers: c.followers,
          bio: c.bio,
          profile_url: c.profileUrl,
        })),
        { onConflict: "user_id,handle,platform" }
      )
      console.log(`Ideas API: Added ${newCreators.length} new creators to cache`)
    }

    } // end of scan block

    // ══════════════════════════════════════════════
    // STEP 5: Find content from verified creators
    // ══════════════════════════════════════════════
    const contentItems: ContentItem[] = []

    const contentSearches = await Promise.all(
      verifiedCreators.slice(0, 10).map(async (c) => {
        if (c.platform === "instagram") {
          const results = await searchWeb(`site:instagram.com/reel ${c.handle}`, 4)
          const reels = results.filter((r) => r.link.includes("/reel/") || r.link.includes("/p/"))
          for (const r of reels.slice(0, 3)) {
            const meta = await fetchReelCaption(r.link)
            if (meta) contentItems.push({ creator: c.handle, platform: "instagram", url: r.link, caption: meta.caption, hashtags: meta.hashtags })
          }
        } else if (c.platform === "youtube") {
          const results = await searchWeb(`site:youtube.com ${c.handle} ${niche}`, 3)
          const videos = results.filter((r) => r.link.includes("watch?v=") || r.link.includes("youtu.be"))
          for (const r of videos.slice(0, 2)) {
            contentItems.push({ creator: c.handle, platform: "youtube", url: r.link, caption: r.snippet, hashtags: [] })
          }
        } else if (c.platform === "tiktok") {
          const results = await searchWeb(`site:tiktok.com/@${c.handle} video`, 3)
          for (const r of results.slice(0, 2)) {
            contentItems.push({ creator: c.handle, platform: "tiktok", url: r.link, caption: r.snippet, hashtags: [] })
          }
        } else if (c.platform === "linkedin") {
          const results = await searchWeb(`site:linkedin.com/posts ${c.handle}`, 2)
          for (const r of results.slice(0, 2)) {
            contentItems.push({ creator: c.handle, platform: "linkedin", url: r.link, caption: r.snippet, hashtags: [] })
          }
        }
      })
    )

    console.log(`Ideas API Step 5: ${contentItems.length} content items from verified creators`)

    // ══════════════════════════════════════════════
    // STEP 5b: Search for trends
    // ══════════════════════════════════════════════
    const trendResultsRaw = (await Promise.all([
      searchWeb(`${niche} trending 2026`, 6),
      searchWeb(`${niche} new tool method 2026`, 6),
    ])).flat()
    // Dedupe trends by URL
    const seenUrls = new Set<string>()
    const trendResults = trendResultsRaw.filter((r) => {
      if (seenUrls.has(r.link)) return false
      seenUrls.add(r.link)
      return true
    })

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
    // STEP 6: Stream ideas from Claude
    // ══════════════════════════════════════════════
    const promptContent = `אתה חוקר תוכן. קיבלת מחקר מאומת: יוצרים עם עוקבים שנבדקו, תוכן אמיתי עם caption, וטרנדים.

## מי אני
${whoIAm}

## הנישה שלי
${niche}

## הטון שלי
${coreIdentity.how_i_sound}
${audienceSection}
${previousSection}
${favoritesSection}

## יוצרים מאומתים (${verifiedCreators.length} יוצרים, עוקבים נבדקו!):
${creatorsSection || "לא נמצאו"}

${contentSection ? `## תוכן אמיתי (caption נקרא!):\n${contentSection}` : ""}

## טרנדים:
${trendsSection}

## המשימה — 9 רעיונות:

**7 מיוצרים מאומתים:**
- **העדף תמיד רעיונות שיש להם תוכן ספציפי (caption/תגיות) מהסקשן "תוכן אמיתי" למעלה.** אל תציג רק "יוצר מוביל, מתמחה ב..." אם יש לו ריל אמיתי עם caption!
- השתמש **רק** ביוצרים מהרשימה למעלה
- source = @שם_היוצר. profileUrl = לינק הפרופיל מהרשימה (תמיד!)
- **url ו-profileUrl הם שני שדות שונים!**
  - url = לינק לתוכן ספציפי (ריל/סרטון/פוסט) — **לא לפרופיל!**
  - profileUrl = לינק לפרופיל של היוצר — **תמיד הפרופיל**
- אם יש תוכן עם caption — **קודם בדוק שזה לא פרסומי** (קורס, מבצע, פרס, קידום עצמי). אם זה פרסומי — דלג. אם חינוכי — url = הלינק לתוכן, תסכם את ה-caption
- אם יש תוכן עם תגיות בלבד — url = הלינק לתוכן. ציין את התגיות
- אם אין תוכן ספציפי — url = "" (ריק!). ציין מה הנישה שלו לפי הביו. **אבל זה רק מוצא אחרון — תמיד העדף יוצרים שיש להם תוכן אמיתי!**
- **לעולם אל תשים לינק לפרופיל בשדה url** — שדה url מיועד רק לתוכן ספציפי
- **אסור להמציא** caption, מעורבות, או URLs
- מותר כמה רעיונות מאותו יוצר על תוכן שונה
- הנושא חייב לנגוע בכאבי/רצונות הקהל
- **גוון פלטפורמות** — לא רק אינסטגרם!

**2 מטרנדים:**
- url = לינק מהטרנדים. profileUrl = "". source = "טרנד"

### פורמט:
- עם caption: "@שם (XK עוקבים, platform) — [סיכום ה-caption: המסקנות והנקודות הספציפיות]."
- עם תגיות: "@שם (XK עוקבים, platform) העלה תוכן. תגיות: #tag1 #tag2"
- בלי תוכן: "@שם (XK עוקבים, platform) — יוצר מוביל. [מה הביו אומר]." (url ריק!)
- טרנד: "טרנד: [הנושא]. [סיכום מהמאמר]."

**אסור:**
- להמציא caption/מעורבות/URLs
- לכלול יוצרים שלא ברשימה המאומתת
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
    for (const ci of contentItems) {
      contentUrlToCreator.set(ci.url.toLowerCase().replace(/\/+$/, ""), ci.creator)
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
        try {
          const sr = client.messages.stream({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            temperature: 1.0,
            messages: [{ role: "user", content: promptContent }],
          })
          let buffer = ""
          let fullText = ""
          const sentTexts = new Set<string>()
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
                    sentTexts.add(key)
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
          console.log(`Ideas API: Stream complete. Total sent: ${sentTexts.size}. Full response length: ${fullText.length}`)
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        } catch (err) {
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
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Ideas generation error:", msg)
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
    const isOverloaded = /overloaded|529|503/.test(msg)
    const errCode = isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : msg
    return NextResponse.json({ error: errCode }, { status: isCredits ? 402 : isOverloaded ? 503 : 500 })
  }
}
