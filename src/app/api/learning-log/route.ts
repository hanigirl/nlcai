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

    // Fetch existing insights for this user + content type for dedup check
    const { data: existingLogs } = await supabase
      .from("learning_logs")
      .select("insight")
      .eq("user_id", user.id)
      .eq("content_type", contentType)
      .order("created_at", { ascending: false })
      .limit(30)

    const existingInsights = (existingLogs || []).map((l) => l.insight).filter(Boolean)
    const existingList = existingInsights.length
      ? existingInsights.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(אין תובנות קודמות)"

    const prompt = `אתה מנתח עריכות שמשתמש עשה לטקסט שנוצר על ידי AI.

## הטקסט המקורי (שה-AI יצר):
${originalText}

## הטקסט אחרי עריכת המשתמש:
${editedText}

## תובנות קיימות שכבר נשמרו על המשתמש הזה:
${existingList}

## משימה:
נתח מה המשתמש שינה ולמה, וגזור תובנה אחת קצרה בעברית (משפט אחד) על ההעדפה או הסגנון שלו.

לפני שאתה מחזיר את התובנה, בדוק האם היא כבר קיימת ברשימה למעלה — לא חיפוש מילולי אלא בדיקה מהותית. למשל "מעדיף הוקים קצרים" ו"מקצר את ה-hook" הן אותה תובנה.

## פלט (חובה אחד מהשניים):
- אם התובנה היא חדשה ולא מופיעה ברשימה → החזר את התובנה עצמה, משפט אחד בעברית, בלי גרשיים, בלי מספור.
- אם התובנה כבר קיימת ברשימה (מהותית) → החזר בדיוק את המילה: DUPLICATE`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const insight = textBlock?.text?.trim() ?? ""

    if (insight && insight !== "DUPLICATE") {
      await supabase.from("learning_logs").insert({
        user_id: user.id,
        content_type: contentType,
        original_text: originalText,
        edited_text: editedText,
        insight,
      })
      return NextResponse.json({ insight, duplicate: false })
    }

    return NextResponse.json({ insight: null, duplicate: insight === "DUPLICATE" })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Learning log error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
