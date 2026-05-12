import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/core-posts/{id}/media
 *
 * Generic per-format media writer. Accepts an already-uploaded URL (the
 * client uploads to Supabase Storage directly so we get progress events)
 * and persists it to `media_assets` for the right `format_variant` row.
 *
 * Why a separate endpoint and not an extension of PATCH?
 *   The existing PATCH on /api/core-posts/{id} is hard-coded to the
 *   `talking_head` flow (it knows about heygen video URLs + cover_base64
 *   uploads). Bolting a generic `format`/`asset_type` shape onto the same
 *   handler would require unwinding the talking_head defaults — risky for
 *   a feature whose only consumer is the new MediaUploadFlow. A small
 *   focused endpoint is the cheaper move; the talking_head path can
 *   migrate to this endpoint later when we collapse the two.
 *
 * Body shape:
 *   - `format`: required. One of "story" | "talking_head" | "carousel" |
 *               "image_post" | "static". Identifies which `format_variants`
 *               row owns the asset. We auto-create the row when missing
 *               (matches the PATCH behaviour for talking_head video).
 *   - `url`:    required. The public URL of the asset (already uploaded
 *               via the storage client). The endpoint does NOT touch
 *               Supabase Storage — that's the client's job, so the user
 *               can see upload progress.
 *   - `assetType`: required. "video" | "image" | "cover". Drives the
 *                  `media_assets.asset_type` column the Sheet's readiness
 *                  + cover slot keys off.
 *
 * Behaviour:
 *   - Replaces the existing asset for (variant, asset_type). Each format
 *     has at most one of each asset_type at a time.
 *   - Auto-creates the format_variants row when missing, mirroring the
 *     PATCH talking_head path so the user can upload media before the
 *     format itself has been duplicated.
 */
export async function POST(
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

    // Sanity-check: the post belongs to this user. Without this an
    // attacker with a known post id could write to anyone's media_assets.
    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()
    if (postErr || !postRow) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { format, url, assetType } = (await req.json()) as {
      format?: string
      url?: string
      assetType?: string
    }

    // Validation surface — explicit messages so the client toast can
    // surface a useful failure cause (per lessons.md "Surface errors loudly").
    if (!format || typeof format !== "string") {
      return NextResponse.json({ error: "format is required" }, { status: 400 })
    }
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 })
    }
    if (!assetType || !["video", "image", "cover"].includes(assetType)) {
      return NextResponse.json(
        { error: "assetType must be one of video|image|cover" },
        { status: 400 },
      )
    }

    // Find or create the format_variant row. We don't enforce the format
    // against the global FORMATS list here — the column is a string and
    // future formats will land without a deploy gate.
    let { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", id)
      .eq("format", format)
      .single()

    if (!variant) {
      const { data: newVariant, error: insertErr } = await supabase
        .from("format_variants")
        .insert({ core_post_id: id, format, body: "" } as never)
        .select("id")
        .single()
      if (insertErr || !newVariant) {
        return NextResponse.json(
          { error: insertErr?.message ?? "Failed to create format variant" },
          { status: 500 },
        )
      }
      variant = newVariant
    }

    const variantRow = variant as unknown as { id: string }

    // Replace any existing asset of the same type. Each (variant, asset_type)
    // is a single slot — uploading a new image replaces the old one.
    await supabase
      .from("media_assets")
      .delete()
      .eq("format_variant_id", variantRow.id)
      .eq("asset_type", assetType)

    const { error: insertAssetErr } = await supabase
      .from("media_assets")
      .insert({
        format_variant_id: variantRow.id,
        asset_type: assetType,
        url,
        status: "completed",
      } as never)

    if (insertAssetErr) {
      return NextResponse.json(
        { error: insertAssetErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * DELETE /api/core-posts/{id}/media?format=X&assetType=Y
 *
 * Symmetric to POST — clears a single (variant, asset_type) slot. Used
 * by "Replace media" UX paths and by future "Remove media" actions.
 * Format + assetType travel as query params because DELETE bodies are
 * historically squirrely across HTTP intermediaries.
 */
export async function DELETE(
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

    const url = new URL(req.url)
    const format = url.searchParams.get("format")
    const assetType = url.searchParams.get("assetType")

    if (!format) {
      return NextResponse.json({ error: "format is required" }, { status: 400 })
    }
    if (!assetType || !["video", "image", "cover"].includes(assetType)) {
      return NextResponse.json(
        { error: "assetType must be one of video|image|cover" },
        { status: 400 },
      )
    }

    // Same ownership check as POST.
    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()
    if (postErr || !postRow) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", id)
      .eq("format", format)
      .single()
    if (!variant) {
      // Nothing to delete — return ok rather than 404 so the client can
      // call this idempotently on "remove" without checking first.
      return NextResponse.json({ ok: true })
    }
    const variantRow = variant as unknown as { id: string }

    await supabase
      .from("media_assets")
      .delete()
      .eq("format_variant_id", variantRow.id)
      .eq("asset_type", assetType)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
