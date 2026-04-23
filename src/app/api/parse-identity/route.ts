import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import mammoth from "mammoth"
import WordExtractor from "word-extractor"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  CORE_IDENTITY_PARSE_PROMPT,
  AUDIENCE_IDENTITY_PARSE_PROMPT,
} from "@/lib/agents/identity-parser"

type FileContent =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "unsupported"; message: string }

async function extractContent(file: File, buffer: Buffer): Promise<FileContent> {
  const name = file.name.toLowerCase()

  if (name.endsWith(".pdf")) {
    return { kind: "pdf", base64: buffer.toString("base64") }
  }

  if (name.endsWith(".docx")) {
    try {
      const result = await mammoth.extractRawText({ buffer })
      const text = result.value?.trim()
      if (!text) {
        return { kind: "unsupported", message: "הקובץ נראה ריק. נסו להעלות שוב." }
      }
      return { kind: "text", text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { kind: "unsupported", message: `לא הצלחנו לקרוא את קובץ ה-docx (${msg})` }
    }
  }

  if (name.endsWith(".doc")) {
    try {
      const extractor = new WordExtractor()
      const extracted = await extractor.extract(buffer)
      const text = extracted.getBody()?.trim()
      if (!text) {
        return { kind: "unsupported", message: "הקובץ נראה ריק. שמרו אותו כ-docx או pdf ונסו שוב." }
      }
      return { kind: "text", text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { kind: "unsupported", message: `לא הצלחנו לקרוא את קובץ ה-doc (${msg}). שמרו אותו כ-docx או pdf ונסו שוב.` }
    }
  }

  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".rtf")) {
    const text = buffer.toString("utf8").trim()
    if (!text) {
      return { kind: "unsupported", message: "הקובץ ריק." }
    }
    return { kind: "text", text }
  }

  return { kind: "unsupported", message: "פורמט לא נתמך. תומכים ב-pdf, docx, doc, txt, md." }
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
    let fileContent: FileContent | null = null
    let fileBuffer: Buffer | null = null

    // Extract content from file
    if (file) {
      fileBuffer = Buffer.from(await file.arrayBuffer())
      fileContent = await extractContent(file, fileBuffer)

      // Hard fail early when the file format is unreadable — user needs immediate feedback.
      if (fileContent.kind === "unsupported") {
        return NextResponse.json({ error: fileContent.message }, { status: 400 })
      }

      // Save original file to Supabase Storage
      try {
        const category = type === "core" ? "style_file" : "audience_file"
        const ext = file.name.split(".").pop() || "txt"
        const storagePath = `${user.id}/${category}/${crypto.randomUUID()}.${ext}`

        // Delete previous file in this category
        const { data: existing } = await supabase
          .from("user_media")
          .select("id, storage_path")
          .eq("user_id", user.id)
          .eq("category", category)
        if (existing && existing.length > 0) {
          await supabase.storage.from("user-media").remove(existing.map((e: { storage_path: string }) => e.storage_path))
          await supabase.from("user_media").delete().eq("user_id", user.id).eq("category", category)
        }

        // Upload new file
        await supabase.storage.from("user-media").upload(storagePath, fileBuffer, {
          contentType: file.type || "application/octet-stream",
        })

        // Record in user_media
        await supabase.from("user_media").insert({
          user_id: user.id,
          category,
          file_name: file.name,
          storage_path: storagePath,
          metadata: {},
        })
      } catch (err) {
        console.error("Failed to save original file to storage:", err)
        // Non-fatal — continue with parsing
      }
    }

    // Parse with AI
    if (fileContent) {
      if (!anthropicApiKey) {
        aiError = "Claude API key not connected"
      } else {
        try {
          const systemPrompt =
            type === "core"
              ? CORE_IDENTITY_PARSE_PROMPT
              : AUDIENCE_IDENTITY_PARSE_PROMPT

          const client = new Anthropic({ apiKey: anthropicApiKey })

          const userContent: Anthropic.ContentBlockParam[] =
            fileContent.kind === "pdf"
              ? [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: fileContent.base64,
                    },
                  },
                  { type: "text", text: systemPrompt },
                ]
              : [
                  {
                    type: "text",
                    text: `${systemPrompt}\n\n--- הטקסט ---\n${fileContent.text}`,
                  },
                ]

          const message = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            messages: [{ role: "user", content: userContent }],
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

    // raw_file_text is only available for text-based formats. For PDF we skip it;
    // reparse flow will need a reupload. That's an acceptable tradeoff since PDF
    // parsing via document block is reliable on the first pass.
    const rawFileText =
      fileContent?.kind === "text" ? fileContent.text : null

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
        ...(rawFileText ? { raw_file_text: rawFileText } : {}),
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
        ...(rawFileText ? { raw_file_text: rawFileText } : {}),
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
