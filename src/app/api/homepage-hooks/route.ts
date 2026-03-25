import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { GREAT_HOOKS_EXAMPLES } from "@/lib/agents/great-hooks"
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"

const USE_DUMMY = false

export async function POST() {
  try {
    if (USE_DUMMY) {
      return NextResponse.json({ hooks: DUMMY_HOOKS })
    }

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

    const prompt = `אתה סוכן מומחה ביצירת הוקים ויראליים לתוכן קצר (Shorts, Reels, TikTok).

## המשימה שלך
צור 20 הוקים ויראליים עבור המשתמש, מבוססים על ה-Core Identity, קהל היעד, והמוצרים שלו.

**חשוב מאוד: כל הוק חייב לגעת בנושא אחר שמעסיק את קהל היעד.**
אל תחזור על אותו רעיון, אותה זווית, או אותו מוצר/כלי פעמיים.
קרא בעיון את ה-Audience Identity — הכאבים, הפחדים, הרצונות, האמונות המגבילות, והמיתוסים — וצור הוק אחד לכל נקודה שונה.

4 ההוקים הראשונים חייבים לכסות 4 נושאים שונים לחלוטין מחיי קהל היעד, למשל:
- הוק 1: כאב יומיומי ספציפי של הקהל
- הוק 2: אמונה מגבילה או מיתוס שהקהל מחזיק
- הוק 3: רצון או חלום שהקהל שואף אליו
- הוק 4: פחד או חשש שעוצר את הקהל מלהתקדם

${identitySection}
${audienceSection}
${productsSection}
## הנחיות ליצירת הוקים
1. **העדף להשתמש בתבניות מהדוגמאות למטה** — התאם אותן לנישה, לקהל, ולסגנון של המשתמש
2. **4 ההוקים הראשונים חייבים להיות מ-4 זוויות שונות** שמושכות את קהל היעד לקרוא עוד (למשל: כאב, סקרנות, הפתעה, הבטחה). בחר את הזוויות שהכי רלוונטיות לקהל הספציפי הזה
3. הוקים בסגנון טיקטוקי/יוטיוב שורטס: מבטיחים טריק, סוד, או קיצור דרך
4. מנוסחים חד וברור סביב חיסכון ענק בכסף, בזמן, באנרגיה
5. קצרים ופאנצ'יים — משפט אחד עד שניים מקסימום
6. כתוב בעברית, בגובה העיניים, בשפה יומיומית
7. השתמש בטון ובסגנון של המשתמש לפי ה-Core Identity שלו
8. אל תשתמש בדפוסים שהמשתמש ציין ב"מה אני אף פעם לא עושה"
9. התאם את ההוקים לקהל היעד — דבר על הכאבים, הפחדים, והרצונות שלהם

## דוגמאות לתבניות הוקים מעולים — העדף להשתמש בהן ולהתאים לנישה של המשתמש:
${GREAT_HOOKS_EXAMPLES}

${learningInsights}
## פלט
החזר בדיוק 20 הוקים, כל אחד בשורה אחת בלבד.
כל הוק חייב להיות משפט שלם ומוגמר — אסור שהוק ייקטע באמצע.
אל תוסיף מספור, תבליטים, מקפים, או הסברים — רק את הטקסט של ההוק עצמו.
אל תשבור הוק ל-2 שורות — הכל בשורה אחת.`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    })

    if (message.stop_reason === "max_tokens") {
      console.warn("Homepage hooks: response was truncated by max_tokens")
    }

    const textBlock = message.content.find((b) => b.type === "text")
    const hooks = (textBlock?.text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 10)
      .filter((line) => !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*"))
      .map((line) => line.replace(/^\d+[\.\)]\s*/, ""))
      .slice(0, 20)

    // Save hooks to database
    if (hooks.length > 0) {
      const hookRows = hooks.map((text: string, i: number) => ({
        user_id: user.id,
        hook_text: text,
        display_order: i,
        status: "completed",
        is_selected: false,
        is_used: false,
      }))
      const { error: insertError } = await supabase.from("hooks").insert(hookRows as Record<string, unknown>[])
      if (insertError) {
        console.error("Failed to save hooks to DB:", insertError.message)
      }
    }

    return NextResponse.json({ hooks })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Homepage hooks error:", msg)
    return NextResponse.json(
      { error: `Failed to generate hooks: ${msg}` },
      { status: 500 }
    )
  }
}
