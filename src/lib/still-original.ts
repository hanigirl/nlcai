"use client"

import type { CaptionRecord } from "@/lib/own-media"

/**
 * The caption record of a still we captioned (lib/caption-record), read in
 * the browser — the sidecar `<render>.json` sits beside the render in the
 * public user-media bucket. Gives the card and the panel the picture as she
 * brought it after a reload, instead of the one localStorage happened to
 * remember (image post fixed path, Hani 2026-11-09).
 *
 * `null` = not one of our captioned renders, or no record for it.
 */

const RECORD_ABLE = /\/storage\/v1\/object\/public\/user-media\/[^?#]*\/captioned-[^/?#]+\.png/i
const cache = new Map<string, Promise<CaptionRecord | null>>()

/** Is this a render the caption route made (it carries our caption)? */
export function isCaptionedRender(url: string | null | undefined): boolean {
  return !!url && RECORD_ABLE.test(url)
}

export function stillCaptionRecord(url: string | null | undefined): Promise<CaptionRecord | null> {
  if (!url || !isCaptionedRender(url)) return Promise.resolve(null)
  const clean = url.split(/[?#]/)[0]
  const hit = cache.get(clean)
  if (hit) return hit
  const p = fetch(`${clean}.json`, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null
      const rec = (await res.json()) as CaptionRecord
      return rec?.v === 1 && typeof rec.sourceUrl === "string" ? rec : null
    })
    .catch(() => null)
  cache.set(clean, p)
  // A miss can be a record still being written: don't hold on to it.
  void p.then((r) => {
    if (!r) cache.delete(clean)
  })
  return p
}

/** The picture to draw the caption over: the render's original, or the picture itself when it's bare. */
export async function stillOriginalOf(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  if (!isCaptionedRender(url)) return url
  return (await stillCaptionRecord(url))?.sourceUrl ?? null
}
