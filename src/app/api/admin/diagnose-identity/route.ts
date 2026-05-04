import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient, isAdminEmail } from "@/lib/supabase/admin"
import {
  CORE_IDENTITY_PARSE_PROMPT,
  AUDIENCE_IDENTITY_PARSE_PROMPT,
} from "@/lib/agents/identity-parser"
import { anthropicErrorToHebrew } from "@/lib/anthropic-errors"
import { extractFileContent, type FileContent } from "@/lib/extract-file-content"
import { extractFirstJsonObject } from "@/lib/extract-first-json"

// Re-parsing PDFs/docx via Claude is the slow path; align with parse-identity.
export const maxDuration = 60

type Type = "core" | "audience"

export async function POST(req: NextRequest) {
  // 1. Gate: only Hani.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId, type, save } = (await req.json()) as {
    userId: string
    type: Type
    save?: boolean
  }
  if (!userId || (type !== "core" && type !== "audience")) {
    return NextResponse.json(
      { error: "userId and type ('core' | 'audience') are required" },
      { status: 400 }
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    )
  }

  // 2. Pull target user state.
  const [{ data: userRow }, { data: identityRow }, { data: mediaRows }] =
    await Promise.all([
      admin
        .from("users")
        .select("anthropic_api_key")
        .eq("id", userId)
        .single(),
      admin
        .from(type === "core" ? "core_identities" : "audience_identities")
        .select("*")
        .eq("user_id", userId)
        .single(),
      admin
        .from("user_media")
        .select("category, file_name, storage_path, created_at")
        .eq("user_id", userId)
        .eq("category", type === "core" ? "style_file" : "audience_file")
        .order("created_at", { ascending: false }),
    ])

  const anthropicKey = (userRow as { anthropic_api_key: string | null } | null)
    ?.anthropic_api_key ?? null
  const rawText =
    (identityRow as Record<string, string | null> | null)?.raw_file_text ?? null

  const diagnosis: Record<string, unknown> = {
    user_id: userId,
    type,
    has_anthropic_key: !!anthropicKey,
    has_identity_row: !!identityRow,
    raw_text_length: rawText?.length ?? 0,
    raw_text_preview: rawText ? rawText.slice(0, 300) : null,
    media_files: mediaRows ?? [],
  }

  if (!anthropicKey) {
    return NextResponse.json({
      ...diagnosis,
      verdict: "no_anthropic_key",
      message: "למשתמשת אין מפתח Anthropic מחובר. היא צריכה לחבר אותו ב-Settings.",
    })
  }

  // If we don't have raw_file_text, try to re-parse the original file from
  // storage. This recovers users whose first parse failed silently (e.g., the
  // model returned multiple JSON objects so the regex-based extractor blew up
  // and the row was never written) without forcing them to re-upload.
  let fileContent: FileContent | null = null
  let recoveredText: string | null = null
  let storageError: string | null = null

  if (!rawText) {
    const latestFile = (mediaRows ?? [])[0] as
      | { file_name: string; storage_path: string }
      | undefined

    if (!latestFile) {
      return NextResponse.json({
        ...diagnosis,
        verdict: "no_raw_text",
        message:
          "אין טקסט שמור ולא נמצא קובץ ב-storage. צריך להעלות קובץ זהות מחדש.",
      })
    }

    try {
      const { data: blob, error: dlErr } = await admin.storage
        .from("user-media")
        .download(latestFile.storage_path)
      if (dlErr || !blob) {
        storageError = dlErr?.message ?? "download returned empty blob"
      } else {
        const buf = Buffer.from(await blob.arrayBuffer())
        fileContent = await extractFileContent(latestFile.file_name, buf)
        if (fileContent.kind === "text") {
          recoveredText = fileContent.text
        } else if (fileContent.kind === "unsupported") {
          storageError = fileContent.message
        }
      }
    } catch (err) {
      storageError = err instanceof Error ? err.message : String(err)
    }

    if (storageError && !fileContent) {
      return NextResponse.json({
        ...diagnosis,
        verdict: "storage_fetch_failed",
        message: `לא הצלחנו להוריד את הקובץ מהאחסון: ${storageError}`,
      })
    }

    diagnosis.recovered_from_storage = true
    diagnosis.recovered_file_name = latestFile.file_name
    diagnosis.recovered_text_length = recoveredText?.length ?? 0
  }

  // 3. Re-run the AI call and capture everything.
  // Source of truth, in order: stored raw_file_text → re-parsed text → PDF blob.
  const systemPrompt =
    type === "core" ? CORE_IDENTITY_PARSE_PROMPT : AUDIENCE_IDENTITY_PARSE_PROMPT
  const client = new Anthropic({ apiKey: anthropicKey })

  let rawResponse = ""
  let parseError: string | null = null
  let parsed: Record<string, string> = {}
  let claudeError: string | null = null
  let stopReason: string | null = null

  const textForClaude = rawText ?? recoveredText
  const userContent: Anthropic.ContentBlockParam[] = textForClaude
    ? [{ type: "text", text: `${systemPrompt}\n\n--- הטקסט ---\n${textForClaude}` }]
    : fileContent?.kind === "pdf"
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
      : []

  if (userContent.length === 0) {
    return NextResponse.json({
      ...diagnosis,
      verdict: "no_input_for_claude",
      message: "לא היה טקסט ולא PDF להעביר ל-Claude.",
    })
  }

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: userContent }],
    })
    stopReason = message.stop_reason ?? null
    const textBlock = message.content.find((b) => b.type === "text")
    rawResponse = textBlock?.text ?? ""
    const jsonStr = extractFirstJsonObject(rawResponse)
    if (jsonStr) {
      try {
        parsed = JSON.parse(jsonStr)
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err)
      }
    } else {
      parseError = "no_json_block_in_response"
    }
  } catch (err) {
    claudeError = err instanceof Error ? err.message : String(err)
  }

  const filledFields = Object.entries(parsed).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0
  ).length

  // 4. If asked, save the parsed data back so the user is unblocked.
  let saved = false
  let saveError: string | null = null
  const pickFilled = (...vals: (string | undefined | null)[]): string => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim().length > 0) return v
    }
    return ""
  }
  const cur = identityRow as Record<string, string | null> | null
  if (save && filledFields > 0 && !claudeError) {
    if (type === "audience") {
      const row = {
        user_id: userId,
        location: pickFilled(parsed.location, cur?.location),
        employment: pickFilled(parsed.employment, cur?.employment),
        education: pickFilled(parsed.education, cur?.education),
        income: pickFilled(parsed.income, cur?.income),
        behavioral: pickFilled(parsed.behavioral, cur?.behavioral),
        awareness_level: pickFilled(parsed.awarenessLevel, cur?.awareness_level),
        daily_pains: pickFilled(parsed.dailyPains, cur?.daily_pains),
        emotional_pains: pickFilled(parsed.emotionalPains, cur?.emotional_pains),
        unresolved_consequences: pickFilled(parsed.unresolvedConsequences, cur?.unresolved_consequences),
        fears: pickFilled(parsed.fears, cur?.fears),
        failed_solutions: pickFilled(parsed.failedSolutions, cur?.failed_solutions),
        limiting_beliefs: pickFilled(parsed.limitingBeliefs, cur?.limiting_beliefs),
        myths: pickFilled(parsed.myths, cur?.myths),
        daily_desires: pickFilled(parsed.dailyDesires, cur?.daily_desires),
        emotional_desires: pickFilled(parsed.emotionalDesires, cur?.emotional_desires),
        small_wins: pickFilled(parsed.smallWins, cur?.small_wins),
        ideal_solution: pickFilled(parsed.idealSolution, cur?.ideal_solution),
        bottom_line: pickFilled(parsed.bottomLine, cur?.bottom_line),
        cross_audience_quotes: pickFilled(parsed.crossAudienceQuotes, cur?.cross_audience_quotes),
        ideal_solution_words: pickFilled(parsed.idealSolutionWords, cur?.ideal_solution_words),
        identity_statements: pickFilled(parsed.identityStatements, cur?.identity_statements),
        ...(recoveredText ? { raw_file_text: recoveredText } : {}),
      }
      const { error } = await admin
        .from("audience_identities")
        .upsert(row as never, { onConflict: "user_id" })
      saveError = error?.message ?? null
      saved = !error
      // Verify by re-reading the row.
      if (saved) {
        const { data: verifyRow } = await admin
          .from("audience_identities")
          .select("daily_pains, emotional_pains, fears")
          .eq("user_id", userId)
          .single()
        if (verifyRow) {
          (diagnosis as Record<string, unknown>).db_after_save = verifyRow
        } else {
          saveError = "save reported success but row not found on re-read"
          saved = false
        }
      }
    } else {
      const row = {
        user_id: userId,
        niche: pickFilled(parsed.niche, cur?.niche),
        product_name: pickFilled(parsed.productName, cur?.product_name),
        who_i_am: pickFilled(parsed.whoIAm, cur?.who_i_am),
        who_i_serve: pickFilled(parsed.whoIServe, cur?.who_i_serve),
        how_i_sound: pickFilled(parsed.howISound, cur?.how_i_sound),
        slang_examples: pickFilled(parsed.slangExamples, cur?.slang_examples),
        what_i_never_do: pickFilled(parsed.whatINeverDo, cur?.what_i_never_do),
        ...(recoveredText ? { raw_file_text: recoveredText } : {}),
      }
      const { error } = await admin
        .from("core_identities")
        .upsert(row as never, { onConflict: "user_id" })
      saveError = error?.message ?? null
      saved = !error
      if (saved) {
        const { data: verifyRow } = await admin
          .from("core_identities")
          .select("niche, who_i_am, who_i_serve")
          .eq("user_id", userId)
          .single()
        if (verifyRow) {
          (diagnosis as Record<string, unknown>).db_after_save = verifyRow
        } else {
          saveError = "save reported success but row not found on re-read"
          saved = false
        }
      }
    }
  }

  let verdict: string
  let message: string
  if (claudeError) {
    verdict = "anthropic_call_failed"
    message = anthropicErrorToHebrew(claudeError)
  } else if (parseError) {
    verdict = "json_parse_failed"
    message = anthropicErrorToHebrew(parseError)
  } else if (filledFields === 0) {
    verdict = "claude_returned_empty"
    message =
      "Claude החזיר JSON תקין אבל בלי תוכן. כנראה לא זיהה מידע בטקסט שהועלה."
  } else {
    verdict = save && saved ? "ok_and_saved" : "ok"
    message =
      save && saved
        ? `נותחו ${filledFields} שדות והנתונים נשמרו בהצלחה.`
        : `נותחו ${filledFields} שדות בהצלחה (לא נשמרו — שלחי שוב עם save=true).`
  }

  return NextResponse.json({
    ...diagnosis,
    stop_reason: stopReason,
    raw_response: rawResponse,
    raw_response_length: rawResponse.length,
    parse_error: parseError,
    claude_error: claudeError,
    parsed,
    filled_fields_count: filledFields,
    saved,
    save_error: saveError,
    verdict,
    message,
  })
}
