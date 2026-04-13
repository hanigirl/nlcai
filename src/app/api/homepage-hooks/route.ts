import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { TEMPLATE_LIBRARY, getTemplatesByCategory, type TemplateCategory } from "@/lib/agents/hook-templates"

interface PlanItem {
  category: TemplateCategory
  specific_topic: string
  target_pain_or_desire: string
  audience_quote: string
  angle_summary: string
}
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"

const USE_DUMMY = false

export async function POST(req: NextRequest) {
  try {
    if (USE_DUMMY) {
      return NextResponse.json({ hooks: DUMMY_HOOKS })
    }

    let fieldIdeas: string[] = []
    try {
      const body = await req.json()
      fieldIdeas = body.fieldIdeas ?? []
    } catch { /* no body */ }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const [{ data: coreIdentity }, { data: audienceIdentity }, { data: products }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("products").select("name, type, page_summary").eq("user_id", user.id),
      fetchLearningInsights(supabase, user.id, "hook"),
    ])

    if (!coreIdentity) {
      return NextResponse.json(
        { error: "Core identity not found. Please complete onboarding first." },
        { status: 400 }
      )
    }

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

    const identitySection = `
## Core Identity של המשתמש

### מי אני
${coreIdentity.who_i_am}

### הנישה שלי
${coreIdentity.niche}

### למי אני מדבר/ת
${coreIdentity.who_i_serve}

### איך אני נשמע/ת
${coreIdentity.how_i_sound}
${coreIdentity.slang_examples ? `סלנג ודוגמאות: ${coreIdentity.slang_examples}` : ""}

### מה אני אף פעם לא עושה
${coreIdentity.what_i_never_do}
`

    const audienceSection = audienceIdentity
      ? `
## Audience Identity — קהל היעד

### כאבים ובעיות
- כאבים יומיומיים: ${audienceIdentity.daily_pains}
- כאבים רגשיים: ${audienceIdentity.emotional_pains}

### פחדים
${audienceIdentity.fears}

### אמונות מגבילות
${audienceIdentity.limiting_beliefs}

### רצונות וחלומות
- רצונות יומיומיים: ${audienceIdentity.daily_desires}
- רצונות רגשיים: ${audienceIdentity.emotional_desires}

### שפת הקהל
- ציטוטים חוצי-קהל: ${audienceIdentity.cross_audience_quotes}
- משפטי זהות: ${audienceIdentity.identity_statements}
`
      : ""

    const productsSection = products && products.length > 0
      ? `\n## המוצרים/שירותים של המשתמש\n${products.map((p, i) => {
          let line = `${i + 1}. ${p.name} (${p.type === "front" ? "מוצר פרונט" : p.type === "premium" ? "מוצר פרימיום" : "מגנט לידים"})`
          if (p.page_summary) line += `\n   תיאור: ${p.page_summary}`
          return line
        }).join("\n")}\n`
      : ""

    // Load verified creators + trends from cache and Serper
    let trendContext = ""
    try {
      const niche = coreIdentity.niche
      if (niche) {
        // Load cached creators
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

        // Also add Serper trends
        if (process.env.SERPER_API_KEY) {
          const [trendRes1, trendRes2] = await Promise.all([
            fetch("https://google.serper.dev/search", {
              method: "POST",
              headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({ q: `${niche} trending tools methods 2026`, num: 5 }),
            }),
            fetch("https://google.serper.dev/search", {
              method: "POST",
              headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({ q: `${niche} viral content topics 2026`, num: 5 }),
            }),
          ])
          const results: { title: string; snippet: string }[] = []
          if (trendRes1.ok) {
            const d = await trendRes1.json()
            results.push(...(d.organic ?? []).map((r: Record<string, string>) => ({ title: r.title, snippet: r.snippet })))
          }
          if (trendRes2.ok) {
            const d = await trendRes2.json()
            results.push(...(d.organic ?? []).map((r: Record<string, string>) => ({ title: r.title, snippet: r.snippet })))
          }
          trendContext += `\n\nטרנדים חמים בנישה:\n${results.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")}`
        }
      }
    } catch {
      // non-fatal
    }

    // Add field ideas (from "רעיונות מהשטח")
    if (fieldIdeas.length > 0) {
      trendContext += `\n\nרעיונות מהשטח — תוכן ויראלי שנמצא מיוצרים מובילים בנישה:\n${fieldIdeas.slice(0, 15).map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    }

    // ============= PIPELINE STEP 1 — PLANNING =============
    // Generate 15 angle plans: { category, angle, target_emotion, audience_quote, specific_topic }
    const HOOK_COUNT = 15

    const categoriesCatalog = TEMPLATE_LIBRARY
      .map((g) => `- ${g.category} (${g.contentType}, "${g.label}"): ${g.goal}`)
      .join("\n")

    const planningPrompt = `אתה אסטרטג שיווק שמתכנן זוויות תוכן עבור יוצרי קונטנט בישראל.

## המטרה
לנתח את קהל היעד והמחקר מהשטח, ולהפיק ${HOOK_COUNT} זוויות שונות להוקים. כל זווית = רעיון מובחן עם קטגוריה + רגש + ציטוט מהקהל.

${identitySection}
${audienceSection}
${productsSection}
${trendContext ? `## מחקר מהשטח:\n${trendContext}\n` : ""}

## קטגוריות הוקים זמינות (תבחר אחת לכל זווית):
${categoriesCatalog}

## הוראות
1. הפק ${HOOK_COUNT} זוויות שונות. גוון בין הקטגוריות — תכלול awareness, connection, ו-authority. אל תיצמד לקטגוריה אחת.
2. לכל זווית — בחר נושא ספציפי מהמחקר/קהל היעד (כלי, שיטה, כאב ספציפי, רצון). אסור גנרי.
3. השתמש בשפת הקהל מ-cross_audience_quotes ו-identity_statements.
4. הזווית צריכה להיות מובחנת — לא חפיפה בין שתי זוויות.

## פלט
החזר JSON תקין בלבד (בלי markdown, בלי הסברים). מערך של ${HOOK_COUNT} אובייקטים בפורמט הזה:
[
  {
    "category": "myth_breaking" | "common_mistakes" | "diagnosis" | "personal_story" | "empowerment" | "identification" | "agenda" | "lists" | "real_reason" | "how_to",
    "specific_topic": "הנושא הקונקרטי (כלי/שיטה/בעיה ספציפית)",
    "target_pain_or_desire": "הכאב/רצון של הקהל שהזווית נוגעת בו",
    "audience_quote": "ציטוט/ביטוי בשפת הקהל שיופיע בהוק",
    "angle_summary": "תיאור קצר של מה ההוק יגיד (משפט)"
  }
]`

    // ============= PIPELINE EXECUTION =============
    const client = new Anthropic({ apiKey })
    const userId = user.id

    // Helper — call with Sonnet → Haiku fallback
    const planWithFallback = async (): Promise<{ plans: PlanItem[]; fallback: boolean }> => {
      const tryModel = async (model: string) => {
        const res = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: planningPrompt }],
        })
        const text = res.content.find((b) => b.type === "text")?.text ?? ""
        // Extract JSON array from response (in case model wraps it)
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        if (!jsonMatch) throw new Error("No JSON in plan response")
        return JSON.parse(jsonMatch[0]) as PlanItem[]
      }
      try {
        return { plans: await tryModel(PRIMARY_MODEL), fallback: false }
      } catch (err) {
        if (!isOverloadError(err)) throw err
        return { plans: await tryModel(FALLBACK_MODEL), fallback: true }
      }
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let hookCount = 0
        let usedFallback = false

        try {
          // ============= STEP 1: PLANNING =============
          const { plans, fallback } = await planWithFallback()
          if (fallback) {
            usedFallback = true
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model_fallback: true })}\n\n`))
          }

          // ============= STEP 2: WRITING — one hook per plan, sequentially streamed =============
          for (const plan of plans) {
            if (hookCount >= HOOK_COUNT) break
            const templates = getTemplatesByCategory(plan.category)
            if (templates.length === 0) continue

            const writePrompt = `אתה כותב הוקים ויראליים בעברית NATIVE לישראלים.

## הזווית שאת/ה כותב/ת לפיה
נושא ספציפי: ${plan.specific_topic}
כאב/רצון של הקהל: ${plan.target_pain_or_desire}
ביטוי בשפת הקהל: "${plan.audience_quote}"
תיאור הזווית: ${plan.angle_summary}

## הטון של היוצר
${coreIdentity.who_i_am}
איך אני נשמע/ת: ${coreIdentity.how_i_sound}
${coreIdentity.slang_examples ? `סלנג: ${coreIdentity.slang_examples}` : ""}
מה אני אף פעם לא עושה: ${coreIdentity.what_i_never_do}

## תבניות לבחירה (חובה לבחור אחת מהן ולמלא את ה-slots)
${templates.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## הוראות
- בחר/י תבנית אחת מהרשימה למעלה.
- מלא/י את ה-slots ({...}) עם תוכן ספציפי לפי הזווית והנושא.
- הוק יחיד, משפט אחד עד שניים, פאנצ'י, NATIVE עברית.
- בלי "וואו" — תגיד "אמאלה". בלי "מדהים" — תגיד "תותח/חבל על הזמן". בלי תרגומים מאנגלית.
- אסור להמציא תבנית חדשה. רק להתאים אחת מהקיימות.

## פלט
משפט אחד בלבד — ההוק עצמו, בלי הסברים, בלי מספור, בלי גרשיים.`

            // Write the hook (Sonnet → Haiku fallback)
            let hookText = ""
            const writeWithFallback = async () => {
              try {
                const res = await client.messages.create({
                  model: usedFallback ? FALLBACK_MODEL : PRIMARY_MODEL,
                  max_tokens: 200,
                  messages: [{ role: "user", content: writePrompt }],
                })
                hookText = (res.content.find((b) => b.type === "text")?.text ?? "").trim()
              } catch (err) {
                if (!isOverloadError(err) || usedFallback) throw err
                usedFallback = true
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model_fallback: true })}\n\n`))
                const res = await client.messages.create({
                  model: FALLBACK_MODEL,
                  max_tokens: 200,
                  messages: [{ role: "user", content: writePrompt }],
                })
                hookText = (res.content.find((b) => b.type === "text")?.text ?? "").trim()
              }
            }
            await writeWithFallback()

            // Clean up — strip wrapping quotes / bullets / numbering / multi-line
            hookText = hookText
              .split("\n")[0]
              .trim()
              .replace(/^\d+[\.\)]\s*/, "")
              .replace(/^["'״׳"\-*•]+/, "")
              .replace(/["'״׳"]+$/, "")
              .trim()

            if (hookText.length <= 10) continue

            const { data: row } = await supabase.from("hooks").insert({
              user_id: userId,
              hook_text: hookText,
              display_order: hookCount,
              status: "completed",
              is_selected: false,
              is_used: false,
            } as Record<string, unknown>).select("id").single()

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: row?.id || crypto.randomUUID(),
              hook_text: hookText,
              is_used: false,
              created_at: new Date().toISOString(),
            })}\n\n`))
            hookCount++
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Homepage hooks error:", msg)
    return NextResponse.json(
      { error: `Failed to generate hooks: ${msg}` },
      { status: 500 }
    )
  }
}
