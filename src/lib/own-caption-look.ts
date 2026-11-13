import type { SupabaseClient } from "@supabase/supabase-js"
import { cleanCaptionStyle, type CaptionStyle } from "@/lib/own-media"

/**
 * The caption look she saved for HER media with "זכור לעתיד" (Hani,
 * 2026-11-13: Nataliya had no save button after editing her own media). It
 * sits over the default look (lib/caption-look) on every format. Stored next
 * to her visual preferences (lib/style-memory), a file per user.
 */
const BUCKET = "user-media"
const path = (userId: string) => `${userId}/own-caption-look.json`

/** What a "זכור לעתיד" press carries for her own media's caption. */
export const OWN_CAPTION_OFFER = "OWN_CAPTION:"

/** The button's payload for this look; null when there's nothing lasting in it. */
export function ownCaptionOffer(style: CaptionStyle | undefined): string | undefined {
  const s = lasting(style)
  return s ? `${OWN_CAPTION_OFFER}${JSON.stringify(s)}` : undefined
}

export function parseOwnCaptionOffer(offer: string): CaptionStyle | null {
  if (!offer.startsWith(OWN_CAPTION_OFFER)) return null
  try {
    return lasting(cleanCaptionStyle(JSON.parse(offer.slice(OWN_CAPTION_OFFER.length)))) ?? null
  } catch {
    return null
  }
}

/** Colours, box and size hold for every piece; a nudge (offsetY) belongs to this one. */
function lasting(style: CaptionStyle | undefined): CaptionStyle | undefined {
  if (!style) return undefined
  const { pill, text, scale, perLine } = style
  const out: CaptionStyle = {
    ...(pill ? { pill } : {}),
    ...(text ? { text } : {}),
    ...(typeof scale === "number" ? { scale } : {}),
    ...(typeof perLine === "boolean" ? { perLine } : {}),
  }
  return Object.keys(out).length ? out : undefined
}

export async function loadOwnCaptionLook(supabase: SupabaseClient, userId: string): Promise<CaptionStyle | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path(userId))
  if (error || !data) return null
  try {
    return lasting(cleanCaptionStyle(JSON.parse(await data.text()))) ?? null
  } catch {
    return null
  }
}

export async function saveOwnCaptionLook(supabase: SupabaseClient, userId: string, style: CaptionStyle): Promise<void> {
  const body = JSON.stringify(style)
  const { error } = await supabase.storage.from(BUCKET).upload(path(userId), body, { contentType: "application/json", upsert: true })
  if (!error) return
  // No UPDATE policy on the bucket → replace by delete + insert (as style-memory does).
  await supabase.storage.from(BUCKET).remove([path(userId)])
  const retry = await supabase.storage.from(BUCKET).upload(path(userId), body, { contentType: "application/json" })
  if (retry.error) throw new Error(retry.error.message)
}
