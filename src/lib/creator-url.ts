import type { CreatorPlatform } from "@/lib/supabase/types"

export interface ParsedCreator {
  url: string
  handle: string
  platform: CreatorPlatform
}

// Turn a raw user input (profile URL or @handle) into { url, handle, platform }.
// Accepts: https://instagram.com/foo, instagram.com/foo, @foo, foo, youtube.com/@bar, etc.
// Returns null for clearly empty input. Never throws.
export function parseCreatorInput(raw: string): ParsedCreator | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Bare handle (with or without @, no domain)
  if (!/[./]/.test(trimmed) || /^@/.test(trimmed)) {
    const handle = trimmed.replace(/^@/, "")
    if (!handle) return null
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

  // Extract handle from URL path
  let handle = ""
  const m = url.match(/(?:instagram\.com|tiktok\.com|linkedin\.com\/(?:in|company))\/(@?[\w.-]+)/i)
  if (m) {
    handle = m[1].replace(/^@/, "")
  } else {
    const yt = url.match(/youtube\.com\/(?:@|c\/|channel\/|user\/)?([\w.-]+)/i)
    if (yt) handle = yt[1]
  }

  // Fallback: last non-empty path segment
  if (!handle) {
    try {
      const u = new URL(url)
      const parts = u.pathname.split("/").filter(Boolean)
      handle = parts[parts.length - 1] || u.hostname
    } catch {
      handle = trimmed
    }
  }

  return { url, handle, platform }
}
