import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildHookGeneratorPrompt, parseHooks } from "@/lib/agents/hook-generator"
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { generateWithGeminiFallback, geminiErrorCode } from "@/lib/gemini"
import { detectAddressGender, detectAddressGenderFromText } from "@/lib/detect-addressing"
import { getAuthUser } from "@/lib/auth-user"

// Hooks are now a single Gemini call — the Claude judge and Hebrew-polish
// rounds were removed so we can see what Gemini produces unassisted. One
// thinking-heavy call still exceeds Vercel's 10s default; 300s is the Pro
// plan ceiling, and on Hobby it caps silently to 60s.
export const maxDuration = 300

const USE_DUMMY = false

export async function POST(req: NextRequest) {
  try {
    if (USE_DUMMY) {
      const { count = 3 } = await req.json()
      return NextResponse.json({ hooks: DUMMY_HOOKS.slice(0, count) })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { idea, userResponse, productName, count = 3, fieldIdeas: rawFieldIdeas = [], replaceExisting = false } = await req.json()
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

    // When the user clicks "תייצר מחדש" on /project, wipe the unused hooks
    // they've already generated for this idea so the next batch shows up as
    // a clean replacement. We deliberately scope to is_used=false: hooks
    // tied to a core_post have ON DELETE CASCADE wired up, so removing them
    // would also remove the draft/post the user has been working on.
    if (replaceExisting && typeof idea === "string" && idea.trim()) {
      const { error: delErr } = await supabase
        .from("hooks")
        .delete()
        .eq("user_id", user.id)
        .eq("idea_text", idea.trim())
        .eq("is_used", false)
      if (delErr) {
        console.error("[api/hooks] replaceExisting delete failed", delErr)
        // Non-fatal — proceed with insert. Old unused hooks just stick around.
      }
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

    const hasAudienceContent =
      !!audienceIdentity &&
      [
        audienceIdentity.daily_pains,
        audienceIdentity.emotional_pains,
        audienceIdentity.fears,
        audienceIdentity.daily_desires,
        audienceIdentity.emotional_desires,
      ].some((v) => typeof v === "string" && v.trim().length > 0)
    if (!hasAudienceContent) {
      return NextResponse.json({ error: "audience_missing" }, { status: 400 })
    }

    // Gemini writes the hooks — without it there is nothing to generate.
    let geminiKey: string
    try {
      geminiKey = await getUserApiKey(supabase, "gemini_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "gemini_not_connected") {
        return NextResponse.json({ error: "gemini_not_connected" }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Anthropic is now optional here: its only remaining job is the Haiku
    // fallback inside addressing detection, which already degrades to the
    // code-only pass. A missing key must not block hook generation.
    let anthropicKey = ""
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      // no-op — detection falls back to the regex pass below
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

    // Detect the addressing gender from the user's own words (idea +
    // description) in code — see detect-addressing.ts for why this isn't a
    // prompt priority. With the judge and polish gone, the writer prompt is
    // the only place it can be enforced.
    const addressSource = [userResponse, idea].filter(Boolean).join("\n")
    const addressGender = anthropicKey
      ? await detectAddressGender(anthropicKey, addressSource)
      : detectAddressGenderFromText(addressSource)

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
      addressGender,
    })

    // One Gemini call, the exact same prompt the Claude writer received. No
    // judge, no Hebrew polish — whatever Gemini returns is what the user sees,
    // which is the point of the switch: we want to read its unassisted Hebrew.
    //
    // The budget covers thinking AND the hooks. Sized generously on purpose:
    // running out mid-response truncates the list and silently costs the user
    // hooks, while unused budget costs nothing.
    const { text: rawText, fallback: modelFallback } = await generateWithGeminiFallback(geminiKey, {
      prompt,
      maxOutputTokens: count > 5 ? 24576 : 16384,
      thinkingLevel: "high",
    })

    const hookTexts = parseHooks(rawText, count)

    if (hookTexts.length === 0) {
      console.error(`[api/hooks] Gemini returned nothing parseable. First 300 chars: ${rawText.slice(0, 300)}`)
      return NextResponse.json({ error: "no_hooks_generated" }, { status: 502 })
    }

    // Persist every generated hook to the user's inventory so the unselected
    // ones show up on /hooks too — picking a hook for a post then marks just
    // that one as used (see core-posts POST). Inserts run in parallel and
    // preserve order via Promise.all; insert failures fall back to id="" so
    // the user can still generate a post (core-posts matches on text in that
    // case).
    // display_order is NOT NULL on the hooks table — use the batch index, the
    // same convention homepage-hooks uses. status defaults to 'pending' in
    // schema; we mark these 'completed' explicitly since generation already
    // finished — there is no later stage that could still change the text.
    const hooks = await Promise.all(
      hookTexts.map(async (text, idx) => {
        const { data, error } = await supabase
          .from("hooks")
          .insert({
            user_id: user.id,
            hook_text: text,
            idea_text: idea,
            display_order: idx,
            status: "completed",
          } as never)
          .select("id, hook_text")
          .single()
        if (error || !data) {
          console.error("[api/hooks] failed to persist hook", error)
          return { id: "", hook_text: text }
        }
        return data as unknown as { id: string; hook_text: string }
      }),
    )

    return NextResponse.json({ hooks, model_fallback: modelFallback })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Hook generation error:", message)
    // Gemini failures carry their own normalized code; fall back to the old
    // Anthropic-shaped detection for anything else in the request path.
    const gemini = geminiErrorCode(error)
    if (gemini) {
      const status = gemini === "gemini_quota_exceeded" ? 402 : gemini === "gemini_overloaded" ? 503 : 400
      return NextResponse.json({ error: gemini }, { status })
    }
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(message)
    const isOverloaded = /overloaded|529|503/.test(message)
    const errCode = isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : `Failed to generate hooks: ${message}`
    return NextResponse.json(
      { error: errCode },
      { status: isCredits ? 402 : isOverloaded ? 503 : 500 }
    )
  }
}
