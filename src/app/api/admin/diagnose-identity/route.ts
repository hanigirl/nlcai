import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient, isAdminEmail } from "@/lib/supabase/admin"
import {
  CORE_IDENTITY_PARSE_PROMPT,
  AUDIENCE_IDENTITY_PARSE_PROMPT,
} from "@/lib/agents/identity-parser"
import { anthropicErrorToHebrew } from "@/lib/anthropic-errors"

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

  if (!rawText) {
    return NextResponse.json({
      ...diagnosis,
      verdict: "no_raw_text",
      message:
        "אין טקסט שמור (כנראה הקובץ היה PDF). היא צריכה להעלות מחדש כ-docx או טקסט.",
    })
  }

  // 3. Re-run the AI call and capture everything.
  const systemPrompt =
    type === "core" ? CORE_IDENTITY_PARSE_PROMPT : AUDIENCE_IDENTITY_PARSE_PROMPT
  const client = new Anthropic({ apiKey: anthropicKey })

  let rawResponse = ""
  let parseError: string | null = null
  let parsed: Record<string, string> = {}
  let claudeError: string | null = null
  let stopReason: string | null = null

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${systemPrompt}\n\n--- הטקסט ---\n${rawText}` },
          ],
        },
      ],
    })
    stopReason = message.stop_reason ?? null
    const textBlock = message.content.find((b) => b.type === "text")
    rawResponse = textBlock?.text ?? ""
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0])
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
  if (save && filledFields > 0 && !claudeError) {
    if (type === "audience") {
      const row = {
        user_id: userId,
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
        niche: parsed.niche ?? "",
        product_name: parsed.productName ?? "",
        who_i_am: parsed.whoIAm ?? "",
        who_i_serve: parsed.whoIServe ?? "",
        how_i_sound: parsed.howISound ?? "",
        slang_examples: parsed.slangExamples ?? "",
        what_i_never_do: parsed.whatINeverDo ?? "",
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
