"use client"

import type { MediaStyle } from "@/lib/visual-language/types"

/**
 * Which style made a post's AI media, so the panel knows when to ask for
 * niche-language feedback (only on images made in "שפת הנישה · כהה/בהיר").
 *
 * Keyed by post + format, and tied to the exact media it describes
 * (`mediaKey` — the saved URL, or the first frame/slide). If the post's media
 * is later replaced by an upload or an import, the key no longer matches and
 * the feedback strip simply doesn't show. Browser-local on purpose: it's a
 * UI hint, the feedback itself is stored server-side.
 */

export interface AiStyleRecord {
  style: MediaStyle
  mediaKey: string
  /** What she answered for this media, so the strip shows its result. */
  vote?: "like" | "dislike"
}

const PREFIX = "aiStyle_v1:"

function key(postId: string, format: string) {
  return `${PREFIX}${postId}:${format}`
}

export function rememberAiStyle(postId: string, format: string, style: MediaStyle, mediaKey: string) {
  try {
    localStorage.setItem(key(postId, format), JSON.stringify({ style, mediaKey } satisfies AiStyleRecord))
  } catch (err) {
    console.error("[ai-style-provenance][save]", err)
  }
}

export function getAiStyle(postId: string, format: string): AiStyleRecord | null {
  try {
    const raw = localStorage.getItem(key(postId, format))
    return raw ? (JSON.parse(raw) as AiStyleRecord) : null
  } catch {
    return null
  }
}

export function recordAiStyleVote(postId: string, format: string, vote: "like" | "dislike") {
  // Carousels have no record (their template is their provenance) — keep
  // just the vote for them.
  const rec = getAiStyle(postId, format) ?? { style: "brand", mediaKey: "" }
  try {
    localStorage.setItem(key(postId, format), JSON.stringify({ ...rec, vote }))
  } catch (err) {
    console.error("[ai-style-provenance][vote]", err)
  }
}

/** The post's media for this format was replaced by something not AI-made. */
export function forgetAiStyle(postId: string, format: string) {
  try {
    localStorage.removeItem(key(postId, format))
  } catch {
    // Storage blocked — nothing to forget.
  }
}
