import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildHookGeneratorPrompt, parseHooks } from "@/lib/agents/hook-generator"
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

    const { idea, userResponse, productName, count = 3, fieldIdeas = [] } = await req.json()

    if (!idea) {
      return NextResponse.json(
        { error: "idea is required" },
        { status: 400 }
      )
    }

    // Fetch core identity, audience identity & trending context
    const [{ data: coreIdentity }, { data: audienceIdentity }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      fetchLearningInsights(supabase, user.id, "hook"),
    ])

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

    // Add field ideas
    if (fieldIdeas.length > 0) {
      trendContext += `\n\nרעיונות מהשטח — תוכן ויראלי שנמצא מיוצרים מובילים בנישה:\n${fieldIdeas.slice(0, 10).map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`
    }

    const prompt = buildHookGeneratorPrompt({
      idea,
      userResponse,
      productName,
      coreIdentity,
      audienceIdentity,
      count,
      learningInsights,
      trendContext,
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
    const hooks = parseHooks(textBlock?.text ?? "", count)

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
