import type { SupabaseClient } from "@supabase/supabase-js"

/** The post's talking-head video — her latest one (as api/talking-head/transcribe reads it). */
export async function talkingHeadVideoUrl(supabase: SupabaseClient, postId: string): Promise<string | null> {
  const { data: variant } = await supabase
    .from("format_variants")
    .select("id")
    .eq("core_post_id", postId)
    .eq("format", "talking_head")
    .maybeSingle()
  if (!variant) return null
  const { data: asset } = await supabase
    .from("media_assets")
    .select("url")
    .eq("format_variant_id", (variant as { id: string }).id)
    .eq("asset_type", "video")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (asset as { url: string | null } | null)?.url ?? null
}
