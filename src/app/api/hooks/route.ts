import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildHookGeneratorPrompt, buildHookGeneratorSystem, parseHooks } from "@/lib/agents/hook-generator"
import { judgeHook, validateHookLocally } from "@/lib/agents/hook-judge"
import { findNearDuplicate } from "@/lib/agents/hook-similarity"
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"
import { generateWithGeminiFallback, geminiErrorCode } from "@/lib/gemini"
import { detectAddressGender, detectAddressGenderFromText } from "@/lib/detect-addressing"
import { getAuthUser } from "@/lib/auth-user"

// Two engines live here, picked by whether the user has a Gemini key:
//   has one — one Gemini call, no judge
//   has none — the Sonnet writer → Opus judge chain
// Either way this is well past Vercel's 10s default. 300s is the Pro plan
// ceiling; on Hobby it caps silently to 60s.
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

    // Everything the user has already been shown for THIS idea. Read before
    // the delete below, and that order is the whole fix: "תייצר מחדש" used to
    // wipe the batch and then re-run a byte-identical prompt, so the writer
    // had no idea it had already answered this question and converged on the
    // same angles every time. The user saw the same ten hooks, paid for them
    // again, and clicked regenerate again.
    const ideaKey = typeof idea === "string" ? idea.trim() : ""
    let priorForIdea: { id: string; hook_text: string }[] = []
    if (ideaKey) {
      const { data: priorRows } = await supabase
        .from("hooks")
        .select("id, hook_text")
        .eq("user_id", user.id)
        .eq("idea_text", ideaKey)
        .eq("is_used", false)
      priorForIdea = (priorRows as { id: string; hook_text: string }[] | null) ?? []
    }

    // When the user clicks "תייצר מחדש" on /project, wipe the unused hooks
    // they've already generated for this idea so the next batch shows up as
    // a clean replacement. Deleted by the ids we just captured rather than by
    // a filter — a filtered delete on this table has taken live rows with it
    // before, and the id list is exactly the set we read above. is_used rows
    // are excluded by that read: hooks tied to a core_post have ON DELETE
    // CASCADE wired up, so removing them would take the user's draft too.
    if (replaceExisting && priorForIdea.length > 0) {
      const { error: delErr } = await supabase
        .from("hooks")
        .delete()
        .in("id", priorForIdea.map((h) => h.id))
      if (delErr) {
        console.error("[api/hooks] replaceExisting delete failed", delErr)
        // Non-fatal — proceed with insert. Old unused hooks just stick around.
      }
    }

    // Fetch core identity, audience identity, favorites & trending context
    const [{ data: coreIdentity }, { data: audienceIdentity }, { data: favoritedRows }, { data: recentRows }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("idea_favorites").select("idea_text").eq("user_id", user.id),
      // The user's other recent hooks. Same-idea repetition is the loud bug,
      // but a user who writes about one niche gets the same three angles
      // across different ideas too — this is what stops that.
      supabase
        .from("hooks")
        .select("hook_text")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      fetchLearningInsights(supabase, user.id, "hook"),
    ])

    // Same-idea hooks first: those are the ones the user just rejected, so
    // they carry the most signal about what not to write again. Deduped by
    // text — the same hook landing twice wastes prompt on one instruction.
    const previousHooks = Array.from(
      new Set(
        [
          ...priorForIdea.map((h) => h.hook_text),
          ...(((recentRows as { hook_text: string }[] | null) ?? []).map((h) => h.hook_text)),
        ]
          .map((t) => t?.trim())
          .filter((t): t is string => !!t),
      ),
    ).slice(0, 40)
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

    // Engine selection, by capability rather than by an allowlist.
    //
    // Gemini is live for every user who has connected a Gemini key: one call,
    // no judge, no polish. Everyone who has not keeps the Claude chain exactly
    // as before. It has to work this way round — when this rolled out only 3
    // of 77 users had a Gemini key, so a flag flipped to "Gemini for everyone"
    // would have returned gemini_not_connected to the other 74 and taken hook
    // generation down for the whole cohort.
    //
    // A missing key is therefore NOT an error here, it is the Claude path. A
    // key that exists but fails to load IS an error worth seeing, so it is
    // logged before falling back.
    let geminiKey = ""
    try {
      geminiKey = await getUserApiKey(supabase, "gemini_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== "gemini_not_connected") {
        console.error("[hooks] gemini key present but unreadable — falling back to Claude:", msg)
      }
    }
    const geminiCohort = !!geminiKey

    let anthropicKey = ""
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!geminiCohort) {
        if (msg === "anthropic_not_connected") {
          return NextResponse.json({ error: "anthropic_not_connected" }, { status: 400 })
        }
        return NextResponse.json({ error: msg }, { status: 500 })
      }
      // Cohort only: detection falls back to the regex pass below.
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
    // prompt priority. On the Claude path it's applied to the writer, the
    // judge and the polish; on the Gemini path the writer prompt is the only
    // place left that can enforce it.
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
      previousHooks,
    })
    // The rules, templates and worked examples — ~10k tokens that are the same
    // for every generate this user runs. Kept apart from the prompt above so
    // it can be cached; see buildHookGeneratorSystem.
    const systemPrompt = buildHookGeneratorSystem({ count, addressGender })

    let hookTexts: string[]
    let modelFallback = false

    if (geminiCohort) {
      // One Gemini call, the exact same prompt the Claude writer receives
      // below. No judge, no Hebrew polish — whatever Gemini returns is what
      // the user sees.
      //
      // The budget covers thinking AND the hooks. Sized generously on purpose:
      // running out mid-response truncates the list and silently costs the
      // user hooks, while unused budget costs nothing.
      const { text: rawText, fallback } = await generateWithGeminiFallback(geminiKey, {
        prompt: `${systemPrompt}\n\n${prompt}`,
        maxOutputTokens: count > 5 ? 24576 : 16384,
        thinkingLevel: "high",
      })
      modelFallback = fallback
      hookTexts = parseHooks(rawText, count)

      if (hookTexts.length === 0) {
        console.error(`[api/hooks] Gemini returned nothing parseable. First 300 chars: ${rawText.slice(0, 300)}`)
        return NextResponse.json({ error: "no_hooks_generated" }, { status: 502 })
      }
    } else {
      // Unchanged Claude path: write → judge every hook → polish the ones the
      // judge accepted.
      const client = new Anthropic({ apiKey: anthropicKey })
      const baseParams = {
        max_tokens: count > 5 ? 2048 : 1024,
        system: [
          {
            type: "text" as const,
            text: systemPrompt,
            // 1h rather than the 5-minute default. The behaviour this is here
            // to make cheap is a user clicking "תייצר מחדש" repeatedly, and
            // those clicks are minutes apart, not seconds.
            cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
          },
        ],
        messages: [{ role: "user" as const, content: prompt }],
      }

      let message
      try {
        message = await client.messages.create({ ...baseParams, model: PRIMARY_MODEL })
      } catch (err) {
        if (!isOverloadError(err)) throw err
        modelFallback = true
        message = await client.messages.create({ ...baseParams, model: FALLBACK_MODEL })
      }

      console.log(
        `[api/hooks] writer — uncached ${message.usage.input_tokens} tok, ` +
        `cache read ${message.usage.cache_read_input_tokens ?? 0}, ` +
        `cache write ${message.usage.cache_creation_input_tokens ?? 0}`,
      )
      const textBlock = message.content.find((b) => b.type === "text")
      const rawHooks = parseHooks(textBlock?.text ?? "", count)

      // Judge pass — enforces the same quality bar as /api/homepage-hooks.
      // Track whether the judge rewrote, so we can skip redundant polish below.
      //
      // programmaticIssues was hardcoded to [] here while the homepage route
      // fed the judge real findings — so this route paid for ten Opus calls
      // and told each one nothing. It now carries both the deterministic
      // checks and the repeat check, which costs no extra call: the judge
      // already runs on every hook and already rewrites what it fails.
      const judgeOne = (h: string, i: number) => {
        const issues = validateHookLocally(h, idea)
        // Compared against what the user already saw AND the earlier hooks
        // in this same batch — ten hooks in one response repeat each other
        // as readily as they repeat last week's.
        const duplicated = findNearDuplicate(h, [
          ...previousHooks,
          ...rawHooks.slice(0, i),
        ])
        if (duplicated) {
          issues.push(`repeats_existing_hook: "${duplicated}"`)
        }
        return judgeHook(client, {
          hook: h,
          template: "", // Per-idea flow doesn't commit to a template slot
          specificTopic: idea,
          targetPainOrDesire: userResponse || idea,
          programmaticIssues: issues,
          addressGender,
        })
      }

      // The first judge call runs ALONE, then the rest fan out.
      //
      // This looks like a pointless serialisation and is the whole reason the
      // cache pays off. The judge rubric is identical for all ten hooks, but a
      // prompt cache only exists once a request has written it — fire all ten
      // at once against a cold cache and every one of them misses, and worse,
      // several pay the 1.25x write premium for the same block. One call
      // writes it, the other nine read it at a tenth of the price. The cost is
      // a single extra round trip on a route that already runs half a minute.
      const judgeResults = rawHooks.length > 0
        ? [
            await judgeOne(rawHooks[0], 0),
            ...(await Promise.all(rawHooks.slice(1).map((h, i) => judgeOne(h, i + 1)))),
          ]
        : []

      // Proof, not hope: a silent cache miss looks exactly like a cache hit
      // from the outside except on the bill. If cacheRead stays at 0 across a
      // run, something upstream is varying the rubric.
      const judgeTotals = judgeResults.reduce(
        (acc, r) => ({
          input: acc.input + (r.usage?.input ?? 0),
          cacheRead: acc.cacheRead + (r.usage?.cacheRead ?? 0),
          cacheWrite: acc.cacheWrite + (r.usage?.cacheWrite ?? 0),
        }),
        { input: 0, cacheRead: 0, cacheWrite: 0 },
      )
      console.log(
        `[api/hooks] judge ${judgeResults.length} calls — uncached ${judgeTotals.input} tok, ` +
        `cache read ${judgeTotals.cacheRead}, cache write ${judgeTotals.cacheWrite}`,
      )

      const judged = judgeResults.map((result, i) => ({
        text: result.valid ? rawHooks[i] : result.rewritten,
        rewrote: !result.valid,
      }))

      // No polish pass. It used to run on every hook the judge ACCEPTED —
      // which is exactly the set the judge had just certified as natural,
      // error-free Hebrew, since that is question 5 of its rubric. A second
      // Sonnet call to clean up Hebrew cleared a second earlier is ten calls
      // and ~2.6¢ per generate spent re-editing work that already passed.
      // Judge rewrites were already skipped for the same reason; this just
      // applies the reasoning to the other branch (Hani, 2026-08-26).
      hookTexts = judged.map(({ text }) => text)
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
