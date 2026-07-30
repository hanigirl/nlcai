import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"

interface CorePostRow {
  id: string
  title: string | null
  body: string
  hook_text: string | null
  idea_text: string | null
  user_response: string | null
  status: string
  created_at: string
  updated_at: string
}

interface FormatVariantRow {
  id: string
  core_post_id: string
  format: string
  body: string | null
}

interface MediaAssetRow {
  format_variant_id: string
  url: string | null
  asset_type: string | null
}

// GET — list user's core posts with their format variants
export async function GET() {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data, error } = await supabase
      .from("core_posts")
      .select("id, title, body, hook_text, idea_text, user_response, status, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })

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
        .select("id, core_post_id, format, body")
        .in("core_post_id", postIds)
      variants = (vData ?? []) as unknown as FormatVariantRow[]
    }

    // Fetch media assets for these variants in one round-trip so the
    // /core_posts grid can render format completion chips (task C) without
    // an N+1 fan-out from the client.
    const variantIds = variants.map((v) => v.id)
    let media: MediaAssetRow[] = []
    if (variantIds.length > 0) {
      const { data: mData } = await supabase
        .from("media_assets")
        .select("format_variant_id, url, asset_type")
        .in("format_variant_id", variantIds)
        // Without an explicit order Postgres returns rows in whatever order it
        // likes, so both `primary_media_url` and the per-format winner among
        // several images were nondeterministic — a carousel's card thumbnail
        // could change between two identical requests. Ascending matches the
        // detail endpoint, so a card and its Sheet agree on the same asset.
        .order("created_at", { ascending: true })
      media = (mData ?? []) as unknown as MediaAssetRow[]
    }
    const variantHasMedia = new Set<string>()
    const firstMediaByPost: Record<string, string> = {}
    // Per-(post, format) first non-cover media URL, used by the /calendar
    // grid to render a thumbnail on each per-format card. Video wins over
    // image when a format has both, mirroring the detail endpoint's
    // `formatMedia` so the calendar card and the Sheet show the same asset.
    const formatMediaByPost: Record<string, Record<string, string>> = {}
    {
      const variantToPost: Record<string, string> = {}
      const variantToFormat: Record<string, string> = {}
      for (const v of variants) {
        variantToPost[v.id] = v.core_post_id
        variantToFormat[v.id] = v.format
      }
      // Track which (post, format) entries came from a non-video asset so a
      // later video can upgrade them; once a video is set we never downgrade.
      const formatMediaIsVideo: Record<string, boolean> = {}
      for (const m of media) {
        if (!m.url || m.asset_type === "cover") continue
        variantHasMedia.add(m.format_variant_id)
        const postId = variantToPost[m.format_variant_id]
        const format = variantToFormat[m.format_variant_id]
        if (postId && !firstMediaByPost[postId]) {
          firstMediaByPost[postId] = m.url
        }
        if (postId && format) {
          const isVideo = m.asset_type === "video"
          const key = `${postId}:${format}`
          if (!formatMediaByPost[postId]) formatMediaByPost[postId] = {}
          // Set if empty, or upgrade an image entry to a video one.
          if (!formatMediaByPost[postId][format] || (isVideo && !formatMediaIsVideo[key])) {
            formatMediaByPost[postId][format] = m.url
            formatMediaIsVideo[key] = isVideo
          }
        }
      }
    }

    // Per-post: which formats have a USER-INTENT duplicate (= variant with
    // either a non-empty script body or attached media), and which of those
    // have media. Per Hani 2026-05-14: variants the system auto-created
    // (empty `body`, no media) shouldn't surface under the format filter on
    // /core_posts — "the user can't upload media without first duplicating",
    // so a content-less variant is a ghost row from a legacy auto-create
    // path and must not be conflated with a real duplicate.
    const formatsByPost: Record<string, string[]> = {}
    const formatsWithMediaByPost: Record<string, string[]> = {}
    for (const v of variants) {
      const hasBody = !!v.body && v.body.trim().length > 0
      const hasMedia = variantHasMedia.has(v.id)
      if (!hasBody && !hasMedia) continue
      if (!formatsByPost[v.core_post_id]) formatsByPost[v.core_post_id] = []
      formatsByPost[v.core_post_id].push(v.format)
      if (hasMedia) {
        if (!formatsWithMediaByPost[v.core_post_id]) formatsWithMediaByPost[v.core_post_id] = []
        formatsWithMediaByPost[v.core_post_id].push(v.format)
      }
    }

    const result = posts.map((p) => ({
      ...p,
      formats: formatsByPost[p.id] ?? [],
      formats_with_media: formatsWithMediaByPost[p.id] ?? [],
      primary_media_url: firstMediaByPost[p.id] ?? null,
      format_media: formatMediaByPost[p.id] ?? {},
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
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { body, hookText, hookId, userResponse, formatPosts, videoUrl, idea, productId, triggerWord, title: providedTitle } = (await req.json()) as {
      body: string
      hookText: string
      hookId?: string
      userResponse: string
      formatPosts?: Record<string, string>
      videoUrl?: string
      idea?: string
      productId?: string | null
      triggerWord?: string
      /**
       * Optional pre-baked title. When provided we skip the AI-title
       * generation entirely and persist this string as-is. Used by the
       * duplicate-post flow (core-posts list) to stamp "עותק של: <orig>"
       * — generating a fresh AI title there would lose the visual
       * relationship between the original and its copy.
       */
      title?: string
    }

    // Empty body is intentional — drafts get created the moment the user
    // picks a hook on /project, so a card shows up on /core_posts even
    // before the AI fills in the body. The card's title falls back to
    // hook_text on the list view either way.
    const isDraft = !body || body.trim().length === 0

    let title = ""
    // If the client supplied a title (e.g. duplicate flow), trust it
    // — skip the AI generation path entirely. The duplicate flow needs
    // a stable, user-visible "עותק של: …" prefix; running it through
    // the LLM would rewrite the title and break that visual cue.
    if (providedTitle && providedTitle.trim().length > 0) {
      title = providedTitle.trim().slice(0, 120)
    } else if (!isDraft) {
      title = body.split("\n")[0].slice(0, 60) // fallback
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
    }

    // Save core post. The status column is the generation_status enum, which
    // only allows ('pending' | 'processing' | 'completed' | 'failed') — drafts
    // (empty body waiting for the AI body to land) map to 'pending' since
    // that's the semantic match. Was previously 'draft' which triggered a
    // 22P02 invalid_text_representation error and every POST returned 500.
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      body: body ?? "",
      title,
      hook_text: hookText,
      user_response: userResponse,
      status: isDraft ? "pending" : "completed",
    }
    if (idea && idea.trim()) insertData.idea_text = idea.trim()
    if (productId) insertData.product_id = productId
    if (triggerWord && triggerWord.trim()) insertData.trigger_word = triggerWord.trim()

    const { data: post, error: postError } = await supabase
      .from("core_posts")
      .insert(insertData as never)
      .select("id, title")
      .single()

    const postRow = post as unknown as { id: string; title: string } | null

    if (postError || !postRow) {
      return NextResponse.json({ error: postError?.message ?? "Failed to save" }, { status: 500 })
    }

    // Mark the source hook as used. When we have a stable id, also sync the
    // hook_text back — if the user edited the hook on the project page, the
    // inventory should reflect the version they actually used.
    if (hookId) {
      const hookUpdate: { is_used: boolean; hook_text?: string } = { is_used: true }
      if (hookText) hookUpdate.hook_text = hookText
      await supabase
        .from("hooks")
        .update(hookUpdate as never)
        .eq("user_id", user.id)
        .eq("id", hookId)
    } else if (hookText) {
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
