import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { extractFileContent, type FileContent } from "@/lib/extract-file-content"
import { scrapeUrlToText, ScrapeError } from "@/lib/scrape-url"

// Doc + Sonnet can run 30-45s; match the identity flow so Vercel doesn't
// silently kill the request mid-summary.
export const maxDuration = 300

const MAX_PDF_BYTES = 10 * 1024 * 1024
// Keep stored text small — we only need it for re-summarization, not display.
const MAX_RAW_TEXT = 20_000

const VALID_TYPES = ["meeting", "webinar", "doc", "link", "other"] as const
type SourceType = (typeof VALID_TYPES)[number]

const BUSINESS_SOURCE_SUMMARY_PROMPT = `את סוכנת שמסכמת מקור ידע של עסק (תמלול פגישה, וובינר, מסמך, מאמר או דף) כדי שהתקציר יוזן למחולל תוכן שכותב הוקים ופוסטים.

כללים:
1. **סכמי תמיד בעברית**, גם אם המקור באנגלית.
2. **אל תמציאי פרטים שלא כתובים.** אם משהו לא מופיע — דלגי, אל תנחשי.
3. **אורך יעד: 3-6 משפטים**, פסקה אחת רציפה, בלי כותרות ובלי bullets.

התמקדי במה שיעזור לכתוב תוכן אותנטי ומבוסס:
- הנקודות, התובנות והרעיונות המרכזיים
- סיפורים, דוגמאות ומקרים אמיתיים שהוזכרו
- נתונים, מספרים או תוצאות
- ניסוחים, ביטויים ומשפטים אופייניים שאפשר לשאול מהם`

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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contentType = req.headers.get("content-type") || ""
    const isMultipart = contentType.includes("multipart/form-data")

    let sourceType: SourceType = "other"
    let title: string | undefined
    let sourceUrl: string | null = null
    let fileContent: FileContent | null = null
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
      sourceType = t as SourceType
      fileName = file.name
      const buffer = Buffer.from(await file.arrayBuffer())
      fileContent = await extractFileContent(file.name, buffer)
      if (fileContent.kind === "unsupported") {
        return NextResponse.json(
          { error: "file_unreadable", message: fileContent.message },
          { status: 400 },
        )
      }
      if (fileContent.kind === "pdf" && buffer.byteLength > MAX_PDF_BYTES) {
        return NextResponse.json(
          { error: "file_too_large", message: "קובץ ה-PDF גדול מדי (מקסימום 10MB)." },
          { status: 400 },
        )
      }
    } else {
      const body = (await req.json()) as {
        type?: string
        url?: string
        title?: string
      }
      const t = body.type || "link"
      if (!VALID_TYPES.includes(t as SourceType)) {
        return NextResponse.json({ error: "invalid_type" }, { status: 400 })
      }
      if (!body.url?.trim()) {
        return NextResponse.json({ error: "url_required" }, { status: 400 })
      }
      sourceType = t as SourceType
      sourceUrl = body.url.trim()
      title = body.title
      try {
        const text = await scrapeUrlToText(sourceUrl)
        fileContent = { kind: "text", text }
      } catch (err) {
        if (err instanceof ScrapeError) {
          return NextResponse.json({ error: "scrape_failed", message: err.message }, { status: err.status })
        }
        throw err
      }
    }

    const resolvedTitle = deriveTitle({ title, url: sourceUrl ?? undefined, fileName })
    const rawText =
      fileContent.kind === "text" ? fileContent.text.slice(0, MAX_RAW_TEXT) : null

    // No API key → persist the source as pending; summary can be filled later.
    let anthropicApiKey: string
    try {
      anthropicApiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      const { data, error } = await supabase
        .from("business_sources")
        .insert({
          user_id: user.id,
          source_type: sourceType,
          title: resolvedTitle,
          source_url: sourceUrl,
          summary: null,
          raw_text: rawText,
          status: "pending",
        } as never)
        .select()
        .single()
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({
        source: data,
        warning: "Claude API key not connected — המקור נשמר, הסיכום יתבצע כשתחברו API key",
      })
    }

    // Summarize with Sonnet (short output → bounded prompt tokens downstream).
    const client = new Anthropic({ apiKey: anthropicApiKey })
    const userContent: Anthropic.ContentBlockParam[] =
      fileContent.kind === "pdf"
        ? [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: fileContent.base64 },
            },
            { type: "text", text: BUSINESS_SOURCE_SUMMARY_PROMPT },
          ]
        : [
            {
              type: "text",
              text: `${BUSINESS_SOURCE_SUMMARY_PROMPT}\n\n--- התוכן ---\n${fileContent.text}`,
            },
          ]

    let summary = ""
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        messages: [{ role: "user", content: userContent }],
      })
      const textBlock = message.content.find((b) => b.type === "text")
      summary = textBlock?.text?.trim() ?? ""
    } catch (err) {
      console.error("[business-sources] summarize failed", err)
      // Persist as failed so the row is visible and retryable rather than lost.
      const { data } = await supabase
        .from("business_sources")
        .insert({
          user_id: user.id,
          source_type: sourceType,
          title: resolvedTitle,
          source_url: sourceUrl,
          summary: null,
          raw_text: rawText,
          status: "failed",
        } as never)
        .select()
        .single()
      return NextResponse.json({ source: data, warning: "summarize_failed" })
    }

    const { data, error } = await supabase
      .from("business_sources")
      .insert({
        user_id: user.id,
        source_type: sourceType,
        title: resolvedTitle,
        source_url: sourceUrl,
        summary,
        raw_text: rawText,
        status: "ready",
      } as never)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ source: data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[business-sources][POST]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
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
      .select()
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
