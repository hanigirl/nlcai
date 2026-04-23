import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

interface CorePostRow {
  id: string
  title: string | null
  body: string
  hook_text: string | null
  user_response: string | null
  status: string
  created_at: string
  updated_at: string
}

interface FormatVariantRow {
  core_post_id: string
  format: string
}

// GET — list user's core posts with their format variants
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data, error } = await supabase
      .from("core_posts")
      .select("id, title, body, hook_text, user_response, status, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const posts = (data ?? []) as unknown as CorePostRow[]

    // Fetch format variants for each post
    const postIds = posts.map((p) => p.id)
    let variants: FormatVariantRow[] = []
    if (postIds.length > 0) {
      const { data: vData } = await supabase
        .from("format_variants")
        .select("core_post_id, format")
        .in("core_post_id", postIds)
      variants = (vData ?? []) as unknown as FormatVariantRow[]
    }

    // Group formats by post
    const formatsByPost: Record<string, string[]> = {}
    for (const v of variants) {
      if (!formatsByPost[v.core_post_id]) formatsByPost[v.core_post_id] = []
      formatsByPost[v.core_post_id].push(v.format)
    }

    const result = posts.map((p) => ({
      ...p,
      formats: formatsByPost[p.id] ?? [],
    }))

    return NextResponse.json({ posts: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST — save a new core post (generates AI title)
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { body, hookText, userResponse, formatPosts, videoUrl } = (await req.json()) as {
      body: string
      hookText: string
      userResponse: string
      formatPosts?: Record<string, string>
      videoUrl?: string
    }

    if (!body) {
      return NextResponse.json({ error: "body is required" }, { status: 400 })
    }

    // Generate title via AI
    let title = body.split("\n")[0].slice(0, 60) // fallback
    try {
      const apiKey = await getUserApiKey(supabase, "anthropic_api_key")
      const client = new Anthropic({ apiKey })
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 50,
        messages: [{
          role: "user",
          content: `תן כותרת קצרה (3-6 מילים) לפוסט הבא. החזר רק את הכותרת, בלי גרשיים ובלי הסברים.\n\n${body.slice(0, 500)}`,
        }],
      })
      const textBlock = msg.content.find((b) => b.type === "text")
      if (textBlock?.text) {
        title = textBlock.text.trim()
      }
    } catch {
      // Use fallback title
    }

    // Save core post
    const insertData = {
      user_id: user.id,
      body,
      title,
      hook_text: hookText,
      user_response: userResponse,
      status: "completed",
    }

    const { data: post, error: postError } = await supabase
      .from("core_posts")
      .insert(insertData as never)
      .select("id, title")
      .single()

    const postRow = post as unknown as { id: string; title: string } | null

    if (postError || !postRow) {
      return NextResponse.json({ error: postError?.message ?? "Failed to save" }, { status: 500 })
    }

    // Mark the source hook as used
    if (hookText) {
      await supabase
        .from("hooks")
        .update({ is_used: true } as never)
        .eq("user_id", user.id)
        .eq("hook_text", hookText)
    }

    // Save format variants if provided
    if (formatPosts && Object.keys(formatPosts).length > 0) {
      const variants = Object.entries(formatPosts)
        .filter(([, text]) => text && text !== "מייצר...")
        .map(([format, text]) => ({
          core_post_id: postRow.id,
          format,
          body: text,
        }))

      if (variants.length > 0) {
        await supabase.from("format_variants").insert(variants as never)
      }
    }

    // Save video URL as media asset if provided
    if (videoUrl) {
      // Find or create the talking_head format variant
      let { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", postRow.id)
        .eq("format", "talking_head")
        .single()

      if (!thVariant) {
        const { data: newVariant } = await supabase
          .from("format_variants")
          .insert({ core_post_id: postRow.id, format: "talking_head", body: "" } as never)
          .select("id")
          .single()
        thVariant = newVariant
      }

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }
        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "video",
          url: videoUrl,
          provider: "heygen",
          status: "completed",
        } as never)
      }
    }

    return NextResponse.json({ id: postRow.id, title: postRow.title })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
