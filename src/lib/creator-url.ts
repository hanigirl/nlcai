import type { CreatorPlatform } from "@/lib/supabase/types"

export interface ParsedCreator {
  url: string
  handle: string
  platform: CreatorPlatform
}

// Platforms we actually scrape/process. `other` is what the parser falls
// back to for random URLs (e.g. google.com, a personal site). Onboarding
// and Settings reject `other` because the downstream Apify pipeline can't
// extract content from arbitrary sites.
const KNOWN_CREATOR_PLATFORMS: ReadonlyArray<CreatorPlatform> = [
  "instagram",
  "youtube",
  "tiktok",
  "linkedin",
]

export function isKnownCreatorPlatform(platform: CreatorPlatform): boolean {
  return KNOWN_CREATOR_PLATFORMS.includes(platform)
}

// Validates a user-typed creator input. Returns null if it's a valid
// creator on a supported platform, otherwise an error message describing
// what's wrong. Empty input returns null (treated as "row not filled yet",
// not an error — emptiness is enforced separately).
export function validateCreatorInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Detect "looks like a known platform but parser rejected it" vs.
  // "totally unknown URL" so the error message can be specific.
  const lower = trimmed.toLowerCase()
  const looksLikeKnownPlatform =
    lower.includes("instagram.com") ||
    lower.includes("tiktok.com") ||
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("linkedin.com")

  const parsed = parseCreatorInput(trimmed)
  if (!parsed) {
    if (looksLikeKnownPlatform) {
      return "הקישור הזה לא מוביל לפרופיל של יוצר. הדביקו קישור ישיר לחשבון — למשל instagram.com/USERNAME, tiktok.com/@USERNAME או youtube.com/@USERNAME."
    }
    return "הקישור לא תקין. הדביקו קישור ישיר לפרופיל באיסטגרם, טיקטוק או יוטיוב."
  }
  if (!isKnownCreatorPlatform(parsed.platform)) {
    return "הקישור הזה לא נראה כמו פרופיל של איסטגרם, טיקטוק או יוטיוב. הדביקו קישור לחשבון של היוצר באחת מהפלטפורמות האלה."
  }
  return null
}

// Generic/reserved path segments per platform. If the first path segment is
// one of these, the URL is a feature page (e.g. instagram.com/explore), not
// a profile. Lowercased; matched case-insensitively.
const RESERVED_PATHS: Record<CreatorPlatform, ReadonlySet<string>> = {
  instagram: new Set([
    "explore", "reels", "stories", "direct", "accounts", "p", "tv",
    "login", "signup", "about", "developer", "legal", "help", "press",
    "api", "web", "ads",
  ]),
  tiktok: new Set([
    "foryou", "following", "explore", "live", "video", "tag", "music",
    "discover", "trending", "login", "signup", "about", "legal",
  ]),
  youtube: new Set([
    "feed", "watch", "playlist", "results", "trending", "shorts",
    "gaming", "music", "news", "premium", "tv", "about", "static",
    "account", "redirect", "embed",
  ]),
  linkedin: new Set([
    "feed", "jobs", "messaging", "notifications", "mynetwork",
    "learning", "help", "legal", "about", "company",
  ]),
  other: new Set(),
}

// Handle patterns per platform. Captures a username-like segment but
// rejects bare paths that don't match.
const HANDLE_PATTERN = /^[\w.-]{2,}$/

// Turn a raw user input (profile URL or @handle) into { url, handle, platform }.
// Accepts: https://instagram.com/foo, instagram.com/foo, @foo, foo, youtube.com/@bar, etc.
// Returns null for clearly empty input or anything that isn't a recognizable
// profile (e.g. instagram.com root, tiktok.com/explore). Never throws.
export function parseCreatorInput(raw: string): ParsedCreator | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Bare handle (with or without @, no domain)
  if (!/[./]/.test(trimmed) || /^@/.test(trimmed)) {
    const handle = trimmed.replace(/^@/, "")
    if (!handle || !HANDLE_PATTERN.test(handle)) return null
    return { url: `https://instagram.com/${handle}`, handle, platform: "instagram" }
  }

  // Strip protocol for regex matching; keep original as url
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const lower = url.toLowerCase()

  let platform: CreatorPlatform = "other"
  if (lower.includes("instagram.com")) platform = "instagram"
  else if (lower.includes("youtube.com") || lower.includes("youtu.be")) platform = "youtube"
  else if (lower.includes("tiktok.com")) platform = "tiktok"
  else if (lower.includes("linkedin.com")) platform = "linkedin"

  // Pull path segments from a real URL parse — more reliable than regex
  // for "is there actually a path or is this the root?".
  let segments: string[] = []
  try {
    const u = new URL(url)
    segments = u.pathname.split("/").filter(Boolean)
  } catch {
    return null
  }

  // No path → root domain (e.g. https://instagram.com). Not a profile.
  if (segments.length === 0) return null

  // Resolve the handle segment per platform.
  let handle = ""
  if (platform === "instagram") {
    handle = segments[0].replace(/^@/, "")
  } else if (platform === "tiktok") {
    // tiktok.com/@username — the @ is required for profiles, anything
    // else is a feature page.
    if (segments[0].startsWith("@")) {
      handle = segments[0].slice(1)
    } else {
      return null
    }
  } else if (platform === "youtube") {
    // youtube.com/@channel, /c/name, /user/name, /channel/UCxxx — anything
    // else (watch, feed, results, embed…) is content/feature, not a creator.
    const first = segments[0]
    if (first.startsWith("@")) {
      handle = first.slice(1)
    } else if (
      (first === "c" || first === "user" || first === "channel") &&
      segments[1]
    ) {
      handle = segments[1]
    } else {
      return null
    }
  } else if (platform === "linkedin") {
    // linkedin.com/in/username or /company/name
    if ((segments[0] === "in" || segments[0] === "company") && segments[1]) {
      handle = segments[1]
    } else {
      return null
    }
  } else {
    // Unknown platform — let validateCreatorInput reject it later via
    // isKnownCreatorPlatform, but fill a placeholder handle so the parser
    // doesn't crash callers expecting non-null.
    handle = segments[segments.length - 1] || ""
  }

  if (!handle) return null

  // Reject reserved/generic paths (e.g. instagram.com/explore).
  if (RESERVED_PATHS[platform].has(handle.toLowerCase())) return null

  // Final sanity check: handle must look like a username.
  if (!HANDLE_PATTERN.test(handle)) return null

  return { url, handle, platform }
}
