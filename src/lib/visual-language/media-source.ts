import type { SupabaseClient } from "@supabase/supabase-js"

const BUCKET_PREFIX = "/storage/v1/object/public/user-media/"

/**
 * The user-media path of an image the user is looking at in the panel.
 * Uses `mediaUrl` when it's an image in HER OWN storage folder; otherwise
 * (a story set still held as base64, say) the post's first saved image for
 * that format. Null when there's no usable image — e.g. a b-roll video.
 */
export async function resolveOwnImagePath(
  supabase: SupabaseClient,
  userId: string,
  format: string,
  mediaUrl?: string,
  postId?: string,
): Promise<string | null> {
  const ownPath = (url?: string | null) => {
    if (!url?.includes(BUCKET_PREFIX)) return null
    const path = decodeURIComponent(url.split(BUCKET_PREFIX)[1].split("?")[0])
    return path.startsWith(`${userId}/`) && /\.(png|jpe?g|webp)$/i.test(path) ? path : null
  }

  const direct = ownPath(mediaUrl)
  if (direct) return direct
  if (!postId || !["story", "carousel", "image_post"].includes(format)) return null

  const { data: variant } = await supabase
    .from("format_variants")
    .select("id, core_posts!inner(user_id)")
    .eq("core_post_id", postId)
    .eq("format", format)
    .eq("core_posts.user_id", userId)
    .maybeSingle()
  const variantId = (variant as { id?: string } | null)?.id
  if (!variantId) return null
  const { data: asset } = await supabase
    .from("media_assets")
    .select("url")
    .eq("format_variant_id", variantId)
    .eq("asset_type", "image")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return ownPath((asset as { url?: string } | null)?.url)
}
