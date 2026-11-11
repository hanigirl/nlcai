import type { SupabaseClient } from "@supabase/supabase-js"
import type { BrandStyle } from "@/lib/supabase/types"
import { getUserApiKey } from "@/lib/api-keys"
import { analyzeBrandStyle } from "@/lib/agents/brand-style-analyzer"
import { exampleUsable, userExampleKind } from "@/lib/visual-language/types"

/**
 * Her cover examples as the cover's style (Hani, 2026-11-07: "הקאבר — לפי
 * הגדרות הקאבר ודוגמאות לשימוש"). The examples filed under Settings → מדיה →
 * דוגמאות לשימוש → קאברים are read once by the brand-style analyzer
 * (lib/agents/brand-style-analyzer) into a BrandStyle the cover renderer
 * already knows, and kept in users.brand_style with the set it came from —
 * read again only when she changes her examples.
 *
 * null: no cover examples (the default cover: Rubik on black, or on her main
 * brand colour), or they couldn't be read — never a failed cover.
 */
type StoredStyle = BrandStyle & { examples_sig?: string }

export async function coverStyleFromExamples(supabase: SupabaseClient, userId: string): Promise<BrandStyle | null> {
  const { data } = await supabase
    .from("user_media")
    .select("id, storage_path, metadata")
    .eq("user_id", userId)
    .eq("category", "brand_example")
  const rows = ((data ?? []) as { id: string; storage_path: string; metadata: Record<string, unknown> | null }[])
    // Pictures only — a saved link is a page, not an image to read.
    .filter((r) => userExampleKind(r.metadata) === "cover" && typeof r.metadata?.url !== "string" && exampleUsable(r.metadata))
  if (!rows.length) return null
  const sig = rows.map((r) => r.id).sort().join(",")

  const { data: me } = await supabase.from("users").select("brand_style").eq("id", userId).maybeSingle()
  const stored = (me as { brand_style?: StoredStyle | null } | null)?.brand_style ?? null
  if (stored && stored.examples_sig === sig) return stored

  try {
    const key = await getUserApiKey(supabase, "anthropic_api_key")
    const images = rows.map((r) => supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl)
    const style = await analyzeBrandStyle(key, images)
    const next: StoredStyle = { ...style, examples_sig: sig }
    await supabase.from("users").update({ brand_style: next } as never).eq("id", userId)
    return next
  } catch (err) {
    console.error("[cover-from-examples]", err instanceof Error ? err.message : err)
    return stored ?? null
  }
}
