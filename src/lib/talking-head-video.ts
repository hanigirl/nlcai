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

/**
 * What Ben's transcription needs to spell her words right (lib/transcribe):
 * the post's script (hook + talking-head text), her brand names, her Claude
 * key — the same as api/talking-head/transcribe passes.
 */
export async function transcriptionContext(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
): Promise<{ script: string; names: string[]; anthropicKey: string | null }> {
  const { getUserApiKey } = await import("@/lib/api-keys")
  const [{ data: postRow }, { data: variantRow }, { data: userRow }, anthropicKey] = await Promise.all([
    supabase.from("core_posts").select("hook_text").eq("id", postId).maybeSingle(),
    supabase.from("format_variants").select("body").eq("core_post_id", postId).eq("format", "talking_head").maybeSingle(),
    supabase.from("users").select("visual_language").eq("id", userId).maybeSingle(),
    getUserApiKey(supabase, "anthropic_api_key").catch(() => null),
  ])
  const script = [
    (postRow as { hook_text?: string | null } | null)?.hook_text,
    (variantRow as { body?: string | null } | null)?.body,
  ]
    .filter(Boolean)
    .join("\n")
  const vl = (userRow as { visual_language?: { elements?: { name?: string }[] } | null } | null)?.visual_language
  const names = (vl?.elements ?? []).map((e) => e.name ?? "").filter(Boolean)
  return { script, names, anthropicKey }
}
