import type { SupabaseClient } from "@supabase/supabase-js"
import { BROLL_VIDEO_CTA, hasDescriptionCta } from "@/lib/broll-copy"
import type { MediaStyle, VisualLanguage } from "@/lib/visual-language/types"
import type { BrandFont, CompositionBrief } from "./compose"

/**
 * Everything Opus needs to set her hook in her brand: the text, her fonts
 * (Settings → Media: uploaded files or Google Fonts) and her colours (the
 * analysed palette, else the raw brand colours).
 */

/** "Assistant (Google Fonts)" → "Assistant"; "MyFont-Bold.otf" → "MyFont-Bold". */
function familyFromName(fileName: string): string {
  return fileName
    .replace(/\s*\(Google Fonts\)\s*$/i, "")
    .replace(/\.(ttf|otf|woff2?|eot)$/i, "")
    .trim()
}

export async function loadBrandFonts(supabase: SupabaseClient, userId: string): Promise<BrandFont[]> {
  const { data } = await supabase
    .from("user_media")
    .select("file_name, storage_path")
    .eq("user_id", userId)
    .eq("category", "font")
  const rows = (data ?? []) as { file_name: string; storage_path: string }[]
  return rows.map((r): BrandFont => {
    if (r.storage_path.startsWith("google:")) {
      return { kind: "google", family: r.storage_path.slice("google:".length) }
    }
    const url = supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl
    return { kind: "file", family: familyFromName(r.file_name), url }
  })
}

export async function buildCompositionBrief(
  supabase: SupabaseClient,
  userId: string,
  text: { hook: string; rest?: string },
  styleLines: string[],
  style: MediaStyle | undefined,
): Promise<CompositionBrief> {
  const [fonts, { data: userRow }] = await Promise.all([
    loadBrandFonts(supabase, userId),
    supabase.from("users").select("brand_colors, visual_language").eq("id", userId).single(),
  ])
  const row = userRow as { brand_colors?: string[] | null; visual_language?: VisualLanguage | null } | null
  const vl = row?.visual_language
  const useBrandPalette = (!style || style === "brand") && vl?.status === "ok" && vl.palette?.length
  const palette = useBrandPalette
    ? vl!.palette
    : (row?.brand_colors ?? []).map((hex, i) => ({ hex, role: i === 0 ? "primary brand colour" : "brand colour" }))

  return {
    hook: text.hook,
    rest: text.rest,
    cta: hasDescriptionCta(text.hook, text.rest) ? null : BROLL_VIDEO_CTA,
    palette,
    fonts,
    styleSpec: styleLines.join("\n"),
  }
}
