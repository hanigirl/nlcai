import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Her talking-head video as she brought it (Hani, 2026-11-07): every AI edit
 * renders from the ORIGINAL — never on top of an earlier edit — and "חזרה
 * לסרטון המקורי" brings it back. Kept per post next to her media:
 *   user-media/<uid>/talking-head/<postId>.json → { originalUrl }
 * A video that isn't one of our renders IS her original (a new upload
 * replaces the record).
 */
const BUCKET = "user-media"
const file = (userId: string, postId: string) => `${userId}/talking-head/${postId}.json`

/** One of our edits of her video (captions / elements). */
export function isTalkingHeadRender(url: string | null | undefined): boolean {
  return !!url && /\/video\/(captioned|edited)-th-[^/]+\.mp4/.test(url)
}

async function readRecord(supabase: SupabaseClient, userId: string, postId: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(file(userId, postId))
  if (error || !data) return null
  try {
    const parsed = JSON.parse(await data.text()) as { originalUrl?: unknown }
    return typeof parsed.originalUrl === "string" ? parsed.originalUrl : null
  } catch {
    return null
  }
}

async function writeRecord(supabase: SupabaseClient, userId: string, postId: string, originalUrl: string) {
  const body = JSON.stringify({ originalUrl, at: new Date().toISOString() })
  const { error } = await supabase.storage.from(BUCKET).upload(file(userId, postId), body, { upsert: true, contentType: "application/json" })
  if (error) {
    await supabase.storage.from(BUCKET).remove([file(userId, postId)])
    await supabase.storage.from(BUCKET).upload(file(userId, postId), body, { contentType: "application/json" })
  }
}

/** The video an edit starts from: her original, recorded the first time. */
export async function originalFor(supabase: SupabaseClient, userId: string, postId: string, current: string): Promise<string> {
  if (!isTalkingHeadRender(current)) {
    if ((await readRecord(supabase, userId, postId)) !== current) await writeRecord(supabase, userId, postId, current)
    return current
  }
  return (await readRecord(supabase, userId, postId)) ?? current
}

export async function recordedOriginal(supabase: SupabaseClient, userId: string, postId: string): Promise<string | null> {
  return readRecord(supabase, userId, postId)
}
