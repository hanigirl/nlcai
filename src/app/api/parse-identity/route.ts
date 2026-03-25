import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import mammoth from "mammoth"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  CORE_IDENTITY_PARSE_PROMPT,
  AUDIENCE_IDENTITY_PARSE_PROMPT,
} from "@/lib/agents/identity-parser"

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  // txt, rtf, etc — read as plain text
  return file.text()
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const type = formData.get("type") as string // "core" or "audience"

    // Manual fields passed alongside the file
    const manualFields = formData.get("manualFields") as string | null
    const manual = manualFields ? JSON.parse(manualFields) : {}

    if (!type) {
      return NextResponse.json(
        { error: "type is required" },
        { status: 400 }
      )
    }

    let anthropicApiKey: string | null = null
    try {
      anthropicApiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (err) {
      console.error("API key lookup failed:", err instanceof Error ? err.message : err)
      // Key not connected — will skip AI parsing
    }

    let parsed: Record<string, string> = {}
    let aiError: string | null = null
    let fileText: string | null = null

    // Extract text from file (always, even without API key)
    if (file) {
      try {
        fileText = await extractText(file)
      } catch (err) {
        console.error("File text extraction failed:", err)
      }
    }

    // Parse with AI if we have both text and API key
    if (fileText) {
      if (!anthropicApiKey) {
        aiError = "Claude API key not connected"
      } else {
        try {
          const systemPrompt =
            type === "core"
              ? CORE_IDENTITY_PARSE_PROMPT
              : AUDIENCE_IDENTITY_PARSE_PROMPT

          const client = new Anthropic({ apiKey: anthropicApiKey })
          const message = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2048,
            messages: [
              {
                role: "user",
                content: `${systemPrompt}\n\n--- הטקסט ---\n${fileText}`,
              },
            ],
          })

          const textBlock = message.content.find((b) => b.type === "text")
          const raw = textBlock?.text ?? "{}"

          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0])
          }
        } catch (err) {
          aiError = err instanceof Error ? err.message : String(err)
          console.error("AI parsing failed, saving manual fields only:", aiError)
        }
      }
    }

    // Save to DB — manual fields take priority over parsed (non-empty manual fields won't be overwritten)
    if (type === "core") {
      const row = {
        user_id: user.id,
        niche: manual.niche || parsed.niche || "",
        product_name: manual.productName || parsed.productName || "",
        who_i_am: manual.whoIAm || parsed.whoIAm || "",
        who_i_serve: manual.whoIServe || parsed.whoIServe || "",
        how_i_sound: parsed.howISound || manual.howISound || "",
        slang_examples: parsed.slangExamples || manual.slangExamples || "",
        what_i_never_do: parsed.whatINeverDo || manual.whatINeverDo || "",
        ...(fileText ? { raw_file_text: fileText } : {}),
      }

      const { error } = await supabase
        .from("core_identities")
        .upsert(row as never, { onConflict: "user_id" })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ parsed: { ...parsed, ...manual }, saved: row, ...(aiError ? { warning: `הקובץ לא נותח (${aiError}), השדות הידניים נשמרו` } : {}) })
    } else {
      const row = {
        user_id: user.id,
        location: parsed.location ?? "",
        employment: parsed.employment ?? "",
        education: parsed.education ?? "",
        income: parsed.income ?? "",
        behavioral: parsed.behavioral ?? "",
        awareness_level: parsed.awarenessLevel ?? "",
        daily_pains: parsed.dailyPains ?? "",
        emotional_pains: parsed.emotionalPains ?? "",
        unresolved_consequences: parsed.unresolvedConsequences ?? "",
        fears: parsed.fears ?? "",
        failed_solutions: parsed.failedSolutions ?? "",
        limiting_beliefs: parsed.limitingBeliefs ?? "",
        myths: parsed.myths ?? "",
        daily_desires: parsed.dailyDesires ?? "",
        emotional_desires: parsed.emotionalDesires ?? "",
        small_wins: parsed.smallWins ?? "",
        ideal_solution: parsed.idealSolution ?? "",
        bottom_line: parsed.bottomLine ?? "",
        cross_audience_quotes: parsed.crossAudienceQuotes ?? "",
        ideal_solution_words: parsed.idealSolutionWords ?? "",
        identity_statements: parsed.identityStatements ?? "",
        ...(fileText ? { raw_file_text: fileText } : {}),
      }

      const { error } = await supabase
        .from("audience_identities")
        .upsert(row as never, { onConflict: "user_id" })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ parsed, saved: row, ...(aiError ? { warning: `הקובץ לא נותח (${aiError}), הנתונים לא נשמרו מהקובץ` } : {}) })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Parse identity error:", message)
    return NextResponse.json(
      { error: `Failed to parse file: ${message}` },
      { status: 500 }
    )
  }
}
