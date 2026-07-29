import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { FORMAT_TYPES, type FormatType } from "@/lib/supabase/types"
import { getAuthUser } from "@/lib/auth-user"
import { BROLL_SCRIPT_CTA } from "@/lib/broll-copy"

/**
 * The `format_type` enum. Imported, not mirrored — the local copy that used to
 * live here fell a format behind: b_roll was added to the type, the migration
 * and five UI files, and this array kept rejecting it, so pasting a Drive link
 * for a b-roll failed with "format must be one of story|talking_head|carousel|
 * image_post". types.ts has no React dependency, so there's nothing to keep the
 * route away from it.
 */

const FORMAT_IDS = FORMAT_TYPES
type FormatId = FormatType

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
 *   - `format`: required. Any member of the `format_type` enum — see
 *               FORMAT_TYPES in lib/supabase/types.ts, which this validates
 *               against rather than restating.
 *               Identifies which `format_variants` row owns the asset. We
 *               auto-create the row when missing (matches the PATCH behaviour
 *               for talking_head video). NOTE: "static" is a client-side alias
 *               for "image_post" and is NOT accepted here; it is not an enum
 *               member and reaches Postgres as a 22P02.
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
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Sanity-check: the post belongs to this user. Without this an
    // attacker with a known post id could write to anyone's media_assets.
    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id, hook_text")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()
    if (postErr || !postRow) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    const post = postRow as unknown as { id: string; hook_text: string | null }

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
    // `format_variants.format` is the `format_type` ENUM (declared in
    // 001_initial_schema.sql, extended by 031 for b_roll). An unknown value is
    // not a soft failure — Postgres rejects the insert with 22P02 and the user
    // gets an opaque 500. Reject it here with something readable instead.
    if (!FORMAT_IDS.includes(format as FormatId)) {
      return NextResponse.json(
        { error: `format must be one of ${FORMAT_IDS.join("|")}` },
        { status: 400 },
      )
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

    // Find or create the format_variant row. `format` is already validated
    // against the enum above — a new format needs a migration on `format_type`
    // before it can land here, so this is a deploy gate by design.
    let { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", id)
      .eq("format", format)
      .single()

    if (!variant) {
      // b_roll is the one format with no generation step — its script IS the
      // post's hook, which is also the text burned over the footage. Creating
      // it with an empty body (as every other format is created here, since
      // theirs arrives later from the generator) left the card reading "empty"
      // with media already attached, and the hook missing from the format
      // entirely. Seed it here, where the row is born.
      const seedBody =
        format === "b_roll"
          ? [(post.hook_text ?? "").trim(), BROLL_SCRIPT_CTA]
              .filter(Boolean)
              .join("\n\n")
          : ""
      const { data: newVariant, error: insertErr } = await supabase
        .from("format_variants")
        .insert({ core_post_id: id, format, body: seedBody } as never)
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
    //
    // The delete's result used to be discarded. RLS mismatches don't raise, they
    // match zero rows — so a silently-failed wipe let the insert below stack a
    // second row in the same slot, and the reader then picked between them
    // arbitrarily. Verify the slot is actually empty before inserting.
    const { error: wipeErr } = await supabase
      .from("media_assets")
      .delete()
      .eq("format_variant_id", variantRow.id)
      .eq("asset_type", assetType)
    if (wipeErr) {
      return NextResponse.json(
        { error: `slot_replace_failed: ${wipeErr.message}` },
        { status: 500 },
      )
    }
    const { data: leftover } = await supabase
      .from("media_assets")
      .select("id")
      .eq("format_variant_id", variantRow.id)
      .eq("asset_type", assetType)
      .limit(1)
    if (leftover && leftover.length > 0) {
      console.error(
        `[core-posts media POST] ${assetType} wipe matched zero rows (RLS?)`,
        { variantId: variantRow.id, format },
      )
      return NextResponse.json(
        { error: "slot_replace_failed: existing asset could not be replaced" },
        { status: 500 },
      )
    }

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

    // Bump core_posts.updated_at so the /core_posts listing surfaces this
    // post as the most-recently-edited (the trigger sets the timestamp on
    // any UPDATE).
    await supabase
      .from("core_posts")
      .update({ updated_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("user_id", user.id)

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
    const user = await getAuthUser(supabase)
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
      .select("id, hook_text")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()
    if (postErr || !postRow) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    const post = postRow as unknown as { id: string; hook_text: string | null }

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

    // Bump core_posts.updated_at so a media removal also counts as an
    // edit for the /core_posts "recently edited" sort.
    await supabase
      .from("core_posts")
      .update({ updated_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("user_id", user.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
