/**
 * Talking-head cover: which colour the hook's text background defaults to.
 *
 * Her primary brand colour (the first one she set in Settings → שפה ויזואלית,
 * `users.brand_colors[0]`), or black when she has none. It is a DEFAULT, not a
 * lock: the colour she picks on a post's cover wins and is saved on the post.
 *
 * Shared by the client (initial picker value) and the cover route (when a
 * caller sends no colour). Deliberately separate from lib/visual-language/*,
 * which is being rewritten elsewhere — this only reads `brand_colors`.
 */

export const COVER_FALLBACK_COLOR = "#000000"

const HEX = /^#[0-9a-fA-F]{6}$/

export function isCoverHex(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v)
}

/** Her saved brand colours, cleaned to valid 6-digit hex, in her order. */
export function cleanBrandColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isCoverHex).slice(0, 3)
}

/** Primary brand colour, or black. */
export function defaultCoverColor(brandColors: string[]): string {
  return brandColors[0] ?? COVER_FALLBACK_COLOR
}
