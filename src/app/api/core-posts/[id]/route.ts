import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

interface FormatVariantRow {
  format: string
  body: string
}

// GET — load a single core post with format variants
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: post, error } = await supabase
      .from("core_posts")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()

    if (error || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { data: vData } = await supabase
      .from("format_variants")
      .select("id, format, body")
      .eq("core_post_id", id)

    const variants = (vData ?? []) as unknown as { id: string; format: string; body: string }[]

    const formatPosts: Record<string, string> = {}
    for (const v of variants) {
      formatPosts[v.format] = v.body
    }

    // Load video URL from media_assets for talking_head
    let videoUrl: string | null = null
    const thVariant = variants.find((v) => v.format === "talking_head")
    if (thVariant) {
      const { data: mediaData } = await supabase
        .from("media_assets")
        .select("url")
        .eq("format_variant_id", thVariant.id)
        .eq("asset_type", "video")
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (mediaData) {
        videoUrl = (mediaData as unknown as { url: string }).url
      }
    }

    return NextResponse.json({
      post: {
        ...(post as Record<string, unknown>),
        formatPosts,
        videoUrl,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH — update a core post and/or its format variants
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { body, formatPosts, videoUrl, deleteVideo } = (await req.json()) as {
      body?: string
      formatPosts?: Record<string, string>
      videoUrl?: string
      deleteVideo?: boolean
    }

    // Update core post body if provided
    if (body) {
      await supabase
        .from("core_posts")
        .update({ body } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Upsert format variants if provided
    if (formatPosts) {
      for (const [format, text] of Object.entries(formatPosts)) {
        if (!text || text === "מייצר...") continue
        await supabase
          .from("format_variants")
          .upsert(
            {
              core_post_id: id,
              format,
              body: text,
            } as never,
            { onConflict: "core_post_id,format" },
          )
      }
    }

    // Delete video if requested
    if (deleteVideo) {
      const { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "talking_head")
        .single()

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }
        await supabase
          .from("media_assets")
          .delete()
          .eq("format_variant_id", variantRow.id)
          .eq("asset_type", "video")
      }
    }

    // Save/update video URL
    if (videoUrl) {
      // Find or create the talking_head format variant
      let { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "talking_head")
        .single()

      if (!thVariant) {
        const { data: newVariant } = await supabase
          .from("format_variants")
          .insert({ core_post_id: id, format: "talking_head", body: "" } as never)
          .select("id")
          .single()
        thVariant = newVariant
      }

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }
        // Delete existing video asset and insert new one
        await supabase
          .from("media_assets")
          .delete()
          .eq("format_variant_id", variantRow.id)
          .eq("asset_type", "video")

        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "video",
          url: videoUrl,
          provider: "heygen",
          status: "completed",
        } as never)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
