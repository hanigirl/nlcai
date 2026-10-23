import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { extractFileContent } from "@/lib/extract-file-content"
import { PRIMARY_MODEL, FALLBACK_MODEL, isOverloadError } from "@/lib/anthropic-fallback"
import { GeminiError, generateWithGeminiFallback, geminiErrorCode } from "@/lib/gemini"
import {
  buildHookExtractionPrompt,
  dedupeHooks,
  fetchAllHookTexts,
  parseExtractedHooks,
  parseGoogleDocId,
  splitHookList,
} from "@/lib/hook-import"
import * as XLSX from "xlsx"

// Only the prose path calls a model, and extraction is a short job — but a
// Gemini Pro call with thinking can still run past Vercel's 10s default.
export const maxDuration = 120

const MAX_FILE_BYTES = 5 * 1024 * 1024
// What we hand the model for a prose file. ~20k chars is a long document;
// anything past it is almost certainly not a hook list.
const MAX_TEXT_FOR_MODEL = 20_000

/**
 * POST /api/hooks/import — multipart, field "file" (.docx, .doc, .xlsx, .csv, .md),
 * or JSON { url } with a Google Docs link shared as "anyone with the link".
 *
 * For xlsx/csv: reads optional `columnIndex` form field (number). If absent,
 * returns { needsColumnSelection: true, columns: string[] } so the client can
 * show the column picker before re-submitting.
 *
 * Reads the file and returns the hooks found in it. It does NOT write them:
 * the warehouse page inserts them through the same path a hand-written hook
 * takes, so an imported hook is indistinguishable from a manual one.
 *
 * Response: { hooks: string[], duplicates: number, method: "list" | "ai" }
 *         | { needsColumnSelection: true, columns: string[] }
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

    // Two ways in: a Word/Excel/CSV/MD file (multipart, field "file") or a Google Docs
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
      const isWord = name.endsWith(".docx") || name.endsWith(".doc")
      const isExcel = name.endsWith(".xlsx")
      const isCsv = name.endsWith(".csv")
      const isMarkdown = name.endsWith(".md")

      if (!isWord && !isExcel && !isCsv && !isMarkdown) {
        return NextResponse.json({ error: "unsupported_type" }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "file_too_large" }, { status: 400 })
      }

      if (isExcel || isCsv) {
        const buffer = Buffer.from(await file.arrayBuffer())
        const workbook = XLSX.read(buffer, { type: "buffer" })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) {
          return NextResponse.json({ error: "empty_file" }, { status: 400 })
        }
        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][]
        if (!rows.length) {
          return NextResponse.json({ error: "empty_file" }, { status: 400 })
        }

        // First row is treated as headers
        const headerRow = rows[0].map((cell) => String(cell ?? ""))
        const columnIndexRaw = formData.get("columnIndex")

        if (columnIndexRaw === null || columnIndexRaw === "") {
          // Client needs to pick a column first
          return NextResponse.json({ needsColumnSelection: true, columns: headerRow })
        }

        const columnIndex = parseInt(String(columnIndexRaw), 10)
        if (isNaN(columnIndex) || columnIndex < 0 || columnIndex >= headerRow.length) {
          return NextResponse.json({ error: "invalid_column_index" }, { status: 400 })
        }

        // Extract values from the chosen column, skipping the header row
        const lines = rows
          .slice(1)
          .map((row) => String(row[columnIndex] ?? "").trim())
          .filter(Boolean)

        if (!lines.length) {
          return NextResponse.json({ error: "empty_file" }, { status: 400 })
        }

        text = lines.join("\n")
      } else if (isMarkdown) {
        const buffer = Buffer.from(await file.arrayBuffer())
        const raw = buffer.toString("utf8").replace(/^\uFEFF/, "")
        // Strip common markdown formatting, keeping the text content line by line
        text = raw
          .split("\n")
          .map((line) =>
            line
              // Remove heading markers
              .replace(/^#+\s*/, "")
              // Remove bold/italic markers
              .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
              // Remove inline code
              .replace(/`([^`]+)`/g, "$1")
              // Remove blockquote markers
              .replace(/^>\s*/, "")
              // Remove list markers (-, *, +, numbered)
              .replace(/^[-*+]\s+/, "")
              .replace(/^\d+\.\s+/, "")
              .trim(),
          )
          .filter(Boolean)
          .join("\n")
        if (!text) {
          return NextResponse.json({ error: "empty_file" }, { status: 400 })
        }
      } else {
        // Word files — existing path
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
      const status = gemini === "gemini_quota_exceeded" || gemini === "gemini_daily_limit" ? 402 : gemini === "gemini_overloaded" ? 503 : 400
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

  const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => "")

  const geminiKey = await getUserApiKey(supabase, "gemini_api_key").catch(() => "")
  if (geminiKey) {
    try {
      const { text: raw } = await generateWithGeminiFallback(geminiKey, {
        prompt,
        maxOutputTokens: 8192,
        // Copying lines out of a document needs no deep reasoning.
        thinkingLevel: "low",
        timeoutMs: 60_000,
        fallbackTimeoutMs: 45_000,
      })
      return parseExtractedHooks(raw)
    } catch (err) {
      // Same stand-in as the hook writers: when Google refuses the key for
      // quota, Claude reads the file instead of the import failing outright.
      // No notice — copying lines out of a document comes out the same
      // either way, unlike writing new hooks.
      if (!(err instanceof GeminiError && err.code === "quota" && anthropicKey)) throw err
      console.warn("[api/hooks/import] Gemini quota hit — Claude extracts instead:", err.message)
    }
  }

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
 * Only works for docs shared as "anyone with the link". A shared doc's export
 * redirects to the file itself on googleusercontent.com, so redirects to
 * Google's file hosts are followed. A private doc redirects to the sign-in
 * page (or answers 401/403); that, or a non-text response, is "private".
 */
async function fetchGoogleDocText(
  raw: string,
): Promise<{ text: string } | { error: string }> {
  const id = parseGoogleDocId(raw)
  if (!id) return { error: "invalid_docs_url" }

  let url = `https://docs.google.com/document/d/${id}/export?format=txt`
  let res: Response | undefined
  try {
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
      if (res.status < 300 || res.status >= 400) break
      const next = res.headers.get("location")
      if (!next) return { error: "private_doc" }
      const target = new URL(next, url)
      const isFileHost =
        target.protocol === "https:" &&
        (target.hostname.endsWith(".googleusercontent.com") ||
          target.hostname === "docs.google.com")
      if (!isFileHost) return { error: "private_doc" }
      url = target.toString()
      res = undefined
    }
  } catch {
    return { error: "doc_fetch_failed" }
  }
  if (!res) return { error: "doc_fetch_failed" }

  if (res.status === 404) return { error: "doc_not_found" }
  if (res.status === 401 || res.status === 403) return { error: "private_doc" }
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