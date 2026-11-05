/**
 * An `<img src>` for a media item that can arrive in either shape the app
 * passes around: a stored URL (what the post loads with, and what the AI edit
 * panel hands back) or raw base64 straight out of a generation.
 *
 * Wrapping a URL in `data:image/png;base64,` is what broke the "הקרוסלה שלך"
 * tile (2026-11-05) — the panel assumed base64 while the page fed it URLs.
 */
export function imageSrc(value: string): string {
  return /^(https?:|data:|blob:)/.test(value)
    ? value
    : `data:image/png;base64,${value}`
}
