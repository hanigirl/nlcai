import type { SupabaseClient } from "@supabase/supabase-js"
import type { CaptionRecord, CaptionSpec } from "@/lib/own-media"

/**
 * The sidecar beside a captioned render — `<render path>.json` in user-media,
 * the same no-schema-change move the b-roll composition makes
 * (lib/broll-animation/store). Written by the two caption routes every time
 * they draw words over her file, read by "עריכת מדיה עם AI" so a caption can
 * be rewritten, moved or taken off from the ORIGINAL rather than stacked.
 *
 * Best effort on both sides: a render without a record still works as it
 * always did, it just can't be un-captioned later.
 */

const BUCKET = "user-media"

function storagePathOf(url: string): string | null {
  const m = /\/storage\/v1\/object\/public\/user-media\/([^?#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

export async function writeCaptionRecord(
  supabase: SupabaseClient,
  renderUrl: string,
  sourceUrl: string,
  caption: CaptionSpec,
): Promise<void> {
  const path = storagePathOf(renderUrl)
  if (!path || !sourceUrl) return
  const record: CaptionRecord = { v: 1, sourceUrl, caption }
  try {
    await supabase.storage.from(BUCKET).upload(`${path}.json`, JSON.stringify(record), {
      contentType: "application/json",
      upsert: true,
    })
  } catch (err) {
    console.error("[caption-record][write]", err instanceof Error ? err.message : err)
  }
}

export async function readCaptionRecord(
  supabase: SupabaseClient,
  renderUrl: string,
): Promise<CaptionRecord | null> {
  const path = storagePathOf(renderUrl)
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(`${path}.json`)
  if (error || !data) return null
  try {
    const rec = JSON.parse(await data.text()) as CaptionRecord
    return rec?.v === 1 && typeof rec.sourceUrl === "string" ? rec : null
  } catch {
    return null
  }
}
