import type { SupabaseClient } from "@supabase/supabase-js"
import { BROLL_VIDEO_CTA, hasDescriptionCta } from "@/lib/broll-copy"
import { canOwnMediaText, staticBRollText } from "@/lib/feature-access"
import type { MediaStyle, VisualFormat, VisualLanguage } from "@/lib/visual-language/types"
import type { BrandFont, CompositionBrief } from "./compose"
import { brandPalette, resolveDesignDirection, type DesignDirection } from "@/lib/visual-language/direction"
import { languageKey, languageLines, pieceLines, styleOfLines } from "@/lib/visual-language/current-brief"

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

/**
 * Her fonts, primary first. The role is set in Settings → Media → Fonts;
 * without one, the first font she added is the primary and the rest are
 * secondary.
 */
export async function loadBrandFonts(supabase: SupabaseClient, userId: string): Promise<BrandFont[]> {
  const { data } = await supabase
    .from("user_media")
    .select("file_name, storage_path, metadata")
    .eq("user_id", userId)
    .eq("category", "font")
    .order("created_at", { ascending: true })
  const rows = (data ?? []) as { file_name: string; storage_path: string; metadata: { role?: string } | null }[]
  const fonts = rows.map((r): BrandFont => {
    const role = r.metadata?.role === "primary" || r.metadata?.role === "secondary" ? r.metadata.role : undefined
    if (r.storage_path.startsWith("google:")) {
      return { kind: "google", family: r.storage_path.slice("google:".length), role }
    }
    const url = supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl
    return { kind: "file", family: familyFromName(r.file_name), url, role }
  })
  const primaryAt = Math.max(0, fonts.findIndex((f) => f.role === "primary"))
  return fonts
    .map((f, i) => ({ ...f, role: i === primaryAt ? ("primary" as const) : ("secondary" as const) }))
    .sort((a, b) => (a.role === "primary" ? -1 : b.role === "primary" ? 1 : 0))
}

export async function buildCompositionBrief(
  supabase: SupabaseClient,
  userId: string,
  text: { hook: string; rest?: string },
  styleLines: string[],
  style: MediaStyle | undefined,
): Promise<CompositionBrief> {
  // "חדש לגמרי": none of her brand — default fonts, a palette from the brief.
  if (style === "blank") {
    return {
      hook: text.hook,
      rest: text.rest,
      cta: hasDescriptionCta(text.hook, text.rest) ? null : BROLL_VIDEO_CTA,
      palette: [],
      fonts: [],
      styleSpec: styleLines.join("\n"),
    }
  }
  const [fonts, { data: userRow }] = await Promise.all([
    loadBrandFonts(supabase, userId),
    supabase.from("users").select("brand_colors, visual_language, email").eq("id", userId).single(),
  ])
  const row = userRow as {
    brand_colors?: string[] | null
    visual_language?: VisualLanguage | null
    email?: string | null
  } | null
  const vl = row?.visual_language
  const brandWins = canOwnMediaText(row?.email)
  const staticText = staticBRollText(row?.email)
  const useBrandPalette = (!style || style === "brand") && vl?.status === "ok" && vl.palette?.length
  // Gated: her brand colours win; the analysed palette (which can carry
  // colours read off her examples) only fills in when she set none.
  const palette = brandWins
    ? brandPalette(row?.brand_colors, useBrandPalette ? vl!.palette : [])
    : useBrandPalette
      ? vl!.palette
      : (row?.brand_colors ?? []).map((hex, i) => ({ hex, role: i === 0 ? "primary brand colour" : "brand colour" }))

  return {
    hook: text.hook,
    rest: text.rest,
    cta: hasDescriptionCta(text.hook, text.rest) ? null : BROLL_VIDEO_CTA,
    palette,
    fonts,
    styleSpec: styleLines.join("\n"),
    ...(brandWins ? { brandWins: true } : {}),
    ...(staticText ? { staticText: true } : {}),
  }
}

function compositionLanguageKey(b: CompositionBrief): string {
  return languageKey({
    lines: languageLines(b.styleSpec.split("\n")),
    palette: b.palette.map((p) => [p.hex.toLowerCase(), p.role]),
    fonts: b.fonts.map((f) => [f.family, f.kind === "file" ? f.url : "", f.role ?? ""]),
  })
}

/**
 * A stored b-roll / animated-frame brief with its language read fresh from
 * her settings (lib/visual-language/current-brief) — same look it was made
 * in, or hers when she asks for it. Its words, notes and her design wording
 * are kept. `direction`: for a new background. `changed`: the clip still
 * shows a language she has since replaced.
 */
export async function currentCompositionBrief(
  supabase: SupabaseClient,
  userId: string,
  stored: CompositionBrief,
  opts: { format: VisualFormat; ownLanguage?: boolean },
): Promise<{ brief: CompositionBrief; direction: DesignDirection; changed: boolean }> {
  const lines = stored.styleSpec.split("\n")
  const madeIn = styleOfLines(lines)
  const wanted: MediaStyle = opts.ownLanguage ? "brand" : madeIn
  const base = await resolveDesignDirection(supabase, userId, {
    format: opts.format,
    allowReferences: false,
    ...(wanted === "brand" ? {} : { style: wanted }),
  })
  const style: MediaStyle = wanted === "brand" && base.source !== "brand" ? "niche" : wanted
  const direction = { ...base, lines: [...base.lines, ...pieceLines(lines)] }
  const fresh = await buildCompositionBrief(supabase, userId, { hook: stored.hook, rest: stored.rest }, direction.lines, style)
  const brief: CompositionBrief = {
    ...stored,
    palette: fresh.palette,
    fonts: fresh.fonts,
    styleSpec: fresh.styleSpec,
    brandWins: fresh.brandWins,
    staticText: fresh.staticText,
  }
  return { brief, direction, changed: compositionLanguageKey(brief) !== compositionLanguageKey(stored) }
}
