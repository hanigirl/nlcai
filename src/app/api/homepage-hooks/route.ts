import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { GREAT_HOOKS_EXAMPLES } from "@/lib/agents/great-hooks"
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"

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

    const prompt = `אתה סוכן מומחה ביצירת הוקים ויראליים לתוכן קצר (Shorts, Reels, TikTok).

## המשימה שלך
צור 20 הוקים ויראליים עבור המשתמש. ההוקים חייבים להתבסס על **המחקר מהשטח** למטה — נושאים אמיתיים, כלים ספציפיים, שיטות ושמות שיוצרי תוכן מובילים מדברים עליהם.

**20 הוקים = 20 נושאים שונים.** כל הוק על נושא/כלי/שיטה אחרת. אסור לחזור על אותו נושא.

${identitySection}
${audienceSection}
${productsSection}
${trendContext ? `## מחקר מהשטח (חובה להשתמש! זה הבסיס להוקים):\n${trendContext}\n` : ""}
## הנחיות ליצירת הוקים
1. **רוב ההוקים חייבים להתבסס על נושאים מהמחקר למעלה** — כלים ספציפיים (Figma AI, Framer, Linear), שיטות (Design Tokens, Auto Layout), טרנדים (AI-native design). אל תמציא נושאים גנריים!
2. **ציין שמות ספציפיים** — לא "כלי AI חדש" אלא "Figma AI". לא "טרנד בעיצוב" אלא "Motion Blur"
3. **כל הוק על נושא אחר** — 20 הוקים = 20 נושאים/כלים/שיטות שונים
4. **חבר בין הנושא מהשטח לכאב של הקהל** — ההוק מדבר על כלי/שיטה ספציפיים דרך הכאב/רצון של הקהל
5. **השתמש בתבניות מהדוגמאות למטה** — התאם אותן לנושאים מהמחקר
6. הוקים בסגנון טיקטוקי/יוטיוב שורטס: מבטיחים טריק, סוד, או קיצור דרך
7. קצרים ופאנצ'יים — משפט אחד עד שניים מקסימום
8. כתוב בעברית, בגובה העיניים, בשפה יומיומית
9. השתמש בטון ובסגנון של המשתמש לפי ה-Core Identity שלו
10. אל תשתמש בדפוסים שהמשתמש ציין ב"מה אני אף פעם לא עושה"

## דוגמאות לתבניות הוקים מעולים — העדף להשתמש בהן ולהתאים לנישה של המשתמש:
${GREAT_HOOKS_EXAMPLES}

${learningInsights}
## פלט
החזר בדיוק 20 הוקים, כל אחד בשורה אחת בלבד.
כל הוק חייב להיות משפט שלם ומוגמר — אסור שהוק ייקטע באמצע.
אל תוסיף מספור, תבליטים, מקפים, או הסברים — רק את הטקסט של ההוק עצמו.
אל תשבור הוק ל-2 שורות — הכל בשורה אחת.`

    const client = new Anthropic({ apiKey })
    const userId = user.id

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const streamResponse = client.messages.stream({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }],
          })

          let buffer = ""
          let hookCount = 0

          for await (const event of streamResponse) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              buffer += event.delta.text

              // Check for complete lines (hooks are one per line)
              const lines = buffer.split("\n")
              buffer = lines.pop() || "" // keep incomplete last line

              for (const rawLine of lines) {
                const line = rawLine.trim().replace(/^\d+[\.\)]\s*/, "")
                if (line.length <= 10) continue
                if (line.startsWith("#") || line.startsWith("-") || line.startsWith("*") || line.startsWith("```")) continue
                if (hookCount >= 20) continue

                // Save to DB
                const { data: row } = await supabase.from("hooks").insert({
                  user_id: userId,
                  hook_text: line,
                  display_order: hookCount,
                  status: "completed",
                  is_selected: false,
                  is_used: false,
                } as Record<string, unknown>).select("id").single()

                const hookData = {
                  id: row?.id || crypto.randomUUID(),
                  hook_text: line,
                  is_used: false,
                  created_at: new Date().toISOString(),
                }

                controller.enqueue(encoder.encode(`data: ${JSON.stringify(hookData)}\n\n`))
                hookCount++
              }
            }
          }

          // Process any remaining buffer
          if (buffer.trim().length > 10 && hookCount < 20) {
            const line = buffer.trim().replace(/^\d+[\.\)]\s*/, "")
            if (!line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*")) {
              const { data: row } = await supabase.from("hooks").insert({
                user_id: userId,
                hook_text: line,
                display_order: hookCount,
                status: "completed",
                is_selected: false,
                is_used: false,
              } as Record<string, unknown>).select("id").single()

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                id: row?.id || crypto.randomUUID(),
                hook_text: line,
                is_used: false,
                created_at: new Date().toISOString(),
              })}\n\n`))
            }
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
