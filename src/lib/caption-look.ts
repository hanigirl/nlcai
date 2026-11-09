import type { SupabaseClient } from "@supabase/supabase-js"
import type { BrandStyle } from "@/lib/supabase/types"
import type { CaptionStyle } from "@/lib/own-media"

/**
 * The look of the script's text on HER media — one answer for every format
 * (Hani, 2026-11-09: "with visual language or without, totally new, dark or
 * light, no matter what").
 *
 * The words always sit on a SOLID box, so they read on any picture — dark or
 * light — without guessing the picture's brightness. With a brand style she
 * set (users.brand_style), the box and words take her colours; a pair that
 * wouldn't read (too little contrast) falls back to the default. Without one
 * (a new user), the default: white words on a black box.
 */

const HEX = /^#[0-9a-f]{6}$/i
const DEFAULT: Required<Pick<CaptionStyle, "pill" | "text">> = { pill: "#000000", text: "#ffffff" }

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two #hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Her brand colours as a caption look, or the default when there are none / they don't read. */
export function captionLookFromBrand(brand: Partial<BrandStyle> | null | undefined): CaptionStyle {
  const text = brand?.text_color && HEX.test(brand.text_color) ? brand.text_color : undefined
  const box =
    (brand?.has_text_background && brand.text_background_color && HEX.test(brand.text_background_color)
      ? brand.text_background_color
      : undefined) ?? (brand?.accent_color && HEX.test(brand.accent_color) ? brand.accent_color : undefined)
  if (!text || !box || contrast(text, box) < 4.5) return { ...DEFAULT }
  return { pill: box, text }
}

/**
 * Text on media from Google Drive (Hani, 2026-11-09): white words, each line
 * on its own rounded box — her primary brand colour, or black. A primary too
 * light for white words to read on (contrast under 3) falls back to black.
 */
export function driveCaptionLook(brandColors: unknown): CaptionStyle {
  const primary = Array.isArray(brandColors) ? brandColors.find((c) => typeof c === "string" && HEX.test(c)) : undefined
  const pill = primary && contrast(primary, "#ffffff") >= 3 ? primary : DEFAULT.pill
  return { pill, text: "#ffffff", perLine: true }
}

export async function captionLookFor(supabase: SupabaseClient, userId: string): Promise<CaptionStyle> {
  const { data } = await supabase.from("users").select("brand_colors").eq("id", userId).maybeSingle()
  return driveCaptionLook((data as { brand_colors?: unknown } | null)?.brand_colors)
}
