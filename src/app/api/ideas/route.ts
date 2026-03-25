import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const yy = String(date.getFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Fetch ALL relevant data
    const [{ data: coreIdentity }, { data: audienceIdentity }, { data: products }] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("products").select("name, type, page_summary").eq("user_id", user.id),
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

    // Build product list — only use real products from the products table
    if (!products || products.length === 0) {
      return NextResponse.json(
        { error: "לא נמצאו מוצרים. הוסיפי מוצרים בהגדרות או באונבורדינג." },
        { status: 400 }
      )
    }

    const targetProducts = Array.from({ length: 4 }, (_, i) => products[i % products.length])

    const productsSection = targetProducts.map((p, i) => {
      let line = `${i + 1}. ${p.name} (${p.type === "front" ? "מוצר פרונט" : p.type === "premium" ? "מוצר פרימיום" : "מגנט לידים"})`
      if (p.page_summary) line += `\n   תיאור: ${p.page_summary}`
      return line
    }).join("\n")

    const audienceSection = audienceIdentity
      ? `
## קהל היעד
- כאבים יומיומיים: ${audienceIdentity.daily_pains}
- כאבים רגשיים: ${audienceIdentity.emotional_pains}
- פחדים: ${audienceIdentity.fears}
- אמונות מגבילות: ${audienceIdentity.limiting_beliefs}
- רצונות יומיומיים: ${audienceIdentity.daily_desires}
- רצונות רגשיים: ${audienceIdentity.emotional_desires}
- ציטוטים של הקהל: ${audienceIdentity.cross_audience_quotes}
- משפטי זהות: ${audienceIdentity.identity_statements}`
      : ""

    const prompt = `אתה יוצר תוכן מומחה לרשתות חברתיות בעברית.

## מי אני
${coreIdentity.who_i_am}

## הנישה שלי
${coreIdentity.niche}

## הטון שלי
${coreIdentity.how_i_sound}
${coreIdentity.slang_examples ? `סלנג: ${coreIdentity.slang_examples}` : ""}

## מה אני אף פעם לא עושה
${coreIdentity.what_i_never_do}
${audienceSection}

## המוצרים שלי
${productsSection}

## המשימה
צור בדיוק 4 רעיונות לתוכן לרשתות חברתיות — רעיון אחד לכל מוצר ברשימה למעלה, בסדר שלהם.

כללים:
- כל רעיון חייב להיות קשור ישירות למוצר הספציפי — לא רעיון כללי על הנישה
- השתמש בכאבים, פחדים, ורצונות של קהל היעד כדי ליצור רעיון שיגרום להם לעצור ולקרוא
- כתוב בסגנון hook — קצר, קליט, משפט אחד עד שניים
- השתמש בטון ובשפה של המשתמש
- הרעיונות צריכים להיות מגוונים — כל אחד מזווית אחרת (כאב, סקרנות, הפתעה, הבטחה)

החזר את התשובה בפורמט JSON בלבד, בלי שום טקסט נוסף:
[
  { "text": "הרעיון כאן", "productName": "שם המוצר בדיוק כפי שמופיע למעלה" },
  { "text": "הרעיון כאן", "productName": "שם המוצר בדיוק כפי שמופיע למעלה" },
  { "text": "הרעיון כאן", "productName": "שם המוצר בדיוק כפי שמופיע למעלה" },
  { "text": "הרעיון כאן", "productName": "שם המוצר בדיוק כפי שמופיע למעלה" }
]`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const raw = textBlock?.text ?? "[]"

    // Extract JSON array from response (handle potential markdown fencing)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    const parsed: { text: string; productName: string }[] = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : []

    const today = formatDate(new Date())

    const ideas = parsed.map((item) => ({
      text: item.text,
      productName: item.productName,
      date: today,
    }))

    return NextResponse.json({ ideas })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Ideas generation error:", message)
    return NextResponse.json(
      { error: `Failed to generate ideas: ${message}` },
      { status: 500 }
    )
  }
}
