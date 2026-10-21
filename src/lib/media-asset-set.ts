import type { createClient } from "@/lib/supabase/server"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Replace the FULL set of image assets for a multi-image format
 * (carousel, story). Each base64 PNG becomes one `media_assets` image row
 * under the format's variant. These formats are versioned as a GROUP — we
 * wipe the existing images and insert the new set, so partial replacement
 * never leaves stale frames.
 *
 *   - `images === null | []` clears the set (the UI's "delete" path).
 *   - The variant row is auto-created when missing (mirrors the /media
 *     endpoint), but only when there is actually a set to insert.
 *
 * Returns a discriminated result. A failed/So-called-silent wipe (RLS
 * mismatches match zero rows instead of erroring — this bit us on
 * 2026-07-09 with ~100 stale carousel slides) is surfaced as an error so
 * the caller can return a 500 instead of silently duplicating assets.
 * `changed` is false only when there was no variant and nothing to insert.
 */
export async function replaceImageAssetSet(
  supabase: ServerSupabase,
  userId: string,
  postId: string,
  format: string,
  images: string[] | null | undefined,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  let { data: variant } = await supabase
    .from("format_variants")
    .select("id")
    .eq("core_post_id", postId)
    .eq("format", format)
    .single()

  if (!variant && Array.isArray(images) && images.length > 0) {
    const { data: newVariant } = await supabase
      .from("format_variants")
      .insert({ core_post_id: postId, format, body: "" } as never)
      .select("id")
      .single()
    variant = newVariant
  }

  // No variant and nothing to insert — nothing to clear either.
  if (!variant) return { ok: true, changed: false }

  const variantRow = variant as unknown as { id: string }

  // Drop existing image assets — the set is replaced as a whole.
  const { error: wipeErr } = await supabase
    .from("media_assets")
    .delete()
    .eq("format_variant_id", variantRow.id)
    .eq("asset_type", "image")
  if (wipeErr) {
    return { ok: false, error: `${format}_wipe_failed: ${wipeErr.message}` }
  }

  // RLS mismatches don't error — they silently match zero rows. Verify the
  // wipe actually happened before inserting the new set.
  const { data: leftover } = await supabase
    .from("media_assets")
    .select("id")
    .eq("format_variant_id", variantRow.id)
    .eq("asset_type", "image")
    .limit(1)
  if (leftover && leftover.length > 0) {
    console.error(
      `[core-posts PATCH] ${format} wipe matched zero rows (RLS?)`,
      { variantId: variantRow.id },
    )
    return {
      ok: false,
      error: `${format}_wipe_failed: existing images could not be replaced`,
    }
  }

  // null/empty → just the deletion above. Otherwise upload + insert in order.
  if (Array.isArray(images) && images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      const base64 = images[i]
      if (!base64) continue

      // An entry that is ALREADY a stored URL is re-pointed, not re-uploaded.
      // Reordering a saved set sends back the same frames in a new order; the
      // wipe above only removed the rows, never the storage objects, so the
      // files are still there. Without this branch `Buffer.from(url,"base64")`
      // would decode the URL text as base64 and write a corrupt image over a
      // set the user only meant to rearrange.
      if (/^https?:\/\//i.test(base64)) {
        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "image",
          url: base64,
          status: "completed",
        } as never)
        continue
      }

      const buffer = Buffer.from(base64, "base64")
      const storagePath = `${userId}/${format}/${crypto.randomUUID()}.png`
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

  return { ok: true, changed: true }
}
