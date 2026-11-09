import type { SupabaseClient } from "@supabase/supabase-js"
import type { SlideData } from "@/lib/carousel-templates"
import type { CarouselBrief } from "@/lib/carousel-composition"
import { loadBrandFonts } from "@/lib/broll-animation/brief"
import { reservedZoneLines } from "@/lib/visual-language/fixed-elements"
import { canOwnMediaText } from "@/lib/feature-access"
import { brandPalette, resolveDesignDirection, type DesignDirection } from "@/lib/visual-language/direction"
import { userExampleKind, type MediaStyle, type VisualLanguage } from "@/lib/visual-language/types"
import { languageKey, languageLines, pieceLines, styleOfLines } from "@/lib/visual-language/current-brief"

/**
 * The brief a carousel layout is designed from — built the same way when it
 * is first generated (/api/carousel/generate-ai) and every time it is edited
 * (/api/media/ai-edit), so an edit always reads her CURRENT visual language,
 * never the snapshot the carousel was first made in.
 */

const W = 1080
const H = 1350

/**
 * Her carousel usage examples — the template the layout copies one-to-one.
 * The ones she filed under "קרוסלה" in Settings; else the ones the analysis
 * recognised as carousel slides; else all of them.
 */
export async function carouselExamples(
  supabase: SupabaseClient,
  userId: string,
  vl: VisualLanguage | null | undefined,
): Promise<string[]> {
  const { data } = await supabase
    .from("user_media")
    .select("id, storage_path, metadata")
    .eq("user_id", userId)
    .eq("category", "brand_example")
    .order("created_at", { ascending: true })
  const rows = (data ?? []) as { id: string; storage_path: string; metadata: Record<string, unknown> | null }[]
  const filed = rows.filter((r) => userExampleKind(r.metadata) === "carousel")
  const carouselIds = new Set((vl?.example_kinds ?? []).filter((k) => k.kind === "carousel").map((k) => k.id))
  const recognised = rows.filter((r) => carouselIds.has(r.id))
  const picked = filed.length ? filed : recognised.length ? recognised : rows
  return picked
    .filter((r) => /\.(png|jpe?g|webp|gif)$/i.test(r.storage_path))
    .slice(0, 6)
    .map((r) => supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl)
}

/** `direction`: already carrying her direction for this piece (withMediaBrief), if any. */
export async function buildCarouselBrief(
  supabase: SupabaseClient,
  userId: string,
  input: { slides: SlideData[]; style: MediaStyle; direction: DesignDirection },
): Promise<CarouselBrief> {
  const isBrand = input.style === "brand"
  const isBlank = input.style === "blank"
  const [fonts, { data: userRow }] = await Promise.all([
    // "חדש לגמרי": default fonts and a palette from her brief.
    isBlank ? Promise.resolve([]) : loadBrandFonts(supabase, userId),
    supabase.from("users").select("brand_colors, visual_language, email").eq("id", userId).single(),
  ])
  const row = userRow as {
    brand_colors?: string[] | null
    visual_language?: VisualLanguage | null
    email?: string | null
  } | null
  const brandWins = canOwnMediaText(row?.email)
  // Gated: her brand colours win; the analysed palette (which can carry
  // colours read off her examples) only fills in when she set none.
  const palette = isBlank
    ? []
    : brandWins
      ? brandPalette(row?.brand_colors, isBrand ? row?.visual_language?.palette : [])
      : isBrand && row?.visual_language?.palette?.length
        ? row.visual_language.palette
        : (row?.brand_colors ?? []).map((hex, i) => ({ hex, role: i === 0 ? "primary brand colour" : "brand colour" }))
  return {
    slides: input.slides,
    fonts,
    palette,
    styleLines: input.direction.lines,
    reservedLines: reservedZoneLines(input.direction.fixed, "content", W, H),
    examples: isBrand ? await carouselExamples(supabase, userId, row?.visual_language) : [],
    // Gated: her brand colours set the palette — the examples go out in
    // grayscale and the prompt says they set the composition only.
    ...(brandWins ? { brandWins: true, examplesGray: (row?.brand_colors ?? []).length > 0 } : {}),
    pastedElements: input.direction.fixed.map((el) => el.name),
    style: input.style,
  }
}

/** Everything in a brief that comes from her visual language (not from this carousel). */
export function carouselLanguageKey(b: CarouselBrief): string {
  return languageKey({
    lines: languageLines(b.styleLines),
    palette: b.palette.map((p) => [p.hex.toLowerCase(), p.role]),
    fonts: b.fonts.map((f) => [f.family, f.kind === "file" ? f.url : "", f.role ?? ""]),
    examples: b.examples ?? [],
    pasted: b.pastedElements ?? [],
  })
}

/**
 * The stored carousel's brief, rebuilt from her current settings: the same
 * look it was made in (her language / niche / dark / light / blank), read
 * fresh, plus its own slides and her direction for it.
 *
 * `ownLanguage`: she asked for her visual language — use it even if the
 * carousel was made in another look. `changed`: the language differs from
 * the one the carousel was designed in, so its slides still show the old one.
 */
export async function currentCarouselBrief(
  supabase: SupabaseClient,
  userId: string,
  stored: CarouselBrief,
  opts: { ownLanguage?: boolean } = {},
): Promise<{ brief: CarouselBrief; direction: DesignDirection; changed: boolean }> {
  const madeIn = stored.style ?? styleOfLines(stored.styleLines)
  const wanted: MediaStyle = opts.ownLanguage ? "brand" : madeIn
  const base = await resolveDesignDirection(supabase, userId, {
    format: "carousel",
    ...(wanted === "brand" ? {} : { style: wanted }),
  })
  // Her language was deleted or no longer analyses as one: the niche look
  // takes its place — never the old one.
  const style: MediaStyle = wanted === "brand" && base.source !== "brand" ? "niche" : wanted
  const direction = { ...base, lines: [...base.lines, ...pieceLines(stored.styleLines)] }
  const brief = await buildCarouselBrief(supabase, userId, { slides: stored.slides, style, direction })
  return { brief, direction, changed: carouselLanguageKey(brief) !== carouselLanguageKey(stored) }
}
