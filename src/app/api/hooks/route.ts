import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildHookGeneratorPrompt, parseHooks } from "@/lib/agents/hook-generator"
import { polishHookForHebrew } from "@/lib/agents/hook-hebrew-polish"
import { judgeHook } from "@/lib/agents/hook-judge"
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"

const USE_DUMMY = false

export async function POST(req: NextRequest) {
  try {
    if (USE_DUMMY) {
      const { count = 3 } = await req.json()
      return NextResponse.json({ hooks: DUMMY_HOOKS.slice(0, count) })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { idea, userResponse, productName, count = 3, fieldIdeas: rawFieldIdeas = [] } = await req.json()
    // Accept both legacy string[] and new structured shape {text, source, category, url}
    type FieldIdea = { text: string; source?: string; category?: string; url?: string }
    const fieldIdeas: FieldIdea[] = (rawFieldIdeas as unknown[])
      .map((x) => (typeof x === "string" ? { text: x } : (x as FieldIdea)))
      .filter((i): i is FieldIdea => !!i?.text)

    if (!idea) {
      return NextResponse.json(
        { error: "idea is required" },
        { status: 400 }
      )
    }

    // Fetch core identity, audience identity, favorites & trending context
    const [{ data: coreIdentity }, { data: audienceIdentity }, { data: favoritedRows }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("idea_favorites").select("idea_text").eq("user_id", user.id),
      fetchLearningInsights(supabase, user.id, "hook"),
    ])
    const favoritedTexts = new Set(
      ((favoritedRows as { idea_text: string }[] | null) ?? []).map((r) => r.idea_text.trim()),
    )

    if (!audienceIdentity || !audienceIdentity.daily_pains) {
      return NextResponse.json({ error: "audience_missing" }, { status: 400 })
    }

    let apiKey: string
    try {
      apiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "anthropic_not_connected") {
        return NextResponse.json({ error: "anthropic_not_connected" }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Load verified creators + trend context from niche_creators cache
    let trendContext = ""
    try {
      const niche = coreIdentity?.niche || ""
      if (niche) {
        // Load cached creators for this niche
        const { data: nicheCreators } = await supabase
          .from("niche_creators")
          .select("handle, platform, followers, bio")
          .eq("user_id", user.id)
          .eq("niche", niche)

        if (nicheCreators && nicheCreators.length > 0) {
          const fmtFollowers = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`
          const creatorsContext = nicheCreators.map((c: { handle: string; platform: string; followers: number; bio: string }) =>
            `- @${c.handle} (${c.platform}, ${fmtFollowers(c.followers)} עוקבים)${c.bio ? `: ${c.bio.slice(0, 100)}` : ""}`
          ).join("\n")
          trendContext = `יוצרי תוכן מובילים בנישה (מאומתים):\n${creatorsContext}`
        }

        // Search for trends ABOUT THE SPECIFIC IDEA, not generic niche trends
        if (process.env.SERPER_API_KEY && idea) {
          // Extract core topic from idea (first ~60 chars, strip creator mentions)
          const ideaTopic = idea.replace(/@[\w.]+/g, "").replace(/\([\d,.KkMm]+\s*עוקבים.*?\)/g, "").trim().slice(0, 80)
          const searches = await Promise.all([
            fetch("https://google.serper.dev/search", {
              method: "POST",
              headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({ q: `${ideaTopic} ${niche} 2026`, num: 5 }),
            }).then((r) => r.ok ? r.json() : { organic: [] }).catch(() => ({ organic: [] })),
            fetch("https://google.serper.dev/search", {
              method: "POST",
              headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({ q: `${ideaTopic} tips viral trending`, num: 5 }),
            }).then((r) => r.ok ? r.json() : { organic: [] }).catch(() => ({ organic: [] })),
          ])
          const results = searches.flatMap((d) => (d.organic ?? []) as { title: string; snippet: string }[])
          // Dedupe by title
          const seen = new Set<string>()
          const unique = results.filter((r) => { if (seen.has(r.title)) return false; seen.add(r.title); return true })
          if (unique.length > 0) {
            trendContext += `\n\nמה אומרים ברשת על הנושא הזה:\n${unique.slice(0, 8).map((r) => `- ${r.title}: ${r.snippet}`).join("\n")}`
          }
        }
      }
    } catch {
      // non-fatal
    }

    // Split field ideas into labeled sections (favorites / viral creators / trends)
    // so the hook generator can prioritize them explicitly.
    const annotated = fieldIdeas.map((i) => ({ ...i, isFavorited: favoritedTexts.has(i.text.trim()) }))
    const favoriteIdeas = annotated.filter((i) => i.isFavorited)
    const creatorIdeas = annotated.filter((i) => !i.isFavorited && i.source && i.source !== "טרנד")
    const trendIdeas = annotated.filter((i) => !i.isFavorited && (!i.source || i.source === "טרנד"))
    const fmtIdea = (i: typeof annotated[number], n: number) => {
      const parts = [`${n}. ${i.text}`]
      if (i.source && i.source !== "טרנד") parts.push(`(מ-${i.source})`)
      if (i.category) parts.push(`[${i.category}]`)
      return parts.join(" ")
    }
    if (favoriteIdeas.length > 0) {
      trendContext += `\n\n## ⭐ רעיונות מועדפים של המשתמש (עדיפות עליונה — אם אחד מהם מתכתב עם הרעיון הנוכחי, השתמש בו ישירות לזווית):\n${favoriteIdeas.slice(0, 10).map((i, n) => fmtIdea(i, n + 1)).join("\n")}`
    }
    if (creatorIdeas.length > 0) {
      trendContext += `\n\n## 🔥 תוכן ויראלי מהיוצרים של המשתמש:\n${creatorIdeas.slice(0, 10).map((i, n) => fmtIdea(i, n + 1)).join("\n")}`
    }
    if (trendIdeas.length > 0) {
      trendContext += `\n\n## 📈 טרנדים בנישה:\n${trendIdeas.slice(0, 8).map((i, n) => fmtIdea(i, n + 1)).join("\n")}`
    }
    console.log(`Hooks API: ${fieldIdeas.length} field ideas received — ${favoriteIdeas.length} favorited, ${creatorIdeas.length} from creators, ${trendIdeas.length} trends`)

    const prompt = buildHookGeneratorPrompt({
      idea,
      userResponse,
      productName,
      coreIdentity,
      audienceIdentity,
      count,
      learningInsights,
      trendContext,
      hasFavorites: favoriteIdeas.length > 0,
    })

    const client = new Anthropic({ apiKey })
    const baseParams = {
      max_tokens: count > 5 ? 2048 : 1024,
      messages: [{ role: "user" as const, content: prompt }],
    }

    let modelFallback = false
    let message
    try {
      message = await client.messages.create({ ...baseParams, model: PRIMARY_MODEL })
    } catch (err) {
      if (!isOverloadError(err)) throw err
      modelFallback = true
      message = await client.messages.create({ ...baseParams, model: FALLBACK_MODEL })
    }

    const textBlock = message.content.find((b) => b.type === "text")
    const rawHooks = parseHooks(textBlock?.text ?? "", count)

    // Judge pass — enforces the same quality bar as /api/homepage-hooks.
    // Track whether the judge rewrote, so we can skip redundant polish below.
    const judged = await Promise.all(
      rawHooks.map(async (h) => {
        const result = await judgeHook(client, {
          hook: h,
          template: "", // Per-idea flow doesn't commit to a template slot
          specificTopic: idea,
          targetPainOrDesire: userResponse || idea,
          programmaticIssues: [],
        })
        return { text: result.valid ? h : result.rewritten, rewrote: !result.valid }
      }),
    )

    // Polish only when judge accepted the original. Judge rewrites come from
    // Opus 4.7 and are already natural Hebrew — skipping the Sonnet polish
    // on those saves 3-6s per hook with no quality loss.
    const hooks = await Promise.all(
      judged.map(({ text, rewrote }) =>
        rewrote ? Promise.resolve(text) : polishHookForHebrew(client, text, PRIMARY_MODEL),
      ),
    )

    return NextResponse.json({ hooks, model_fallback: modelFallback })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Hook generation error:", message)
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(message)
    const isOverloaded = /overloaded|529|503/.test(message)
    const errCode = isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : `Failed to generate hooks: ${message}`
    return NextResponse.json(
      { error: errCode },
      { status: isCredits ? 402 : isOverloaded ? 503 : 500 }
    )
  }
}
