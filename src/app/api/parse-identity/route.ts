import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  CORE_IDENTITY_PARSE_PROMPT,
  AUDIENCE_IDENTITY_PARSE_PROMPT,
} from "@/lib/agents/identity-parser"
import { anthropicErrorToHebrew } from "@/lib/anthropic-errors"
import { extractFileContent, type FileContent } from "@/lib/extract-file-content"
import { extractFirstJsonObject, hasMoreObjectsAfter } from "@/lib/extract-first-json"
import { classifyUploadError } from "@/lib/upload-errors"

// Vercel default is 10s. Identity parsing with Sonnet on a ~10K-char file can
// take 30–45s end-to-end; without this it'd timeout silently and the row would
// land in the empty-fields state we're trying to prevent.
export const maxDuration = 60

// Reject files past these limits up front. 30K Hebrew chars ≈ 15K tokens,
// which fits comfortably under maxDuration=60 even with Anthropic latency.
// Anything larger usually means the user dumped a doc with noise — the model
// doesn't get a better identity from it, and the round-trip risks timing out.
const MAX_TEXT_CHARS = 30_000
const MAX_PDF_BYTES = 5 * 1024 * 1024


export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "פג תוקף ההתחברות. התחברו מחדש ונסו שוב.",
        },
        { status: 401 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const type = formData.get("type") as string // "core" or "audience"

    // Manual fields passed alongside the file
    const manualFields = formData.get("manualFields") as string | null
    const manual = manualFields ? JSON.parse(manualFields) : {}

    if (!type || (type !== "core" && type !== "audience")) {
      return NextResponse.json(
        {
          error: "invalid_type",
          message: "תקלה בבקשה — חסר סוג הקובץ. רעננו את הדף ונסו שוב.",
        },
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
    let fileSaveError: string | null = null
    let multipleProfilesDetected = false
    let fileContent: FileContent | null = null
    let fileBuffer: Buffer | null = null

    // Extract content from file
    if (file) {
      fileBuffer = Buffer.from(await file.arrayBuffer())
      fileContent = await extractFileContent(file.name, fileBuffer)

      // Hard fail early when the file format is unreadable — user needs immediate feedback.
      if (fileContent.kind === "unsupported") {
        return NextResponse.json(
          { error: "file_unreadable", message: fileContent.message },
          { status: 400 }
        )
      }

      // Length cap. Long files cause timeouts mid-parse and the row ends up
      // committed with empty fields; better to refuse them up front with a
      // clear message so the user trims the file and re-uploads.
      if (fileContent.kind === "text" && fileContent.text.length > MAX_TEXT_CHARS) {
        return NextResponse.json(
          {
            error: "file_too_long",
            message: `הקובץ ארוך מדי (${fileContent.text.length.toLocaleString("he-IL")} תווים). אנא קצרו אותו ל־${MAX_TEXT_CHARS.toLocaleString("he-IL")} תווים לכל היותר ונסו שוב — קבצים ארוכים מדי לא משפרים את איכות הניתוח.`,
          },
          { status: 413 }
        )
      }
      if (fileContent.kind === "pdf" && fileBuffer.byteLength > MAX_PDF_BYTES) {
        const mb = (fileBuffer.byteLength / 1024 / 1024).toFixed(1)
        return NextResponse.json(
          {
            error: "file_too_large",
            message: `קובץ ה־PDF גדול מדי (${mb} MB). הגודל המקסימלי הוא ${MAX_PDF_BYTES / 1024 / 1024} MB. אנא קצרו את הקובץ או המירו לטקסט.`,
          },
          { status: 413 }
        )
      }

      // Save original file to Supabase Storage. This is the *backup* of the
      // raw file — used later for reparse (especially for PDF, which has no
      // raw_file_text fallback). If it fails, surface a Hebrew-categorized
      // warning so the user knows the parsed data was kept but the original
      // file isn't recoverable.
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

        // Upload new file — supabase returns {error} instead of throwing, must check
        const { error: storageErr } = await supabase.storage.from("user-media").upload(storagePath, fileBuffer, {
          contentType: file.type || "application/octet-stream",
        })
        if (storageErr) {
          const classified = classifyUploadError(storageErr)
          fileSaveError = `${classified.message} (גיבוי הקובץ ב-Storage נכשל; ${classified.kind})`
          console.error("[parse-identity] storage upload:", classified.kind, classified.raw)
        } else {
          // Record in user_media — also returns {error} silently
          const { error: insertErr } = await supabase.from("user_media").insert({
            user_id: user.id,
            category,
            file_name: file.name,
            storage_path: storagePath,
            metadata: {},
          } as never)
          if (insertErr) {
            const classified = classifyUploadError(insertErr)
            fileSaveError = `${classified.message} (רישום הקובץ ב-DB נכשל; ${classified.kind})`
            console.error("[parse-identity] user_media insert:", classified.kind, classified.raw)
          }
        }
      } catch (err) {
        const classified = classifyUploadError(err)
        fileSaveError = `${classified.message} (חריגה בעת שמירת הקובץ; ${classified.kind})`
        console.error("[parse-identity] file save threw:", classified.kind, classified.raw)
      }
    }

    // Parse with AI
    if (fileContent) {
      if (!anthropicApiKey) {
        aiError = "anthropic_not_connected"
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
          const raw = textBlock?.text ?? ""

          const jsonStr = extractFirstJsonObject(raw)
          if (jsonStr) {
            try {
              parsed = JSON.parse(jsonStr)
              // Files describing 2+ personas make Claude emit multiple JSON
              // objects back-to-back. We keep the first (one-row-per-user
              // schema), but surface a notice so the user knows the rest
              // were dropped intentionally.
              if (hasMoreObjectsAfter(raw, jsonStr)) {
                multipleProfilesDetected = true
              }
            } catch (parseErr) {
              aiError = parseErr instanceof Error ? parseErr.message : String(parseErr)
            }
          } else {
            aiError = "no_json_block_in_response"
          }

          // Treat all-empty parse as a soft failure so the user gets feedback.
          const hasAnyField = Object.values(parsed).some(
            (v) => typeof v === "string" && v.trim().length > 0
          )
          if (!aiError && !hasAnyField) {
            aiError = "claude_returned_empty"
          }
        } catch (err) {
          aiError = err instanceof Error ? err.message : String(err)
          console.error("AI parsing failed, saving manual fields only:", aiError)
        }
      }
    }

    // If AI failed and there's nothing else meaningful to persist, refuse the
    // upsert and surface the error. Without this gate, a failed parse would
    // create an empty identity row (or overwrite-via-fallback an existing one),
    // and the user later can't generate hooks because the row "exists" but is
    // empty. Audience flow has no manual fields, so any AI failure there is
    // fatal. Core flow has manualFields — if the user typed niche/whoIAm/etc.,
    // those are still worth saving on their own.
    const hasManualCoreContent =
      type === "core" &&
      [manual.productName, manual.niche, manual.whoIAm, manual.whoIServe, manual.howISound, manual.slangExamples, manual.whatINeverDo]
        .some((v) => typeof v === "string" && v.trim().length > 0)
    if (aiError && !hasManualCoreContent) {
      return NextResponse.json(
        {
          error: "ai_parse_failed",
          message: anthropicErrorToHebrew(aiError),
          ...(fileSaveError ? { fileSaveError } : {}),
        },
        { status: 422 }
      )
    }

    // raw_file_text is only available for text-based formats. For PDF we skip it;
    // reparse flow will need a reupload. That's an acceptable tradeoff since PDF
    // parsing via document block is reliable on the first pass.
    const rawFileText =
      fileContent?.kind === "text" ? fileContent.text : null

    // Pull existing values so a partial parse can't wipe good prior data.
    const { data: existingCore } =
      type === "core"
        ? await supabase
            .from("core_identities")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle()
        : { data: null }
    const { data: existingAudience } =
      type === "audience"
        ? await supabase
            .from("audience_identities")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle()
        : { data: null }

    // pickFilled: prefer first non-empty value in the order given.
    const pickFilled = (...vals: (string | undefined | null)[]): string => {
      for (const v of vals) {
        if (typeof v === "string" && v.trim().length > 0) return v
      }
      return ""
    }
    const cur = (existingCore ?? existingAudience) as Record<string, string | null> | null

    // Save to DB — manual fields take priority over parsed (non-empty manual fields won't be overwritten)
    if (type === "core") {
      const row = {
        user_id: user.id,
        niche: pickFilled(manual.niche, parsed.niche, cur?.niche),
        product_name: pickFilled(manual.productName, parsed.productName, cur?.product_name),
        who_i_am: pickFilled(manual.whoIAm, parsed.whoIAm, cur?.who_i_am),
        who_i_serve: pickFilled(manual.whoIServe, parsed.whoIServe, cur?.who_i_serve),
        how_i_sound: pickFilled(parsed.howISound, manual.howISound, cur?.how_i_sound),
        slang_examples: pickFilled(parsed.slangExamples, manual.slangExamples, cur?.slang_examples),
        what_i_never_do: pickFilled(parsed.whatINeverDo, manual.whatINeverDo, cur?.what_i_never_do),
        ...(rawFileText ? { raw_file_text: rawFileText } : {}),
      }

      const { error } = await supabase
        .from("core_identities")
        .upsert(row as never, { onConflict: "user_id" })

      if (error) {
        const classified = classifyUploadError(error)
        console.error("[parse-identity] core_identities upsert:", classified.kind, classified.raw)
        return NextResponse.json(
          {
            error: "identity_save_failed",
            message: `הנתונים לא נשמרו במסד הנתונים. ${classified.message}`,
            ...(fileSaveError ? { fileSaveError } : {}),
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        parsed: { ...parsed, ...manual },
        saved: row,
        ...(aiError ? { warning: `${anthropicErrorToHebrew(aiError)} השדות הידניים נשמרו, אבל הקובץ לא נותח.` } : {}),
        ...(fileSaveError ? { fileSaveError } : {}),
        ...(multipleProfilesDetected
          ? {
              notice:
                "זיהינו בקובץ יותר מפרופיל אחד. המערכת תומכת בפרופיל אחד בלבד, ולכן נשמר רק הראשון.",
            }
          : {}),
      })
    } else {
      const row = {
        user_id: user.id,
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
        ...(rawFileText ? { raw_file_text: rawFileText } : {}),
      }

      const { error } = await supabase
        .from("audience_identities")
        .upsert(row as never, { onConflict: "user_id" })

      if (error) {
        const classified = classifyUploadError(error)
        console.error("[parse-identity] audience_identities upsert:", classified.kind, classified.raw)
        return NextResponse.json(
          {
            error: "identity_save_failed",
            message: `הנתונים לא נשמרו במסד הנתונים. ${classified.message}`,
            ...(fileSaveError ? { fileSaveError } : {}),
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        parsed,
        saved: row,
        ...(aiError ? { warning: `${anthropicErrorToHebrew(aiError)} הנתונים לא נשמרו מהקובץ.` } : {}),
        ...(fileSaveError ? { fileSaveError } : {}),
        ...(multipleProfilesDetected
          ? {
              notice:
                "זיהינו בקובץ יותר מקהל יעד אחד. המערכת תומכת בקהל יעד אחד בלבד, ולכן נשמר רק הראשון.",
            }
          : {}),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[parse-identity] top-level error:", message)
    // Detect FormData/body parsing failures vs everything else.
    const isFormDataError = /formdata|multipart|body|payload/i.test(message)
    if (isFormDataError) {
      return NextResponse.json(
        {
          error: "request_invalid",
          message: "הבקשה הגיעה לא תקינה לשרת. רעננו את הדף ונסו שוב.",
        },
        { status: 400 }
      )
    }
    const classified = classifyUploadError(error)
    return NextResponse.json(
      {
        error: "internal_error",
        message: `אירעה שגיאה בעיבוד הקובץ. ${classified.message}`,
      },
      { status: 500 }
    )
  }
}
