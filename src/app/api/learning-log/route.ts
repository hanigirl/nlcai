import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { originalText, editedText, contentType } = await req.json() as {
      originalText: string
      editedText: string
      contentType: "hook" | "core_post"
    }

    if (!originalText || !editedText || !contentType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // Skip if only whitespace changes
    if (originalText.trim() === editedText.trim()) {
      return NextResponse.json({ insight: null })
    }

    let apiKey: string
    try {
      apiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      return NextResponse.json({ error: "anthropic_not_connected" }, { status: 400 })
    }

    const prompt = `אתה מנתח עריכות שמשתמש עשה לטקסט שנוצר על ידי AI.

## הטקסט המקורי (שה-AI יצר):
${originalText}

## הטקסט אחרי עריכת המשתמש:
${editedText}

## משימה:
נתח מה המשתמש שינה ולמה. החזר תובנה אחת קצרה בעברית (משפט אחד בלבד) שמתארת את ההעדפה או הסגנון של המשתמש.

דוגמאות לפלט:
- המשתמש מעדיף הוקים קצרים יותר
- המשתמש הוריד מילות מעבר מהפוסט
- המשתמש מעדיף פנייה ישירה לקורא
- המשתמש הוסיף דוגמה אישית מהניסיון שלו

החזר רק את התובנה — בלי הסברים, בלי מספור, בלי גרשיים.`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const insight = textBlock?.text?.trim() ?? ""

    if (insight) {
      await supabase.from("learning_logs").insert({
        user_id: user.id,
        content_type: contentType,
        original_text: originalText,
        edited_text: editedText,
        insight,
      })
    }

    return NextResponse.json({ insight })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Learning log error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
