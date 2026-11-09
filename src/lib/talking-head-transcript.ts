import type { SupabaseClient } from "@supabase/supabase-js"
import { transcribeVideo, type Transcript } from "@/lib/transcribe"
import { transcriptionContext } from "@/lib/talking-head-video"

/**
 * One transcript per original (Hani, 2026-11-09 — own media text, gated by
 * canOwnMediaText): the plan and the edit used to transcribe her video twice
 * (two Whisper bills, and timings that could differ between what she approved
 * and what was rendered). The plan's transcript is kept beside her original:
 *   user-media/<uid>/talking-head/<postId>.words.json → { sourceUrl, script, transcript }
 * and the edit reads it back when it is for the same original and the same
 * script. A new original or an edited script transcribes again.
 */
const BUCKET = "user-media"
const file = (userId: string, postId: string) => `${userId}/talking-head/${postId}.words.json`

type Cached = { sourceUrl: string; script: string; transcript: Transcript }

async function read(supabase: SupabaseClient, userId: string, postId: string): Promise<Cached | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(file(userId, postId))
  if (error || !data) return null
  try {
    const c = JSON.parse(await data.text()) as Cached
    return typeof c?.sourceUrl === "string" && Array.isArray(c.transcript?.words) ? c : null
  } catch {
    return null
  }
}

async function write(supabase: SupabaseClient, userId: string, postId: string, c: Cached) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(file(userId, postId), JSON.stringify(c), { upsert: true, contentType: "application/json" })
  if (error) console.error("[talking-head-transcript] save", error.message)
}

/**
 * Her words on `sourceUrl` (her original), spelling-only against the script:
 * the kept transcript when it matches, else a fresh one (then kept).
 */
export async function ownTranscript(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  openaiKey: string,
  sourceUrl: string,
): Promise<Transcript> {
  const ctx = await transcriptionContext(supabase, userId, postId)
  const kept = await read(supabase, userId, postId)
  if (kept && kept.sourceUrl === sourceUrl && kept.script === ctx.script) return kept.transcript
  const transcript = await transcribeVideo(openaiKey, sourceUrl, { ...ctx, strict: true })
  await write(supabase, userId, postId, { sourceUrl, script: ctx.script, transcript })
  return transcript
}
