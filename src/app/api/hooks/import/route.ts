import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { extractFileContent } from "@/lib/extract-file-content"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"
import { generateWithGeminiFallback, geminiErrorCode } from "@/lib/gemini"
import {
  buildHookExtractionPrompt,
  dedupeHooks,
  fetchAllHookTexts,
  parseExtractedHooks,
  parseGoogleDocId,
  splitHookList,
} from "@/lib/hook-import"

// Only the prose path calls a model, and extraction is a short job — but a
// Gemini Pro call with thinking can still run past Vercel's 10s default.
export const maxDuration = 120

const MAX_FILE_BYTES = 5 * 1024 * 1024
// What we hand the model for a prose file. ~20k chars is a long document;
// anything past it is almost certainly not a hook list.
const MAX_TEXT_FOR_MODEL = 20_000

/**
 * POST /api/hooks/import — multipart, field "file" (.docx or .doc),
 * or JSON { url } with a Google Docs link shared as "anyone with the link".
 *
 * Reads the file and returns the hooks found in it. It does NOT write them:
 * the warehouse page inserts them through the same path a hand-written hook
 * takes, so an imported hook is indistinguishable from a manual one.
 *
 * Response: { hooks: string[], duplicates: number, method: "list" | "ai" }
 * Errors:   unsupported_type | file_too_large | empty_file | file_unreadable
 *           | invalid_docs_url | private_doc | doc_not_found | doc_fetch_failed
 *           | gemini_* | anthropic_overloaded | credits_exhausted
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Two ways in: a Word file (multipart, field "file") or a Google Docs
    // link (JSON { url }). Both end up as plain text for the same pipeline.
    let text: string
    if (req.headers.get("content-type")?.includes("application/json")) {
      const { url } = (await req.json().catch(() => ({}))) as { url?: string }
      const doc = await fetchGoogleDocText(url ?? "")
      if ("error" in doc) {
        return NextResponse.json({ error: doc.error }, { status: 400 })
      }
      text = doc.text
    } else {
      const formData = await req.formData()
      const file = formData.get("file") as File | null
      if (!file) {
        return NextResponse.json({ error: "file_required" }, { status: 400 })
      }
      const name = file.name.toLowerCase()
      if (!name.endsWith(".docx") && !name.endsWith(".doc")) {
        return NextResponse.json({ error: "unsupported_type" }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "file_too_large" }, { status: 400 })
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const content = await extractFileContent(file.name, buffer)
      if (content.kind !== "text") {
        const message = content.kind === "unsupported" ? content.message : ""
        const isEmpty = /ריק/.test(message)
        return NextResponse.json(
          { error: isEmpty ? "empty_file" : "file_unreadable", message },
          { status: 400 },
        )
      }
      text = content.text
    }

    // Whatever's already in the warehouse is skipped, so importing the same
    // file twice doesn't double every hook.
    const existing = await fetchAllHookTexts(supabase, user.id)

    const split = splitHookList(text)
    let found = split.hooks
    let method: "list" | "ai" = "list"

    if (!split.listLike) {
      // Prose: hooks are buried in paragraphs. Same engine choice as
      // "ייצר לי עוד הוקים" — Gemini when connected, otherwise Claude.
      const aiHooks = await extractWithModel(supabase, text.slice(0, MAX_TEXT_FOR_MODEL))
      if (aiHooks) {
        found = aiHooks
        method = "ai"
      }
      // No key at all → keep the line split. Better a rough import than none.
    }

    const hooks = dedupeHooks(found, existing)
    return NextResponse.json({ hooks, duplicates: found.length - hooks.length, method })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[api/hooks/import]", message)
    const gemini = geminiErrorCode(error)
    if (gemini) {
      const status = gemini === "gemini_quota_exceeded" ? 402 : gemini === "gemini_overloaded" ? 503 : 400
      return NextResponse.json({ error: gemini }, { status })
    }
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(message)
    const isOverloaded = /overloaded|529|503/.test(message)
    return NextResponse.json(
      { error: isCredits ? "credits_exhausted" : isOverloaded ? "anthropic_overloaded" : "import_failed" },
      { status: isCredits ? 402 : isOverloaded ? 503 : 500 },
    )
  }
}

/** Returns null when the user has no model key connected. */
async function extractWithModel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  text: string,
): Promise<string[] | null> {
  const prompt = buildHookExtractionPrompt(text)

  const geminiKey = await getUserApiKey(supabase, "gemini_api_key").catch(() => "")
  if (geminiKey) {
    const { text: raw } = await generateWithGeminiFallback(geminiKey, {
      prompt,
      maxOutputTokens: 8192,
      // Copying lines out of a document needs no deep reasoning.
      thinkingLevel: "low",
      timeoutMs: 60_000,
      fallbackTimeoutMs: 45_000,
    })
    return parseExtractedHooks(raw)
  }

  const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => "")
  if (!anthropicKey) return null

  const client = new Anthropic({ apiKey: anthropicKey })
  const params = {
    max_tokens: 4096,
    messages: [{ role: "user" as const, content: prompt }],
  }
  let message
  try {
    message = await client.messages.create({ ...params, model: PRIMARY_MODEL })
  } catch (err) {
    if (!isOverloadError(err)) throw err
    message = await client.messages.create({ ...params, model: FALLBACK_MODEL })
  }
  const block = message.content.find((b) => b.type === "text")
  return parseExtractedHooks(block?.text ?? "")
}

/**
 * Fetches a Google Doc as plain text through its public export URL.
 *
 * Only works for docs shared as "anyone with the link". A private doc does
 * not return an error code you can rely on: Google redirects to a sign-in
 * page. So redirects are not followed, and any redirect, 401/403, or a
 * non-text response is treated as "private".
 */
async function fetchGoogleDocText(
  raw: string,
): Promise<{ text: string } | { error: string }> {
  const id = parseGoogleDocId(raw)
  if (!id) return { error: "invalid_docs_url" }

  let res: Response
  try {
    res = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { error: "doc_fetch_failed" }
  }

  if (res.status === 404) return { error: "doc_not_found" }
  if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) {
    return { error: "private_doc" }
  }
  if (!res.ok) return { error: "doc_fetch_failed" }
  if (!(res.headers.get("content-type") ?? "").includes("text/plain")) {
    return { error: "private_doc" }
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_FILE_BYTES) return { error: "file_too_large" }
  // The export starts with a UTF-8 BOM.
  const text = buf.toString("utf8").replace(/^\uFEFF/, "").trim()
  if (!text) return { error: "empty_file" }
  return { text }
}
