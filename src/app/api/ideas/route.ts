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

// ── Helpers ────────────────────────────────────────────
class SearchQuotaExceededError extends Error {
  constructor() { super("SEARCH_QUOTA_EXCEEDED") }
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
    // STEP 5: Find VIRAL / high-engagement content from user-specified creators.
    // Skipped entirely if the user didn't specify any creators.
    // Virality hint: append "viral OR trending OR popular" to most queries; Serper
    // already ranks by relevance+popularity, so the top results tend to be the
    // most-engaged posts for that creator.
    // ══════════════════════════════════════════════
    const contentItems: ContentItem[] = []

    if (hasCreators) {
      await Promise.all(
        verifiedCreators.slice(0, 10).map(async (c) => {
          if (c.platform === "instagram") {
            const results = await searchWeb(`site:instagram.com/reel ${c.handle} viral OR trending OR popular`, 6)
            const reels = results.filter((r) => r.link.includes("/reel/") || r.link.includes("/p/"))
            for (const r of reels.slice(0, 4)) {
              const meta = await fetchReelCaption(r.link)
              if (meta) contentItems.push({ creator: c.handle, platform: "instagram", url: r.link, caption: meta.caption, hashtags: meta.hashtags })
            }
          } else if (c.platform === "youtube") {
            const results = await searchWeb(`site:youtube.com ${c.handle} most viewed OR popular`, 5)
            const videos = results.filter((r) => r.link.includes("watch?v=") || r.link.includes("youtu.be"))
            for (const r of videos.slice(0, 3)) {
              contentItems.push({ creator: c.handle, platform: "youtube", url: r.link, caption: r.snippet, hashtags: [] })
            }
          } else if (c.platform === "tiktok") {
            const results = await searchWeb(`site:tiktok.com/@${c.handle} video viral OR popular`, 5)
            for (const r of results.slice(0, 3)) {
              contentItems.push({ creator: c.handle, platform: "tiktok", url: r.link, caption: r.snippet, hashtags: [] })
            }
          } else if (c.platform === "linkedin") {
            const results = await searchWeb(`site:linkedin.com/posts ${c.handle}`, 3)
            for (const r of results.slice(0, 2)) {
              contentItems.push({ creator: c.handle, platform: "linkedin", url: r.link, caption: r.snippet, hashtags: [] })
            }
          }
        })
      )
    }

    console.log(`Ideas API Step 5: ${contentItems.length} content items from user creators`)

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
      const seenUrls = new Set<string>()
      trendResults = trendResultsRaw.filter((r) => {
        if (seenUrls.has(r.link)) return false
        seenUrls.add(r.link)
        return true
      })
    } catch (err) {
      if (err instanceof SearchQuotaExceededError) throw err
      console.error("Ideas API: trend search failed", err)
      return NextResponse.json({ error: "trend_search_failed" }, { status: 502 })
    }

    // Upfront validation — fail fast before calling Claude if we have no raw material.
    if (!hasCreators && trendResults.length === 0) {
      return NextResponse.json({ error: "no_trends_found" }, { status: 404 })
    }
    if (hasCreators && contentItems.length === 0 && trendResults.length === 0) {
      return NextResponse.json({ error: "no_creator_content" }, { status: 404 })
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
    // Two modes based on whether the user specified top creators:
    //  - hasCreators → 7 ideas from those creators' viral posts + 2 from trends
    //  - no creators → all 9 ideas from niche trends (creators section omitted)
    // ══════════════════════════════════════════════
    const missionSection = hasCreators
      ? `## יוצרים של המשתמש (פונים רק אליהם!):
${creatorsSection}

${contentSection ? `## תוכן ויראלי שמצאנו מהיוצרים האלה (caption נקרא!):\n${contentSection}` : ""}

## טרנדים:
${trendsSection}

## המשימה — 9 רעיונות:

**7 מיוצרים של המשתמש (תוכן ויראלי):**
- **חובה** לבחור רעיונות מהסקשן "תוכן ויראלי" — אלו הפוסטים הכי מבוקשים של היוצרים.
- אסור להשתמש ביוצרים שלא ברשימה "יוצרים של המשתמש". **רק יוצרים מהרשימה הזו.**
- source = @שם_היוצר. profileUrl = לינק הפרופיל מהרשימה (תמיד!)
- **url ו-profileUrl הם שני שדות שונים!**
  - url = לינק לתוכן ספציפי (ריל/סרטון/פוסט) — **לא לפרופיל!**
  - profileUrl = לינק לפרופיל של היוצר
- אם יש תוכן עם caption — **קודם בדוק שזה לא פרסומי** (קורס, מבצע, פרס, קידום עצמי). אם זה פרסומי — דלג. אם חינוכי — url = הלינק לתוכן, תסכם את ה-caption
- אם יש תוכן עם תגיות בלבד — url = הלינק לתוכן. ציין את התגיות
- אם אין תוכן ספציפי לאיזשהו יוצר — דלג עליו. **אסור להמציא** caption/URLs.
- מותר כמה רעיונות מאותו יוצר על תוכן שונה
- הנושא חייב לנגוע בכאבי/רצונות הקהל
- **גוון פלטפורמות** — לא רק אינסטגרם!

**2 מטרנדים:**
- url = לינק מהטרנדים. profileUrl = "". source = "טרנד"

### פורמט:
- עם caption: "@שם (platform) — [סיכום ה-caption: המסקנות והנקודות הספציפיות]."
- עם תגיות: "@שם (platform) העלה תוכן. תגיות: #tag1 #tag2"
- טרנד: "טרנד: [הנושא]. [סיכום מהמאמר]."`
      : `## טרנדים:
${trendsSection}

## המשימה — 9 רעיונות **רק מטרנדים**:

המשתמש לא הגדיר יוצרים מועדפים, אז כל 9 הרעיונות חייבים להיות מבוססים על הטרנדים למעלה.

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
