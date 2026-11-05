/**
 * Which network takes which format — the one place that decides it.
 *
 * Pure, no server imports: the calendar preview reads the same table the
 * publish bridge does, so the networks a post "goes to" on screen are exactly
 * the ones the server will queue it on.
 *
 * Hani's rules (2026-11-05):
 *   - YouTube takes video only (talking head / b-roll), and needs a title —
 *     the hook.
 *   - LinkedIn takes video, a single image, or a carousel of up to 9 images.
 *   - Stories stay Instagram-only.
 *   - TikTok is not here yet: there is no account to test it with, and a
 *     network we never saw publish is a network we can't promise.
 */

import type { SocialPlatform, YouTubePrivacy } from "@/lib/supabase/types"

/** Display order everywhere — Instagram first, it's where she started. */
export const PUBLISH_PLATFORMS: SocialPlatform[] = ["instagram", "youtube", "linkedin"]

export const NETWORK_LABEL: Record<SocialPlatform, string> = {
  instagram: "אינסטגרם",
  youtube: "YouTube",
  linkedin: "LinkedIn",
}

const VIDEO_FORMATS = new Set(["talking_head", "b_roll"])
const IMAGE_FORMATS = new Set(["carousel", "image_post"])

/** Does this network take this format at all? */
export function networkFitsFormat(platform: SocialPlatform, format: string): boolean {
  switch (platform) {
    case "instagram":
      return true
    case "youtube":
      return VIDEO_FORMATS.has(format)
    case "linkedin":
      return VIDEO_FORMATS.has(format) || IMAGE_FORMATS.has(format)
  }
}

/** The networks a format can go to, in display order. */
export function networksForFormat(format: string): SocialPlatform[] {
  return PUBLISH_PLATFORMS.filter((p) => networkFitsFormat(p, format))
}

/** Caption ceilings as each network enforces them. */
export const MAX_CAPTION_BY_NETWORK: Record<SocialPlatform, number> = {
  instagram: 2200,
  // LinkedIn's post commentary limit.
  linkedin: 3000,
  // YouTube's description limit.
  youtube: 5000,
}

/** LinkedIn's document-free image post caps out at 9 images. */
export const LINKEDIN_MAX_IMAGES = 9

/** YouTube refuses titles over 100 characters. */
export const YOUTUBE_TITLE_MAX = 100

/**
 * The YouTube title, from the hook. A hook over 100 characters is cut at the
 * last whole word and marked with an ellipsis, so the title never ends
 * mid-word.
 */
export function youtubeTitleFromHook(hook: string): string {
  const clean = hook.replace(/\s+/g, " ").trim()
  if (clean.length <= YOUTUBE_TITLE_MAX) return clean
  const cut = clean.slice(0, YOUTUBE_TITLE_MAX - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/** YouTube privacy, per post (Hani, 2026-11-05). Default public. */
export const YOUTUBE_PRIVACY_OPTIONS: { id: YouTubePrivacy; label: string }[] = [
  { id: "public", label: "ציבורי" },
  { id: "unlisted", label: "לא רשום" },
  { id: "private", label: "פרטי" },
]

export const DEFAULT_YOUTUBE_PRIVACY: YouTubePrivacy = "public"

export function isYouTubePrivacy(v: unknown): v is YouTubePrivacy {
  return v === "public" || v === "unlisted" || v === "private"
}

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return v === "instagram" || v === "youtube" || v === "linkedin"
}

/** "באינסטגרם" / "ב-YouTube" — Hebrew prefixes fuse with Hebrew words and hyphenate before Latin. */
export function inNetwork(platform: SocialPlatform): string {
  return platform === "instagram" ? "באינסטגרם" : `ב-${NETWORK_LABEL[platform]}`
}

/** "לאינסטגרם" / "ל-LinkedIn". */
export function toNetwork(platform: SocialPlatform): string {
  return platform === "instagram" ? "לאינסטגרם" : `ל-${NETWORK_LABEL[platform]}`
}
