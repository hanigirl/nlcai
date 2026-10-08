import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { extractFileContent, type FileContent } from "@/lib/extract-file-content"
import { readKnowledgeLink } from "@/lib/knowledge-source-link"
import {
  MAX_SOURCE_CHARS,
  processKnowledgeSource,
  type ProcessedSource,
} from "@/lib/knowledge-source-processing"
import { getAuthUser } from "@/lib/auth-user"
import { resolveNotice } from "@/lib/system-notices"

// A long transcript is read in parallel chunks (~30-60s); match the identity
// flow so Vercel doesn't silently kill the request mid-read.
export const maxDuration = 300

const MAX_PDF_BYTES = 10 * 1024 * 1024

// Knowledge sources are TEXT only (Hani, 2026-10-08): transcripts and
// written documents. No audio or video, no arbitrary web pages.
const ALLOWED_EXTENSIONS = [".docx", ".doc", ".pdf", ".txt", ".md", ".vtt", ".srt"]

// What the client gets back. raw_text can be a whole 3-hour transcript —
// it stays server-side.
const CLIENT_COLUMNS =
  "id, user_id, source_type, title, source_url, summary, insights, status, active, created_at, updated_at"

const VALID_TYPES = ["meeting", "webinar", "doc", "link", "other"] as const
type SourceType = (typeof VALID_TYPES)[number]

/** Title fallback from a URL (last path segment or host) or a file name. */
function deriveTitle(opts: { title?: string; url?: string; fileName?: string }): string {
  const explicit = opts.title?.trim()
  if (explicit) return explicit
  if (opts.fileName) return opts.fileName.replace(/\.[^.]+$/, "").trim() || "מקור"
  if (opts.url) {
    try {
      const u = new URL(opts.url)
      const seg = u.pathname.split("/").filter(Boolean).pop()
      return decodeURIComponent(seg || u.hostname)
    } catch {
      return "קישור"
    }
  }
  return "מקור"
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contentType = req.headers.get("content-type") || ""
    const isMultipart = contentType.includes("multipart/form-data")

    let sourceType: SourceType = "other"
    let title: string | undefined
    let sourceUrl: string | null = null
    let fileContent: Extract<FileContent, { kind: "text" | "pdf" }>
    let fileName: string | undefined

    if (isMultipart) {
      const formData = await req.formData()
      const file = formData.get("file") as File | null
      const t = (formData.get("type") as string) || "doc"
      title = (formData.get("title") as string | null) ?? undefined
      if (!file) {
        return NextResponse.json({ error: "file_required" }, { status: 400 })
      }
      if (!VALID_TYPES.includes(t as SourceType)) {
        return NextResponse.json({ error: "invalid_type" }, { status: 400 })
      }
      if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        return NextResponse.json({ error: "not_text_file" }, { status: 400 })
      }
      sourceType = t as SourceType
      fileName = file.name
      const buffer = Buffer.from(await file.arrayBuffer())
      const extracted = await extractFileContent(file.name, buffer)
      if (extracted.kind === "unsupported") {
        return NextResponse.json(
          { error: "file_unreadable", message: extracted.message },
          { status: 400 },
        )
      }
      fileContent = extracted
    } else {
      const body = (await req.json()) as {
        type?: string
        url?: string
        title?: string
      }
      const t = body.type || "doc"
      if (!VALID_TYPES.includes(t as SourceType)) {
        return NextResponse.json({ error: "invalid_type" }, { status: 400 })
      }
      if (!body.url?.trim()) {
        return NextResponse.json({ error: "url_required" }, { status: 400 })
      }
      sourceType = t as SourceType
      sourceUrl = body.url.trim()
      title = body.title
      const link = await readKnowledgeLink(sourceUrl)
      if (!link.ok) {
        return NextResponse.json({ error: link.error, message: link.message }, { status: 400 })
      }
      fileContent = link.content
      fileName = link.fileName || undefined
    }

    // base64 is 4/3 of the bytes — same 10MB cap whether uploaded or linked.
    if (fileContent.kind === "pdf" && fileContent.base64.length * 0.75 > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", message: "קובץ ה-PDF גדול מדי (מקסימום 10MB)." },
        { status: 400 },
      )
    }

    // Read to the end, up to a 4-5 hour transcript. Past that the tail is
    // cut — and the user is told, never silently.
    let truncated = false
    if (fileContent.kind === "text" && fileContent.text.length > MAX_SOURCE_CHARS) {
      fileContent = { kind: "text", text: fileContent.text.slice(0, MAX_SOURCE_CHARS) }
      truncated = true
    }

    const resolvedTitle = deriveTitle({ title, url: sourceUrl ?? undefined, fileName })
    // Full text is kept so a source can be re-processed later (new prompt,
    // retry after a failure) without asking the user to upload it again.
    const rawText = fileContent.kind === "text" ? fileContent.text : null

    const insert = (fields: { status: string; summary?: string; insights?: unknown }) =>
      supabase
        .from("business_sources")
        .insert({
          user_id: user.id,
          source_type: sourceType,
          title: resolvedTitle,
          source_url: sourceUrl,
          raw_text: rawText,
          summary: fields.summary ?? null,
          insights: fields.insights ?? [],
          status: fields.status,
        } as never)
        .select(CLIENT_COLUMNS)
        .single()

    const truncatedWarning = truncated
      ? "המקור ארוך מאוד — נקראו רק כ-4 השעות הראשונות שלו."
      : undefined

    // No API key → persist the source as pending; it can be processed later.
    let anthropicApiKey: string
    try {
      anthropicApiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      const { data, error } = await insert({ status: "pending" })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({
        source: data,
        warning: "Claude API key not connected — המקור נשמר, העיבוד יתבצע כשתחברו API key",
      })
    }

    let processed: ProcessedSource
    try {
      processed = await processKnowledgeSource(new Anthropic({ apiKey: anthropicApiKey }), fileContent)
    } catch (err) {
      console.error("[business-sources] processing failed", err)
      // Persist as failed so the row is visible and retryable rather than lost.
      const { data } = await insert({ status: "failed" })
      return NextResponse.json({ source: data, warning: "summarize_failed" })
    }

    const { data, error } = await insert({
      status: "ready",
      summary: processed.summary,
      insights: processed.insights,
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // Fresh material — the "transcripts almost used up" notice no longer holds.
    if (processed.insights.length > 0) {
      await resolveNotice({ audience: "user", userId: user.id }, "knowledge_exhausted")
    }
    return NextResponse.json({ source: data, warning: truncatedWarning })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[business-sources][POST]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const id = req.nextUrl.searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    const { error } = await supabase
      .from("business_sources")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[business-sources][DELETE]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH — toggle `active` (feed to AI or not) or update title.
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { id, active, title } = (await req.json()) as {
      id?: string
      active?: boolean
      title?: string
    }
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    const patch: Record<string, unknown> = {}
    if (typeof active === "boolean") patch.active = active
    if (typeof title === "string" && title.trim()) patch.title = title.trim()
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("business_sources")
      .update(patch as never)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(CLIENT_COLUMNS)
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ source: data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[business-sources][PATCH]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
