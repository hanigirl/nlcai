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

    // Per-format readiness needs to know which formats have media. We do a
    // single batched lookup against media_assets and project to a set of
    // format ids that have at least one non-cover asset. The Sheet uses
    // this to render the per-format status chips without an N+1 fan-out.
    const variantIds = variants.map((v) => v.id)
    const formatsWithMedia: string[] = []
    if (variantIds.length > 0) {
      const { data: mediaRows } = await supabase
        .from("media_assets")
        .select("format_variant_id, url, asset_type")
        .in("format_variant_id", variantIds)
      const variantToFormat: Record<string, string> = {}
      for (const v of variants) variantToFormat[v.id] = v.format
      const seen = new Set<string>()
      for (const m of (mediaRows ?? []) as unknown as {
        format_variant_id: string
        url: string | null
        asset_type: string | null
      }[]) {
        if (m.url && m.asset_type !== "cover") {
          const fmt = variantToFormat[m.format_variant_id]
          if (fmt && !seen.has(fmt)) {
            seen.add(fmt)
            formatsWithMedia.push(fmt)
          }
        }
      }
    }

    // Load video URL from media_assets for talking_head
    let videoUrl: string | null = null
    let coverUrl: string | null = null
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

      // Load cover URL
      const { data: coverData } = await supabase
        .from("media_assets")
        .select("url")
        .eq("format_variant_id", thVariant.id)
        .eq("asset_type", "cover")
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (coverData) {
        coverUrl = (coverData as unknown as { url: string }).url
      }
    }

    return NextResponse.json({
      post: {
        ...(post as Record<string, unknown>),
        formatPosts,
        formatsWithMedia,
        videoUrl,
        coverUrl,
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

    const { body, hookText, hookId, idea, productId, triggerWord, userResponse, formatPosts, videoUrl, deleteVideo, coverBase64, coverText, deleteCover, carouselImages } = (await req.json()) as {
      body?: string
      hookText?: string
      hookId?: string
      idea?: string
      productId?: string | null
      triggerWord?: string
      userResponse?: string
      formatPosts?: Record<string, string>
      videoUrl?: string
      deleteVideo?: boolean
      coverBase64?: string
      coverText?: string
      deleteCover?: boolean
      // Array of base64 PNG buffers — output of /api/carousel/generate.
      // Saved as multiple `media_assets` rows under the `carousel`
      // format_variant. `null` clears the slate (matches the UI's
      // "delete carousel" path that sets carouselImages=null).
      carouselImages?: string[] | null
    }

    // Update core post body if provided. We treat empty string as "user
    // intentionally cleared" and still write it; callers that only want to
    // touch other fields should omit the body key entirely.
    if (body !== undefined) {
      const update: { body: string; status?: string } = { body }
      // A previously-empty draft graduates to "completed" the moment a real
      // body lands; conversely, clearing back to empty isn't worth demoting.
      if (body.trim().length > 0) update.status = "completed"
      await supabase
        .from("core_posts")
        .update(update as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update hook_text if provided. Used when the user re-picks a hook on
    // /project after the draft was already created — we keep the row's
    // hook_text in sync with the chosen one and flip is_used on the new
    // source hook so /hooks reflects reality.
    if (hookText !== undefined) {
      await supabase
        .from("core_posts")
        .update({ hook_text: hookText } as never)
        .eq("id", id)
        .eq("user_id", user.id)
      if (hookId) {
        await supabase
          .from("hooks")
          .update({ is_used: true } as never)
          .eq("user_id", user.id)
          .eq("id", hookId)
      }
    }

    // Backfill idea_text once. We only write when it's currently null on the
    // row, so editing the textarea on /project doesn't overwrite the original
    // idea the post was generated from.
    if (idea !== undefined && idea.trim()) {
      const { data: existing } = await supabase
        .from("core_posts")
        .select("idea_text")
        .eq("id", id)
        .eq("user_id", user.id)
        .single()
      const currentIdea = (existing as { idea_text: string | null } | null)?.idea_text
      if (!currentIdea) {
        await supabase
          .from("core_posts")
          .update({ idea_text: idea.trim() } as never)
          .eq("id", id)
          .eq("user_id", user.id)
      }
    }

    // Update cover text if provided
    if (coverText !== undefined) {
      await supabase
        .from("core_posts")
        .update({ cover_text: coverText } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update product selection. null clears the FK, a uuid sets it. Omit
    // entirely to leave alone.
    if (productId !== undefined) {
      await supabase
        .from("core_posts")
        .update({ product_id: productId } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update trigger word. Empty string is a valid "user cleared the field"
    // signal; only `undefined` skips the write.
    if (triggerWord !== undefined) {
      await supabase
        .from("core_posts")
        .update({ trigger_word: triggerWord } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update the "what do you want to say" textarea. Same semantics as
    // trigger word — empty string clears, undefined skips. Without this
    // the autosave on /project couldn't reach the row and a refresh /
    // navigation back wiped the textarea to its draft-time "" value.
    if (userResponse !== undefined) {
      await supabase
        .from("core_posts")
        .update({ user_response: userResponse } as never)
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

    // Delete cover if requested
    if (deleteCover) {
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
          .eq("asset_type", "cover")
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

    // Save cover image
    if (coverBase64) {
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
        // Upload cover to storage
        const coverBuffer = Buffer.from(coverBase64, "base64")
        const storagePath = `${user.id}/cover/${crypto.randomUUID()}.png`
        await supabase.storage.from("user-media").upload(storagePath, coverBuffer, { contentType: "image/png" })
        const coverUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl

        // Replace existing cover asset
        await supabase
          .from("media_assets")
          .delete()
          .eq("format_variant_id", variantRow.id)
          .eq("asset_type", "cover")

        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "cover",
          url: coverUrl,
          status: "completed",
        } as never)
      }
    }

    // Save carousel images — array of base64 PNG buffers from
    // /api/carousel/generate. Each becomes its own `media_assets` row
    // (asset_type "image") under the `carousel` format_variant. We
    // wipe the slate first so re-generation doesn't pile up old slides.
    if (carouselImages !== undefined) {
      let { data: carouselVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "carousel")
        .single()

      if (!carouselVariant && Array.isArray(carouselImages) && carouselImages.length > 0) {
        const { data: newVariant } = await supabase
          .from("format_variants")
          .insert({ core_post_id: id, format: "carousel", body: "" } as never)
          .select("id")
          .single()
        carouselVariant = newVariant
      }

      if (carouselVariant) {
        const variantRow = carouselVariant as unknown as { id: string }

        // Drop any existing image assets — carousels are versioned as a
        // group; partial replacement would leave stale slides.
        await supabase
          .from("media_assets")
          .delete()
          .eq("format_variant_id", variantRow.id)
          .eq("asset_type", "image")

        // null/empty → just the deletion above. Otherwise upload + insert.
        if (Array.isArray(carouselImages) && carouselImages.length > 0) {
          for (let i = 0; i < carouselImages.length; i++) {
            const base64 = carouselImages[i]
            if (!base64) continue
            const buffer = Buffer.from(base64, "base64")
            const storagePath = `${user.id}/carousel/${crypto.randomUUID()}.png`
            await supabase.storage
              .from("user-media")
              .upload(storagePath, buffer, { contentType: "image/png" })
            const publicUrl = supabase.storage
              .from("user-media")
              .getPublicUrl(storagePath).data.publicUrl

            await supabase.from("media_assets").insert({
              format_variant_id: variantRow.id,
              asset_type: "image",
              url: publicUrl,
              status: "completed",
            } as never)
          }
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE — remove a core post (and let the cascade clean up format_variants /
// media_assets via FK ON DELETE CASCADE if configured). Front-end is the
// source of truth for "are you sure" — this just acts on the request.
export async function DELETE(
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

    // Best-effort cleanup of dependent rows in case the schema doesn't have
    // ON DELETE CASCADE wired. We swallow individual errors so a missing
    // table or mismatched FK can't block the core delete the user requested.
    try {
      const { data: variants } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
      const variantIds = ((variants ?? []) as { id: string }[]).map((v) => v.id)
      if (variantIds.length > 0) {
        await supabase.from("media_assets").delete().in("format_variant_id", variantIds)
        await supabase.from("format_variants").delete().eq("core_post_id", id)
      }
    } catch (cleanupErr) {
      console.warn("[core-posts][delete] cleanup warning:", cleanupErr)
    }

    const { error } = await supabase
      .from("core_posts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
