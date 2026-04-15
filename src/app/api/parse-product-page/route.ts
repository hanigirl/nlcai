import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

const PRODUCT_PAGE_PROMPT = `אתה סוכן שמנתח דפי מכירה של מוצרים דיגיטליים.

קרא את הטקסט הבא שחולץ מדף מכירה, וכתוב סיכום קצר וממוקד בעברית שכולל:
1. מה המוצר ומה הוא כולל
2. לאיזה כאבים ובעיות הוא בא לפתור
3. מה ההבטחה המרכזית ללקוח
4. למי המוצר מיועד

כתוב בפסקה אחת עד שתיים, בלי כותרות, בלי bullet points. תן סיכום שמאפשר ליוצר תוכן להבין את המוצר ולכתוב עליו תוכן שיווקי.`

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { url, productId } = (await req.json()) as {
      url: string
      productId: string
    }

    if (!url || !productId) {
      return NextResponse.json(
        { error: "url and productId are required" },
        { status: 400 }
      )
    }

    // Fetch page content
    let pageText: string
    try {
      // Detect Google Docs links and export as plain text
      const googleDocMatch = url.match(
        /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/
      )
      const fetchUrl = googleDocMatch
        ? `https://docs.google.com/document/d/${googleDocMatch[1]}/export?format=txt`
        : url

      const res = await fetch(fetchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Postudio/1.0; +https://postudio.app)",
        },
      })
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch page: ${res.status}` },
          { status: 400 }
        )
      }

      if (googleDocMatch) {
        // Google Docs export gives clean text
        pageText = (await res.text()).trim().slice(0, 15000)
      } else {
        const html = await res.text()
        // Strip HTML tags, scripts, styles — extract visible text
        pageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 15000)
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Cannot access URL: ${err instanceof Error ? err.message : err}` },
        { status: 400 }
      )
    }

    if (!pageText || pageText.length < 50) {
      return NextResponse.json(
        { error: "Page has too little text content" },
        { status: 400 }
      )
    }

    // Get API key
    let anthropicApiKey: string
    try {
      anthropicApiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      // No API key — save raw text for later
      await supabase
        .from("products")
        .update({ landing_page_url: url } as never)
        .eq("id", productId)
        .eq("user_id", user.id)

      return NextResponse.json({
        summary: null,
        warning: "Claude API key not connected — הלינק נשמר, הניתוח יתבצע כשתחבר/י API key",
      })
    }

    // Analyze with AI
    const client = new Anthropic({ apiKey: anthropicApiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${PRODUCT_PAGE_PROMPT}\n\n--- תוכן הדף ---\n${pageText}`,
        },
      ],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const summary = textBlock?.text ?? ""

    // Save to DB
    await supabase
      .from("products")
      .update({ landing_page_url: url, page_summary: summary } as never)
      .eq("id", productId)
      .eq("user_id", user.id)

    return NextResponse.json({ summary })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Parse product page error:", msg)
    return NextResponse.json(
      { error: `Failed to parse product page: ${msg}` },
      { status: 500 }
    )
  }
}
