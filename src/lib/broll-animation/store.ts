import type { SupabaseClient } from "@supabase/supabase-js"
import type { CompositionBrief } from "./compose"
import { styleOfLines } from "@/lib/visual-language/current-brief"

/**
 * A generated b-roll is three things in storage, side by side under one stamp:
 *   <user>/b_roll/<stamp>.mp4        — the clip (what media_assets points at)
 *   <user>/b_roll/<stamp>.json       — the composition: Opus's HTML template,
 *                                      the brief it was written from, and the
 *                                      background URL
 *   <user>/b_roll/<stamp>-bg.png     — the background image
 * "עריכה עם AI" finds the JSON from the clip's URL, so no schema change.
 */

export interface StoredComposition {
  template: string
  brief: CompositionBrief
  backgroundUrl: string
  /** Instructions applied so far, oldest first — context for the next edit. */
  edits: string[]
  /**
   * The background is HER picture (attached in the chat), not a generated
   * one: no edit or restyle ever repaints or replaces it.
   */
  ownBackground?: boolean
  /** How long each stage of the first build took, ms — measurement only. */
  timing?: Record<string, number>
}

/**
 * Her picture is the background — the flag, or (clips built on her picture
 * before the flag existed) the line the motion design was given about it.
 */
export function hasOwnBackground(c: StoredComposition): boolean {
  return c.ownBackground === true || c.brief.styleSpec.includes("THE BACKGROUND IS THE CREATOR'S OWN PICTURE")
}

const BUCKET = "user-media"

export function compositionPathForClip(clipUrl: string): string | null {
  const m = /\/user-media\/(.+\/b_roll\/[0-9a-f-]{36})\.mp4(?:\?.*)?$/i.exec(clipUrl)
  return m ? `${m[1]}.json` : null
}

export async function uploadBackground(
  supabase: SupabaseClient,
  userId: string,
  stamp: string,
  png: Buffer,
): Promise<string> {
  const path = `${userId}/b_roll/${stamp}-bg.png`
  const { error } = await supabase.storage.from(BUCKET).upload(path, png, { contentType: "image/png" })
  if (error) throw new Error(error.message)
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

export async function loadComposition(
  supabase: SupabaseClient,
  clipUrl: string,
): Promise<StoredComposition | null> {
  const path = compositionPathForClip(clipUrl)
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text()) as StoredComposition
  } catch {
    return null
  }
}

/** Upload clip + composition, and make the clip THE b-roll of the post. */
export async function saveBRoll(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  stamp: string,
  clip: Buffer,
  composition: StoredComposition,
): Promise<string> {
  const clipPath = `${userId}/b_roll/${stamp}.mp4`
  const { error: clipErr } = await supabase.storage
    .from(BUCKET)
    .upload(clipPath, clip, { contentType: "video/mp4" })
  if (clipErr) throw new Error(clipErr.message)
  const { error: jsonErr } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}/b_roll/${stamp}.json`, JSON.stringify(composition), {
      contentType: "application/json",
    })
  if (jsonErr) throw new Error(jsonErr.message)
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(clipPath).data.publicUrl

  // Auto-create the variant row: the user can generate a b-roll before the
  // post has been duplicated to that format.
  let { data: variant } = await supabase
    .from("format_variants")
    .select("id")
    .eq("core_post_id", postId)
    .eq("format", "b_roll")
    .maybeSingle()
  if (!variant) {
    const { data: created } = await supabase
      .from("format_variants")
      .insert({ core_post_id: postId, format: "b_roll", body: "" } as never)
      .select("id")
      .single()
    variant = created
  }
  if (!variant) throw new Error("b_roll_variant_missing")
  const variantId = (variant as unknown as { id: string }).id

  // One b-roll per post, and it's a clip — clear BOTH slots so a generated
  // video can't sit alongside a stale still from an earlier run.
  await supabase
    .from("media_assets")
    .delete()
    .eq("format_variant_id", variantId)
    .in("asset_type", ["image", "video"])
  await supabase.from("media_assets").insert({
    format_variant_id: variantId,
    asset_type: "video",
    url: publicUrl,
    status: "completed",
    // The look it was made in — read from its brief, so an edit keeps the
    // generation's ("חדש לגמרי" stays blank) and the panel reopens on it.
    metadata: { style: styleOfLines(composition.brief.styleSpec.split("\n")) },
  } as never)

  return publicUrl
}
