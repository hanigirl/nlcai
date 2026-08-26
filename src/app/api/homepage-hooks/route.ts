import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { detectAudienceGender } from "@/lib/detect-addressing"
import { TEMPLATE_LIBRARY, getTemplatesByCategorySorted, templateText, templatePriority, type TemplateCategory, type HookTemplate } from "@/lib/agents/hook-templates"
import { judgeHook, validateHookLocally } from "@/lib/agents/hook-judge"
import { findNearDuplicate } from "@/lib/agents/hook-similarity"
import { classifyHooksByProduct } from "@/lib/agents/hook-product-classifier"
import { GeminiError, generateWithGeminiFallback, geminiErrorCode } from "@/lib/gemini"
import { usesGeminiHooks } from "@/lib/owner"

interface PlanItem {
  category: TemplateCategory
  specific_topic: string
  target_pain_or_desire: string
  audience_quote: string
  angle_summary: string
}
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { fetchBusinessSourceInsights } from "@/lib/business-source-insights"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"
import { withRetry } from "@/lib/supabase/retry"
import { getAuthUser } from "@/lib/auth-user"

// Streaming SSE pipeline (Claude plans the topics → Gemini writes one hook per
// plan). Vercel's 10s default cuts the stream mid-batch. 300s is the Pro plan
// ceiling; on Hobby Vercel silently caps to 60s.
export const maxDuration = 300

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
    // Optional product focus — when the user picks "לפי מוצר" on /hooks, the
    // whole batch is oriented around (and tagged with) this product.
    let selectedProductId: string | null = null
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
      if (typeof body.productId === "string" && body.productId.trim()) {
        selectedProductId = body.productId.trim()
      }
    } catch { /* no body */ }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const [{ data: coreIdentity }, { data: audienceIdentity }, { data: products }, { data: favoritedRows }, { data: existingHooks }, learningInsights, businessSourceInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("products").select("id, name, type, page_summary").eq("user_id", user.id),
      supabase.from("idea_favorites").select("idea_text").eq("user_id", user.id),
      // Pull recent hook inventory so the planner can avoid repeating
      // angles across successive generations. 50 is enough to cover several
      // batches without bloating the prompt.
      supabase.from("hooks").select("hook_text").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      fetchLearningInsights(supabase, user.id, "hook"),
      fetchBusinessSourceInsights(supabase, user.id),
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

    // Claude still runs the two steps that aren't hook writing: the topic plan
    // and the product classifier (plus the audience-gender probe). Gemini
    // writes every hook. Both keys are therefore required here.
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

    // Only the cohort needs a Gemini key; everyone else never reaches Gemini
    // and must not be blocked on a key they were never asked for.
    const geminiCohort = usesGeminiHooks(user.email)
    let geminiKey = ""
    if (geminiCohort) {
      try {
        geminiKey = await getUserApiKey(supabase, "gemini_api_key")
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === "gemini_not_connected") {
          return NextResponse.json({ error: "gemini_not_connected" }, { status: 400 })
        }
        return NextResponse.json({ error: msg }, { status: 500 })
      }
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
    // Generate angle plans: { category, angle, target_emotion, audience_quote, specific_topic }
    // Home page shows the first 4; the rest live in /hooks as the user's hook inventory.
    // Was dropped to 6 because the write→judge→polish chain blew the 60s
    // Vercel cap at 10 (504 in prod). That chain is now a single Gemini call
    // per hook, so the old reason no longer binds — left at 6 on purpose until
    // we've measured real Gemini latency and per-user rate limits.
    const HOOK_COUNT = 6

    // Flattened once: the per-hook duplicate check below runs inside a
    // parallel batch and must not re-map this list six times.
    const existingHookTexts = ((existingHooks as { hook_text: string }[] | null) ?? [])
      .map((h) => h.hook_text?.trim())
      .filter((t): t is string => !!t)

    const categoriesCatalog = TEMPLATE_LIBRARY
      .map((g) => `- ${g.category} (${g.contentType}, "${g.label}"): ${g.goal}`)
      .join("\n")

    // Hard quota — aggressive. User marked these as favorites, and their creator
    // viral posts are the highest-signal source. Plans should be saturated from
    // them before falling back to generic audience content.
    //   - Favorites: 2 plans per favorite, capped at HOOK_COUNT-3 so at least
    //     3 slots remain for other coverage.
    //   - Creator viral: fills whatever remains, up to their count.
    //   - Trends: pure top-up if creator content is thin.
    //   - Audience-only: the very last resort.
    const favoriteQuota = Math.min(favoriteIdeas.length * 2, Math.max(HOOK_COUNT - 3, 0))
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

    // Product focus — set when the user picked "לפי מוצר" on /hooks. Forces
    // every angle to orbit this product (soft promotion, not a hard sell).
    const selectedProduct = selectedProductId
      ? ((products as Array<{ id: string; name: string; type: string; page_summary: string | null }> | null) ?? []).find(
          (p) => p.id === selectedProductId,
        ) ?? null
      : null
    const productFocusSection = selectedProduct
      ? `\n## 🎯 מיקוד במוצר ספציפי — חובה!\nכל ${HOOK_COUNT} ההוקים חייבים להיכתב סביב המוצר/שירות הבא ולקדם אותו בעקיפין — לדבר אל הקהל שלו, לגעת בכאב/רצון שהוא פותר, ולפתוח סקרנות סביב הנושא שלו (בלי מכירה בוטה):\n- **שם המוצר:** ${selectedProduct.name} (${selectedProduct.type === "front" ? "מוצר פרונט" : selectedProduct.type === "premium" ? "מוצר פרימיום" : "מגנט לידים"})\n${selectedProduct.page_summary ? `- **תיאור:** ${selectedProduct.page_summary}\n` : ""}`
      : ""

    const planningPrompt = `אתה אסטרטג שיווק שמתכנן זוויות תוכן עבור יוצרי קונטנט בישראל.

## המטרה
לנתח את קהל היעד והמחקר מהשטח, ולהפיק ${HOOK_COUNT} זוויות שונות להוקים. כל זווית = רעיון מובחן עם קטגוריה + רגש + ציטוט מהקהל.

${identitySection}
${audienceSection}
${productsSection}
${businessSourceInsights || ""}
${trendContext ? `## מחקר מהשטח:\n${trendContext}\n` : ""}
${(existingHooks && existingHooks.length > 0) ? `
## 🚫 הוקים שכבר קיימים אצל המשתמש (אסור לחזור על אותם נושאים / זוויות!):
${(existingHooks as { hook_text: string }[]).slice(0, 50).map((h, i) => `${i + 1}. ${h.hook_text}`).join("\n")}

**זה קריטי**: עברתי על הרשימה. ה-${HOOK_COUNT} זוויות החדשות חייבות לפתוח **נושאים אחרים**, **זוויות אחרות**, **כאבים/רצונות אחרים** ממה שכבר קיים. אם זווית חדשה נראית דומה לאחת מהקיימות — תזרוק/י אותה ובחר/י משהו אחר. גיוון מהאינוונטר הקיים זה תנאי, לא המלצה.
` : ""}
${quotaSection}
${productFocusSection}
## קטגוריות הוקים זמינות (תבחר אחת לכל זווית):
${categoriesCatalog}

## הוראות
1. הפק ${HOOK_COUNT} זוויות שונות. **גוון קשיח בין הקטגוריות** — תכלול לפחות **3 קטגוריות שונות** מתוך 15 הקטגוריות הזמינות. אסור יותר מ-2 זוויות באותה קטגוריה (שומר על מגוון תבניות בכתיבה).
2. פיזור חובה: חייב לכלול לפחות 1 קטגוריה מ-awareness (myth_breaking/common_mistakes/diagnosis), לפחות 1 מ-connection (personal_story/empowerment/identification/agenda), ולפחות 1 מ-authority (lists/real_reason/how_to/discovery/one_shift/comparisons/day_in_life/challenge).
3. לכל זווית — בחר נושא ספציפי מהמחקר/קהל היעד (כלי, שיטה, כאב ספציפי, רצון). אסור גנרי.
4. השתמש בשפת הקהל מ-cross_audience_quotes ו-identity_statements.
5. הזווית צריכה להיות מובחנת — לא חפיפה בין שתי זוויות.
6. **הקפד על המכסה של הרעיונות המועדפים והוויראליים** — זו דרישה קשיחה, לא המלצה.
7. **בהירות עברית — דרישה קשיחה.** ה-\`specific_topic\` חייב להיות ביטוי שאנשים בנישה אומרים בעברית טבעית. **אסור:**
   - מושג אנגלי ללא תרגום מקובע ("AI Output", "Agent Lifecycle", "API Response") — אלה לא מילים שיוצא ספונטני להגיד.
   - תרגום מילולי מסורבל מאנגלית ("עיצוב מחזור חיי סוכן" = literal translation, לא ביטוי שמשתמשים בו).
   - ערבוב אנגלית-עברית באמצע משפט אלא אם המילה האנגלית באמת מוטמעת בשיח של הקהל (למשל Figma, Auto Layout, AI, Layout = בסדר; AI Output, Agent Output = לא בסדר).
   **המבחן:** אם תקרא/י את ה-specific_topic בקול לאדם מהנישה והוא יעצור לשאול "מה זה?" — תחליף/י את הנושא. אם אין נוסח טבעי בעברית למושג — תבחר/י זווית **אחרת לחלוטין**, לא תתרגם/י בכוח. אותו כלל חל על \`angle_summary\` ו-\`audience_quote\`.

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
    // Tight per-call timeout + lower retry count so a hung Anthropic request
    // (overload retry storm) can't stall the batch for the SDK's 10-minute
    // default. This client now only serves planning, the audience-gender probe
    // and the product classifier — the hook writing runs on Gemini.
    const client = new Anthropic({ apiKey, timeout: 90000, maxRetries: 1 })
    const userId = user.id

    // Homepage hooks have no user draft to detect an addressing gender from,
    // so the audience decides: women → feminine singular, men → masculine
    // singular, mixed/unclear → plural (the old always-plural behavior).
    // Resolved once per request and injected into the writer prompt — with the
    // judge and polish gone, that prompt is the only place it can be enforced.
    const audienceGenderSource = (audienceIdentity ?? {}) as Partial<
      Record<"identity_statements" | "cross_audience_quotes" | "employment" | "behavioral", string>
    >
    const audienceAddress =
      (await detectAudienceGender(
        apiKey,
        [
          audienceGenderSource.identity_statements,
          audienceGenderSource.cross_audience_quotes,
          audienceGenderSource.employment,
          audienceGenderSource.behavioral,
          (coreIdentity as { who_i_serve?: string } | null)?.who_i_serve,
        ]
          .filter(Boolean)
          .join("\n"),
      )) ?? "plural"
    const audienceAddressLabel =
      audienceAddress === "feminine"
        ? "נקבה יחידה (את/לך/שלך/תעשי)"
        : audienceAddress === "masculine"
          ? "זכר יחיד (אתה/לך/שלך/תעשה)"
          : "לשון רבים (אתם/לכם/שלכם)"

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
        // saveFailures counts hooks the AI produced but the DB refused to
        // store even after retries — we surface this separately at end-of-
        // stream so the client can show "X hooks failed to save". This is
        // distinct from `skipped`, which counts AI-quality drops the user
        // doesn't need to know about.
        let saveFailures = 0
        // Set when any writer call comes back 429. Gemini keys are per-user and
        // free-tier limits are low, so "fewer hooks than expected" is far more
        // often rate limiting than model quality — the client needs to be told.
        let quotaHit = false
        // One engine announcement per batch, from the first writer that
        // actually succeeds — that's the only point where the model in use is
        // known for certain rather than assumed.
        let engineReported = false
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

          // ============= STEP 2: WRITING — parallel batches, streamed as each completes =============
          // Pipeline per hook (runs concurrently in batches):
          //   write on Gemini (structured JSON) → programmatic check (log only)
          //   → insert → stream
          //
          // The judge and polish rounds that used to sit between the write and
          // the insert are gone; a plan is now one model call, not three.
          let skipped = 0
          // Claude path: 10 plans × 3 calls = 30 concurrent, safely within
          // Tier 1 Anthropic limits — the number this route has always used.
          // Gemini path: 5, because Gemini keys are per-user and a free key
          // allows only a handful of requests per minute.
          const BATCH_SIZE = geminiCohort ? 5 : 10

          interface DraftHook { template_index?: number; slot_fills?: Record<string, string>; hook?: string }

          // Boundary wrapper: any unexpected throw inside a single plan
          // (writer fallback that throws non-overload, DB error, etc.) must NOT
          // crash the surrounding `Promise.all` and stall the stream after a
          // partial batch. We swallow the error, increment `skipped`, and let
          // the rest of the batch finish.
          const processOnePlan = async (plan: PlanItem, planIdx: number): Promise<void> => {
            try {
              await processOnePlanUnsafe(plan, planIdx)
            } catch (err) {
              skipped++
              const msg = err instanceof Error ? err.message : String(err)
              console.warn(`Homepage Hooks: plan "${plan.specific_topic}" crashed unexpectedly — ${msg}`)
            }
          }

          const processOnePlanUnsafe = async (plan: PlanItem, planIdx: number): Promise<void> => {
            const templates: HookTemplate[] = getTemplatesByCategorySorted(plan.category)
            if (templates.length === 0) return

            const highCount = templates.filter((t) => templatePriority(t) === "high").length
            const formatTemplatesForPrompt = () => templates.map((t, i) => {
              const tag = templatePriority(t) === "low" ? "  [עדיפות נמוכה — השתמש רק אם אין תבנית מתאימה יותר]" : ""
              return `${i}. ${templateText(t)}${tag}`
            }).join("\n")

            const writePrompt = `אתה כותב הוק אחד לסרטון קצר בעברית ישראלית.

## הזווית
- **נושא:** ${plan.specific_topic}
- **כאב/רצון:** ${plan.target_pain_or_desire}
- **איך הקהל מדבר על זה:** "${plan.audience_quote}"
- **תיאור הזווית:** ${plan.angle_summary}

## מה הופך הוק לטוב — שלוש העמודות
ההוק חייב להחזיק את כל השלוש. אם הוא נכשל באחת — שכתב.

### 1. נוגע בכאב/רצון ספציפי של הקהל
לא כאב גנרי. הכאב/רצון הספציפי מהזווית למעלה — הקורא חייב להרגיש "זה אני, זה בדיוק מה שעובר עליי".

### 2. מעורר סקרנות אמיתית
לולאה פתוחה במוח של הקורא — שאלה שדורשת תשובה, הבטחה שדורשת אימות, סתירה שדורשת הסבר. הקורא חייב להרגיש *צורך* לדעת מה הלאה.

### 3. הפאנץ׳ **לא** בתוך ההוק (הכלל הקריטי)
ההוק **מבטיח** ערך — לא **מוסר** אותו. אם אחרי קריאת ההוק הקורא כבר יודע את התובנה/התשובה/הטיפ — אין שום סיבה לצפות בסרטון.
- ❌ "מעצבים שמפחדים מ-AI מפספסים מה שהוא לא יכול לעשות" — התזה כבר שם.
- ✅ "3 דברים שAI עדיין לא יודע לעשות ב-2026" — מבטיח רשימה, לא מוסר אותה.
- ❌ "הסיבה שפוסטים לא מקבלים לייקים זה שהם לא קוראים" — נמסר.
- ✅ "הסיבה האמיתית שהפוסטים שלכם לא מקבלים לייקים — והיא לא מה שחשבתם" — לולאה.

**מבחן הפאנץ׳**: אם הקורא יכול לסגור את האפליקציה אחרי ההוק ולפעול לפי מה שכתוב בו — הפאנץ׳ דלף החוצה. שכתב.

## תבניות לעזר — לא חובה!
התבניות למטה הן מסגרות מוכחות שעוזרות לפתוח סקרנות. **מותר לבחור מהן, ומותר *לא* לבחור.** אם יש לך זווית או ניסוח חזק יותר שעומד בשלוש העמודות בצורה טובה יותר — כתוב אותו ישירות (free-form). אל תכופף הוק חזק לתוך תבנית מוחלשת.

תבניות זמינות (${highCount} הראשונות בעדיפות גבוהה — נוטות לפתוח סקרנות בצורה טובה):
${formatTemplatesForPrompt()}

## כללים נוספים
1. **אורך**: עד 15 מילים, משפט אחד.
2. **פניה לקהל ב${audienceAddressLabel} בלבד** — זה גוף הפנייה של הקהל של המשתמש. התבניות כתובות ברבים — המר אותן לגוף הזה. אסור לערבב גופים באותו הוק.
3. **נושא + פועל תואמים** במין ובמספר.
4. **המילה הספציפית מהנושא חייבת להופיע בהוק** — קח לפחות מילה אחת משמעותית (3+ אותיות, לא מילת קישור) מתוך \`${plan.specific_topic}\` ושים אותה בהוק עצמו, מילה במילה. זה תקף **גם** ב-free-form. בלי זה ההוק נדחה אוטומטית כ-off_topic.
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

- \`template_index\` = מספר התבנית שבחרת (0-${templates.length - 1}). אם כתבת **free-form** בלי תבנית — שים \`-1\`.
- \`slot_fills\` = המילים שמילאת ב-slots (אובייקט). ב-free-form אפשר אובייקט ריק \`{}\`.
- \`hook\` = ההוק המלא, בדיוק כפי שיוצג לקורא. **זה השדה היחיד שמשנה לקורא — ההוק עצמו חייב לעמוד בשלוש העמודות, גם אם בחרת free-form.**`

            let draft: DraftHook | null = null
            let rawText = ""

            if (geminiCohort) {
              // Gemini Pro with a Flash overload fallback.
              //
              // 16384, not 4096: Pro's thinking is billed against this same
              // budget, so a tight cap doesn't shorten the hook, it truncates
              // the JSON mid-object and the whole plan gets dropped. At 4096
              // roughly half of every batch was disappearing this way. The
              // hook itself is one sentence — the headroom is entirely for
              // thinking, and unused budget costs nothing.
              try {
                const { text: raw, fallback, model } = await generateWithGeminiFallback(geminiKey, {
                  prompt: writePrompt,
                  maxOutputTokens: 16384,
                  thinkingLevel: "high",
                })
                // Report the model by name, once per batch. We spent a whole
                // session concluding "no fallback banner, therefore Pro" and
                // were wrong — every hook had come from Flash. Absence of a
                // warning is not evidence; the engine has to say what it is.
                if (!engineReported) {
                  engineReported = true
                  console.log(`Homepage Hooks: writing with ${model}`)
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ engine: model })}\n\n`))
                }
                if (fallback && !usedFallback) {
                  usedFallback = true
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ model_fallback: true })}\n\n`))
                }
                rawText = raw
                draft = parseDraftJson(raw)
              } catch (err) {
                // A quota error means the user's Gemini plan is rate-limiting
                // the batch — every remaining plan will hit it too, so record
                // it and report it once at end-of-stream rather than silently
                // shipping a short batch.
                if (err instanceof GeminiError && err.code === "quota") quotaHit = true
                skipped++
                console.warn(`Homepage Hooks: Gemini writer failed for "${plan.specific_topic}":`, err)
                return
              }
            } else {
              // Unchanged Claude path — Sonnet with a Haiku overload fallback.
              const doCall = async (model: string) => {
                const res = await client.messages.create({
                  model,
                  max_tokens: 600,
                  messages: [{ role: "user", content: writePrompt }],
                })
                rawText = res.content.find((b) => b.type === "text")?.text ?? ""
                draft = parseDraftJson(rawText)
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
            }

            if (!draft || !(draft as DraftHook).hook || typeof (draft as DraftHook).hook !== "string" || ((draft as DraftHook).hook!).trim().length <= 10) {
              skipped++
              // Log the raw response, not just "no usable hook". Half a batch
              // was vanishing here with no way to tell truncated JSON apart
              // from a model that answered in prose — the tail of the text is
              // what distinguishes them (a cut-off object ends mid-string).
              const tail = rawText.slice(-200).replace(/\s+/g, " ").trim()
              console.warn(
                `Homepage Hooks: writer returned no usable hook for "${plan.specific_topic}" — ` +
                `${rawText.length} chars, parsed=${draft ? "yes" : "no"}. Tail: …${tail}`,
              )
              return
            }
            const d = draft as DraftHook
            let hookText = cleanRawHook(d.hook!)

            // Programmatic check — deterministic, cheap, and code rather than
            // a model, so it runs on both paths. What differs is the
            // consequence: on the Claude path it feeds the judge and can drop
            // a hook, on the Gemini path it only logs, so a cohort batch shows
            // exactly what the model produced instead of quietly shrinking.
            let issues = validateHookLocally(hookText, plan.specific_topic)
            // The planner is told to avoid the user's existing hooks, but the
            // writer that produces the sentence never sees them — so a fresh
            // angle can still land on an old phrasing. Checked here, where the
            // judge that already runs can act on it for free.
            const repeated = findNearDuplicate(hookText, existingHookTexts)
            if (repeated) issues.push(`repeats_existing_hook: "${repeated}"`)

            if (geminiCohort) {
              if (issues.length > 0) {
                console.log(`Homepage Hooks: [gemini-raw] "${hookText}" would have been flagged: ${issues.join(", ")}`)
              }
            } else {
              const templateIdx = Number.isInteger(d.template_index) ? d.template_index! : 0
              const isFreeForm = templateIdx < 0
              const chosenTemplate = isFreeForm ? null : (templates[templateIdx] ?? templates[0])
              const chosenTemplateText = chosenTemplate ? templateText(chosenTemplate) : "free-form (ללא תבנית)"

              // Judge (Opus) — always. Catches curiosity-gap + logic failures code can't.
              const judgeResult = await judgeHook(client, {
                hook: hookText,
                template: chosenTemplateText,
                specificTopic: plan.specific_topic,
                targetPainOrDesire: plan.target_pain_or_desire,
                programmaticIssues: issues,
                addressGender: audienceAddress,
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

              // No polish pass — same reasoning as /api/hooks. It only ever
              // ran on hooks the judge ACCEPTED, and acceptance already means
              // the judge passed question 5, "is this natural, error-free
              // Hebrew". Re-editing certified text cost a Sonnet call per hook
              // and occasionally undid something the judge got right.
            }

            if (hookText.length <= 10) { skipped++; return }

            // Pre-generate the id so retries are idempotent: if attempt 1
            // committed but the response was lost, attempt 2 fails with a
            // unique-violation that withRetry treats as success rather than
            // creating a duplicate row.
            const hookId = crypto.randomUUID()
            const { error: insertError } = await withRetry(() =>
              supabase.from("hooks").insert({
                id: hookId,
                user_id: userId,
                hook_text: hookText,
                display_order: planIdx, // plan order preserved even in parallel execution
                status: "completed",
                is_selected: false,
                is_used: false,
              } as Record<string, unknown>),
            )

            if (insertError) {
              saveFailures++
              console.error(`Homepage Hooks: insert failed after retries for "${hookText.slice(0, 40)}..." — ${insertError.message}`)
              return
            }

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
          if (selectedProductId && generatedHooks.length > 0) {
            // Explicit product focus — tag every hook with the chosen product
            // directly and skip the auto-classifier (we already know it).
            const pid = selectedProductId
            const updateResults = await Promise.all(
              generatedHooks.map((h) =>
                withRetry(() =>
                  supabase
                    .from("hooks")
                    .update({ product_ids: [pid] } as never)
                    .eq("id", h.id),
                ),
              ),
            )
            const failedExplicit = updateResults.filter((r) => r.error).length
            if (failedExplicit > 0) {
              console.error(`Homepage Hooks: ${failedExplicit}/${generatedHooks.length} explicit product-tag updates failed after retries`)
            }
            console.log(`Homepage Hooks: tagged ${generatedHooks.length} hooks with chosen product ${pid}`)
          } else if (generatedHooks.length > 0 && productList.length > 0) {
            try {
              const classification = await classifyHooksByProduct(client, {
                hooks: generatedHooks,
                products: productList.map((p) => ({ id: p.id, name: p.name, summary: p.page_summary })),
              })
              // Parallel DB updates — one per hook. Retry transient errors
              // so a network blip doesn't strip product tags off a hook.
              const updateResults = await Promise.all(
                generatedHooks.map((h) => {
                  const productIds = classification[h.id] ?? []
                  return withRetry(() =>
                    supabase
                      .from("hooks")
                      .update({ product_ids: productIds } as never)
                      .eq("id", h.id),
                  )
                }),
              )
              const failedUpdates = updateResults.filter((r) => r.error).length
              if (failedUpdates > 0) {
                console.error(`Homepage Hooks: ${failedUpdates}/${generatedHooks.length} product-tag updates failed after retries`)
              }
              console.log(`Homepage Hooks: classified ${generatedHooks.length} hooks across ${productList.length} products`)
            } catch (err) {
              console.error("Homepage Hooks: classification failed — hooks ship without product tags:", err)
            }
          }

          if (saveFailures > 0) {
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ save_failures: saveFailures })}\n\n`))
          }
          // Deliberately NOT sent as `error`: the client treats any `error`
          // frame as fatal and skips the success path (cache clear + done
          // listeners). A quota hit is partial — the hooks that did make it
          // through are real and must land normally.
          if (quotaHit) {
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ gemini_quota_warning: true })}\n\n`))
          }
          safeEnqueue(encoder.encode("data: [DONE]\n\n"))
          safeClose()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Homepage Hooks: generation failed at hook ${hookCount} —`, msg)
          const isCredits = /credit|billing|insufficient_quota|payment|402/i.test(msg)
          const isOverloaded = /overloaded|529|503/i.test(msg)
          const errCode =
            geminiErrorCode(err) ||
            (isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : msg)
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: errCode })}\n\n`))
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
