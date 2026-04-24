import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { TEMPLATE_LIBRARY, getTemplatesByCategorySorted, templateText, templatePriority, type TemplateCategory, type HookTemplate } from "@/lib/agents/hook-templates"
import { polishHookForHebrew } from "@/lib/agents/hook-hebrew-polish"
import { judgeHook, validateHookLocally } from "@/lib/agents/hook-judge"
import { classifyHooksByProduct } from "@/lib/agents/hook-product-classifier"

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

    // Field ideas now carry full structure (text, source, category, url) so we
    // can bias by creator/trend and cross-check favorites. Older clients may
    // still send plain strings — normalize both shapes.
    type FieldIdea = { text: string; source?: string; category?: string; url?: string }
    let fieldIdeas: FieldIdea[] = []
    try {
      const body = await req.json()
      const raw = body.fieldIdeas ?? []
      fieldIdeas = raw
        .map((x: unknown) =>
          typeof x === "string"
            ? { text: x }
            : (x as FieldIdea),
        )
        .filter((i: FieldIdea) => !!i?.text)
    } catch { /* no body */ }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const [{ data: coreIdentity }, { data: audienceIdentity }, { data: products }, { data: favoritedRows }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("products").select("id, name, type, page_summary").eq("user_id", user.id),
      supabase.from("idea_favorites").select("idea_text").eq("user_id", user.id),
      fetchLearningInsights(supabase, user.id, "hook"),
    ])

    // Build favorite-text lookup once, use it to flag incoming fieldIdeas.
    const favoritedTexts = new Set(
      ((favoritedRows as { idea_text: string }[] | null) ?? []).map((r) => r.idea_text.trim()),
    )
    type AnnotatedIdea = FieldIdea & { isFavorited: boolean }
    const annotated: AnnotatedIdea[] = fieldIdeas.map((i) => ({
      ...i,
      isFavorited: favoritedTexts.has(i.text.trim()),
    }))
    const favoriteIdeas = annotated.filter((i) => i.isFavorited)
    const creatorIdeas = annotated.filter((i) => !i.isFavorited && i.source && i.source !== "טרנד")
    const trendIdeas = annotated.filter((i) => !i.isFavorited && (!i.source || i.source === "טרנד"))
    console.log(`Homepage Hooks: ${fieldIdeas.length} field ideas received — ${favoriteIdeas.length} favorited, ${creatorIdeas.length} from creators, ${trendIdeas.length} trends (total favorites in DB: ${favoritedTexts.size})`)

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

    // Add field ideas — split into labeled sections so the planner can bias by source
    // and so favorites get hard quota treatment in the instructions below.
    const fmtIdea = (i: AnnotatedIdea, n: number) => {
      const parts = [`${n}. ${i.text}`]
      if (i.source && i.source !== "טרנד") parts.push(`(מ-${i.source})`)
      if (i.category) parts.push(`[${i.category}]`)
      return parts.join(" ")
    }
    if (favoriteIdeas.length > 0) {
      trendContext += `\n\n## ⭐ רעיונות מועדפים של המשתמש — נושאים שהוא סימן במיוחד (עדיפות עליונה!):\n${favoriteIdeas.slice(0, 10).map((i, n) => fmtIdea(i, n + 1)).join("\n")}`
    }
    if (creatorIdeas.length > 0) {
      trendContext += `\n\n## 🔥 תוכן ויראלי מהיוצרים של המשתמש:\n${creatorIdeas.slice(0, 15).map((i, n) => fmtIdea(i, n + 1)).join("\n")}`
    }
    if (trendIdeas.length > 0) {
      trendContext += `\n\n## 📈 טרנדים בנישה (להשלמה):\n${trendIdeas.slice(0, 10).map((i, n) => fmtIdea(i, n + 1)).join("\n")}`
    }

    // ============= PIPELINE STEP 1 — PLANNING =============
    // Generate 20 angle plans: { category, angle, target_emotion, audience_quote, specific_topic }
    // Home page shows the first 4; the rest live in /hooks as the user's hook inventory.
    const HOOK_COUNT = 20

    const categoriesCatalog = TEMPLATE_LIBRARY
      .map((g) => `- ${g.category} (${g.contentType}, "${g.label}"): ${g.goal}`)
      .join("\n")

    // Hard quota — aggressive. User marked these as favorites, and their creator
    // viral posts are the highest-signal source. Plans should be saturated from
    // them before falling back to generic audience content.
    //   - Favorites: 3 plans per favorite, capped at 15 (so at least 5 slots
    //     remain for other coverage).
    //   - Creator viral: fills whatever remains, up to their count.
    //   - Trends: pure top-up if creator content is thin.
    //   - Audience-only: the very last resort.
    const favoriteQuota = Math.min(favoriteIdeas.length * 3, 15)
    const creatorQuota = Math.min(creatorIdeas.length, Math.max(HOOK_COUNT - favoriteQuota - 2, 0))
    const trendQuota = Math.min(trendIdeas.length, Math.max(HOOK_COUNT - favoriteQuota - creatorQuota, 0))
    const audienceOnly = Math.max(HOOK_COUNT - favoriteQuota - creatorQuota - trendQuota, 0)
    console.log(`Homepage Hooks: quota — ${favoriteQuota} favorites + ${creatorQuota} creators + ${trendQuota} trends + ${audienceOnly} audience-only (of ${HOOK_COUNT})`)
    const quotaSection = (favoriteIdeas.length > 0 || creatorIdeas.length > 0 || trendIdeas.length > 0)
      ? `
## 🎯 חובה — מכסת הוקים ממחקר מהשטח (רצפה, לא תקרה — מותר יותר, אסור פחות):
${favoriteIdeas.length > 0 ? `- **${favoriteQuota} מתוך ${HOOK_COUNT} זוויות חייבות להיות על הרעיונות המועדפים** ⭐ — המשתמש סימן אותם במפורש. תשתמש/י בנושא הספציפי של כל מועדף (לא בגרסה גנרית שלו) ותייצר/י ממנו כמה זוויות שונות.` : ""}
${creatorIdeas.length > 0 ? `- **${creatorQuota} זוויות חייבות להיות על תוכן ויראלי מהיוצרים** 🔥 — קח/י פוסט ספציפי, הזווית שלו, ובנה/י ממנו הוק בקול של המשתמש. ציין/י ב-angle_summary "בהשראת @שם_היוצר".` : ""}
${trendIdeas.length > 0 ? `- **${trendQuota} זוויות יכולות להיות על טרנדים** 📈 — רק אם לא נשאר מקום ממועדפים/יוצרים.` : ""}
- רק ${audienceOnly} זוויות מותר להבסיס אך ורק על מחקר הקהל ללא מקור מ-⭐/🔥/📈.
` : ""

    const planningPrompt = `אתה אסטרטג שיווק שמתכנן זוויות תוכן עבור יוצרי קונטנט בישראל.

## המטרה
לנתח את קהל היעד והמחקר מהשטח, ולהפיק ${HOOK_COUNT} זוויות שונות להוקים. כל זווית = רעיון מובחן עם קטגוריה + רגש + ציטוט מהקהל.

${identitySection}
${audienceSection}
${productsSection}
${trendContext ? `## מחקר מהשטח:\n${trendContext}\n` : ""}
${quotaSection}
## קטגוריות הוקים זמינות (תבחר אחת לכל זווית):
${categoriesCatalog}

## הוראות
1. הפק ${HOOK_COUNT} זוויות שונות. **גוון קשיח בין הקטגוריות** — תכלול לפחות **8 קטגוריות שונות** מתוך 15 הקטגוריות הזמינות. אסור יותר מ-3 זוויות באותה קטגוריה (שומר על מגוון תבניות בכתיבה).
2. פיזור חובה: חייב לכלול לפחות 3 קטגוריות מ-awareness (myth_breaking/common_mistakes/diagnosis), לפחות 2 מ-connection (personal_story/empowerment/identification/agenda), ולפחות 3 מ-authority (lists/real_reason/how_to/discovery/one_shift/comparisons/day_in_life/challenge).
3. לכל זווית — בחר נושא ספציפי מהמחקר/קהל היעד (כלי, שיטה, כאב ספציפי, רצון). אסור גנרי.
4. השתמש בשפת הקהל מ-cross_audience_quotes ו-identity_statements.
5. הזווית צריכה להיות מובחנת — לא חפיפה בין שתי זוויות.
6. **הקפד על המכסה של הרעיונות המועדפים והוויראליים** — זו דרישה קשיחה, לא המלצה.

## פלט — קריטי!
⚠️ **התשובה שלך חייבת להיות JSON array בלבד.** ללא טקסט לפני או אחרי, ללא \`\`\`json fences, ללא הסברים, ללא כותרות markdown. **התו הראשון בתשובה חייב להיות \`[\` והאחרון \`]\`**. מערך של ${HOOK_COUNT} אובייקטים בדיוק:
[
  {
    "category": "myth_breaking" | "common_mistakes" | "diagnosis" | "personal_story" | "empowerment" | "identification" | "agenda" | "lists" | "real_reason" | "how_to" | "discovery" | "one_shift" | "comparisons" | "day_in_life" | "challenge",
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
          // 20 Hebrew plans × ~5 fields each = easily 6-8K output tokens once
          // character-heavy Hebrew is token-counted. 4096 was truncating the
          // JSON mid-string. 8192 is safely within Sonnet 4.6 + Haiku 4.5 caps.
          max_tokens: 8192,
          messages: [{ role: "user", content: planningPrompt }],
        })
        const text = res.content.find((b) => b.type === "text")?.text ?? ""
        const parsed = extractJsonArray(text)
        if (!parsed) {
          console.error(`Homepage Hooks: plan response not parseable. First 800 chars: ${text.slice(0, 800)}`)
          // Surface the first 300 chars so we can see it in the browser console
          // without hunting for server logs. Strip newlines so the error line
          // stays readable.
          const preview = text.slice(0, 300).replace(/\s+/g, " ").trim()
          throw new Error(`No JSON in plan response. Claude returned: ${preview}`)
        }
        return parsed as PlanItem[]
      }
      try {
        return { plans: await tryModel(PRIMARY_MODEL), fallback: false }
      } catch (err) {
        if (!isOverloadError(err)) throw err
        return { plans: await tryModel(FALLBACK_MODEL), fallback: true }
      }
    }

    // Try several strategies to recover a JSON array from Claude's response.
    // Returns null if nothing parses cleanly.
    function extractJsonArray(text: string): unknown[] | null {
      const trimmed = text.trim()
      // 1. Direct parse — cleanest case
      if (trimmed.startsWith("[")) {
        try { return JSON.parse(trimmed) } catch { /* fall through */ }
      }
      // 2. Strip ```json ... ``` fences
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (fenced) {
        try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
      }
      // 3. Find the widest [...] substring and try it
      const firstBracket = trimmed.indexOf("[")
      const lastBracket = trimmed.lastIndexOf("]")
      if (firstBracket >= 0 && lastBracket > firstBracket) {
        try { return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) } catch { /* fall through */ }
      }
      return null
    }

    // Parse the structured write-step response. Same tolerance as extractJsonArray
    // but for a single {...} object — writer may wrap in markdown or add prose.
    function parseDraftJson(text: string): { template_index?: number; slot_fills?: Record<string, string>; hook?: string } | null {
      const trimmed = text.trim()
      const attempts: string[] = []
      if (trimmed.startsWith("{")) attempts.push(trimmed)
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (fenced) attempts.push(fenced[1])
      const firstBrace = trimmed.indexOf("{")
      const lastBrace = trimmed.lastIndexOf("}")
      if (firstBrace >= 0 && lastBrace > firstBrace) attempts.push(trimmed.slice(firstBrace, lastBrace + 1))
      for (const attempt of attempts) {
        try { return JSON.parse(attempt) } catch { /* fall through */ }
      }
      return null
    }

    // Strip leading numbering / bullets / wrapping quotes / newlines from a raw hook.
    function cleanRawHook(text: string): string {
      return text
        .split("\n")[0]
        .trim()
        .replace(/^\d+[\.\)]\s*/, "")
        .replace(/^["'״׳"\-*•]+/, "")
        .replace(/["'״׳"]+$/, "")
        .trim()
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let hookCount = 0
        let usedFallback = false
        // Collected as hooks stream out, so we can batch-classify by product at the end.
        const generatedHooks: Array<{ id: string; text: string }> = []

        // Defensive wrapper: if the client navigated away, `controller.enqueue`
        // throws (controller is closed). We swallow it so the generation loop
        // continues to completion. DB inserts still happen; user sees the
        // full batch when they return to /hooks.
        let clientConnected = true
        const safeEnqueue = (chunk: Uint8Array) => {
          if (!clientConnected) return
          try {
            controller.enqueue(chunk)
          } catch {
            clientConnected = false
            console.log("Homepage Hooks: client disconnected — continuing generation on server")
          }
        }
        const safeClose = () => {
          if (!clientConnected) return
          try { controller.close() } catch { /* already closed */ }
        }

        try {
          // ============= STEP 1: PLANNING =============
          const { plans, fallback } = await planWithFallback()
          if (fallback) {
            usedFallback = true
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ model_fallback: true })}\n\n`))
          }
          console.log(`Homepage Hooks: planning done — ${plans.length} plans, fallback=${fallback}`)

          // ============= STEP 2: WRITING — parallel batches of 5, streamed as each completes =============
          // Pipeline per hook (runs concurrently in batches):
          //   write (structured JSON) → programmatic check → judge → polish → insert → stream
          //   If judge rewrite still fails programmatic check, skip the plan.
          //
          // Parallelizing cuts total time from ~12min (serial) to ~2min for 20 hooks.
          // Batch size 5 keeps us well under Anthropic tier-1 rate limits (4k req/min;
          // 5 plans × 3 Claude calls = 15 concurrent — safe).
          let skipped = 0
          // 10 × 3 concurrent Claude calls = 30 at peak, safely within Tier 1
          // Anthropic limits (4000 req/min, 80K in-tok/min; our burst ~30-40K).
          // If hitting 429s, drop back to 5-7.
          const BATCH_SIZE = 10

          interface DraftHook { template_index?: number; slot_fills?: Record<string, string>; hook?: string }

          const processOnePlan = async (plan: PlanItem, planIdx: number): Promise<void> => {
            const templates: HookTemplate[] = getTemplatesByCategorySorted(plan.category)
            if (templates.length === 0) return

            const highCount = templates.filter((t) => templatePriority(t) === "high").length
            const formatTemplatesForPrompt = () => templates.map((t, i) => {
              const tag = templatePriority(t) === "low" ? "  [עדיפות נמוכה — השתמש רק אם אין תבנית מתאימה יותר]" : ""
              return `${i}. ${templateText(t)}${tag}`
            }).join("\n")

            const writePrompt = `אתה כותב הוק אחד לסרטון קצר בעברית ישראלית. אתה **חייב** לבחור אחת מהתבניות ברשימה ולמלא את ה-slots שלה.

## הזווית
- **נושא:** ${plan.specific_topic}
- **כאב/רצון:** ${plan.target_pain_or_desire}
- **איך הקהל מדבר על זה:** "${plan.audience_quote}"
- **תיאור הזווית:** ${plan.angle_summary}

## תבניות (${highCount} הראשונות בעדיפות גבוהה, כלומר פותחות סקרנות — עדיף לבחור מהן):
${formatTemplatesForPrompt()}

## הכלל החשוב ביותר: פער סקרנות
ההוק **שומר את התשובה סגורה**. הוא מבטיח ערך, לא מוסר אותו. אם אחרי קריאה הקורא כבר יודע את התובנה — אין סיבה לצפות.
- ❌ "מעצבים שמפחדים מ-AI מפספסים מה שהוא לא יכול לעשות" — התשובה כבר שם.
- ✅ "3 דברים שAI עדיין לא יודע לעשות ב-2026" — מבטיח רשימה, לא מוסר אותה.
- ❌ "הסיבה שפוסטים לא מקבלים לייקים זה שהם לא קוראים" — נמסר.
- ✅ "הסיבה האמיתית שהפוסטים שלכם לא מקבלים לייקים — והיא לא מה שחשבתם" — לולאה.

## כללים נוספים
1. **אורך**: עד 15 מילים, משפט אחד.
2. **פניה לקהל ברבים בלבד** (אתם/לכם/שלכם). אסור לערבב יחיד ורבים באותו הוק.
3. **נושא + פועל תואמים** במין ובמספר.
4. **קונקרטי לנישה** — אזכר את המילה הספציפית מהנושא, לא גנרי.
5. **עברית ישראלית טבעית** — לא תרגום מאנגלית, לא מטאפורות מתורגמות.
6. **AI = זכר** ("הוא", "שיודע", לא "היא"/"שיודעת").

## פורמט הפלט — JSON בלבד
התו הראשון חייב להיות \`{\` והאחרון \`}\`. בלי markdown, בלי הסברים.

\`\`\`json
{
  "template_index": 0,
  "slot_fills": { "X": "3", "נושא": "Figma auto-layout" },
  "hook": "3 דברים ב-Figma auto-layout שחוסכים לכם שעה ביום"
}
\`\`\`

- \`template_index\` = מספר התבנית שבחרת (0-${templates.length - 1}).
- \`slot_fills\` = המילים שמילאת ב-slots (אובייקט).
- \`hook\` = ההוק המלא אחרי מילוי, בדיוק כפי שיוצג לקורא.`

            // Write the hook — Sonnet with Haiku overload fallback
            let draft: DraftHook | null = null
            const doCall = async (model: string) => {
              const res = await client.messages.create({
                model,
                max_tokens: 600,
                messages: [{ role: "user", content: writePrompt }],
              })
              const raw = res.content.find((b) => b.type === "text")?.text ?? ""
              draft = parseDraftJson(raw)
            }
            try {
              await doCall(usedFallback ? FALLBACK_MODEL : PRIMARY_MODEL)
            } catch (err) {
              if (!isOverloadError(err) || usedFallback) {
                skipped++
                console.warn(`Homepage Hooks: writer crashed for "${plan.specific_topic}":`, err)
                return
              }
              usedFallback = true
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ model_fallback: true })}\n\n`))
              await doCall(FALLBACK_MODEL)
            }

            if (!draft || !(draft as DraftHook).hook || typeof (draft as DraftHook).hook !== "string" || ((draft as DraftHook).hook!).trim().length <= 10) {
              skipped++
              console.warn(`Homepage Hooks: writer returned no usable hook for "${plan.specific_topic}" — skipping`)
              return
            }
            const d = draft as DraftHook
            let hookText = cleanRawHook(d.hook!)

            const templateIdx = Number.isInteger(d.template_index) ? d.template_index! : 0
            const chosenTemplate = templates[templateIdx] ?? templates[0]
            const chosenTemplateText = templateText(chosenTemplate)

            // Programmatic check — deterministic, cheap.
            let issues = validateHookLocally(hookText, plan.specific_topic)

            // Judge (Opus) — always. Catches curiosity-gap + logic failures code can't.
            const judgeResult = await judgeHook(client, {
              hook: hookText,
              template: chosenTemplateText,
              specificTopic: plan.specific_topic,
              targetPainOrDesire: plan.target_pain_or_desire,
              programmaticIssues: issues,
            })

            const judgeRewrote = !judgeResult.valid
            if (judgeRewrote) {
              console.log(`Homepage Hooks: judge rewrote "${hookText.slice(0, 40)}..." — issues: ${judgeResult.issues.join("; ")}`)
              hookText = judgeResult.rewritten
              issues = validateHookLocally(hookText, plan.specific_topic)
              if (issues.length > 0) {
                skipped++
                console.warn(`Homepage Hooks: skipping "${plan.specific_topic}" — judge rewrite still failed: ${issues.join(", ")}`)
                return
              }
            }

            if (hookText.length <= 10) { skipped++; return }

            // Polish only if judge accepted the original. When judge rewrote,
            // the Opus output is already clean natural Hebrew — running the
            // Sonnet polish on top is redundant and occasionally re-edits
            // something Opus got right.
            if (!judgeRewrote) {
              hookText = await polishHookForHebrew(client, hookText, PRIMARY_MODEL)
              if (hookText.length <= 10) { skipped++; return }
            }

            const { data: row } = await supabase.from("hooks").insert({
              user_id: userId,
              hook_text: hookText,
              display_order: planIdx, // plan order preserved even in parallel execution
              status: "completed",
              is_selected: false,
              is_used: false,
            } as Record<string, unknown>).select("id").single()

            const hookId = row?.id || crypto.randomUUID()
            generatedHooks.push({ id: hookId, text: hookText })
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              id: hookId,
              hook_text: hookText,
              is_used: false,
              created_at: new Date().toISOString(),
            })}\n\n`))
            hookCount++
          }

          // Run plans in batches of BATCH_SIZE, all plans in a batch concurrently.
          // Each batch waits for all its plans to finish before the next starts —
          // that keeps concurrent Claude calls bounded and the stream ordered by
          // batch (plans within a batch may arrive in any order, which is fine).
          for (let i = 0; i < plans.length && hookCount < HOOK_COUNT; i += BATCH_SIZE) {
            const batch = plans.slice(i, i + BATCH_SIZE)
            await Promise.all(batch.map((plan, j) => processOnePlan(plan, i + j)))
          }

          console.log(`Homepage Hooks: generation complete — ${hookCount} hooks streamed/inserted (${skipped} skipped as unrecoverable)`)

          // Batch-classify all generated hooks against the user's products.
          // One Haiku call, ~$0.01. Writes product_ids back to DB. Client
          // picks it up when it reloads via loadHooks() after [DONE].
          const productList = (products as Array<{ id: string; name: string; page_summary: string }> | null) ?? []
          if (generatedHooks.length > 0 && productList.length > 0) {
            try {
              const classification = await classifyHooksByProduct(client, {
                hooks: generatedHooks,
                products: productList.map((p) => ({ id: p.id, name: p.name, summary: p.page_summary })),
              })
              // Parallel DB updates — one per hook.
              await Promise.all(
                generatedHooks.map((h) => {
                  const productIds = classification[h.id] ?? []
                  return supabase
                    .from("hooks")
                    .update({ product_ids: productIds } as never)
                    .eq("id", h.id)
                }),
              )
              console.log(`Homepage Hooks: classified ${generatedHooks.length} hooks across ${productList.length} products`)
            } catch (err) {
              console.error("Homepage Hooks: classification failed — hooks ship without product tags:", err)
            }
          }

          safeEnqueue(encoder.encode("data: [DONE]\n\n"))
          safeClose()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Homepage Hooks: generation failed at hook ${hookCount} —`, msg)
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
          safeClose()
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
