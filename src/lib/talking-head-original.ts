import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Her talking-head video as she brought it (Hani, 2026-11-07): every AI edit
 * renders from the ORIGINAL — never on top of an earlier edit — and "חזרה
 * לסרטון המקורי" brings it back. Kept per post next to her media, with what
 * the edits so far added (so the next request continues from there —
 * "אמשיך מאיפה שזה נפסק", 2026-11-08):
 *   user-media/<uid>/talking-head/<postId>.json → { originalUrl, applied }
 * A video that isn't one of our renders IS her original (a new upload
 * replaces the record and starts clean).
 */
const BUCKET = "user-media"
const file = (userId: string, postId: string) => `${userId}/talking-head/${postId}.json`

export type AppliedMoment = { at: string; quote: string; element: "card" | "highlight" | "animation" }
/** What the edits so far put on her original. */
export type Applied = {
  captions: boolean
  moments: AppliedMoment[]
  /** Fillers and dead air cut (lib/talking-head-cuts) — kept on the next request. */
  cuts?: boolean
}
type Record_ = { originalUrl: string; applied?: Applied }

/** One of our edits of her video (captions / elements). */
export function isTalkingHeadRender(url: string | null | undefined): boolean {
  return !!url && /\/video\/(captioned|edited)-th-[^/]+\.mp4/.test(url)
}

async function readRecord(supabase: SupabaseClient, userId: string, postId: string): Promise<Record_ | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(file(userId, postId))
  if (error || !data) return null
  try {
    const parsed = JSON.parse(await data.text()) as { originalUrl?: unknown; applied?: Applied }
    if (typeof parsed.originalUrl !== "string") return null
    return { originalUrl: parsed.originalUrl, ...(parsed.applied ? { applied: parsed.applied } : {}) }
  } catch {
    return null
  }
}

async function writeRecord(supabase: SupabaseClient, userId: string, postId: string, rec: Record_) {
  const body = JSON.stringify({ ...rec, at: new Date().toISOString() })
  const { error } = await supabase.storage.from(BUCKET).upload(file(userId, postId), body, { upsert: true, contentType: "application/json" })
  if (error) {
    await supabase.storage.from(BUCKET).remove([file(userId, postId)])
    await supabase.storage.from(BUCKET).upload(file(userId, postId), body, { contentType: "application/json" })
  }
}

/**
 * The video an edit starts from — her original, recorded the first time —
 * and what the edits so far added (nothing when she's on her original).
 */
export async function editBase(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  current: string,
): Promise<{ source: string; applied: Applied }> {
  const none: Applied = { captions: false, moments: [] }
  const rec = await readRecord(supabase, userId, postId)
  if (!isTalkingHeadRender(current)) {
    if (rec?.originalUrl !== current || rec?.applied) await writeRecord(supabase, userId, postId, { originalUrl: current })
    return { source: current, applied: none }
  }
  return { source: rec?.originalUrl ?? current, applied: rec?.applied ?? none }
}

/** The video an edit starts from (kept for callers that only need the source). */
export async function originalFor(supabase: SupabaseClient, userId: string, postId: string, current: string): Promise<string> {
  return (await editBase(supabase, userId, postId, current)).source
}

/** After an edit landed: what's on her video now. */
export async function saveApplied(supabase: SupabaseClient, userId: string, postId: string, originalUrl: string, applied: Applied) {
  await writeRecord(supabase, userId, postId, { originalUrl, applied })
}

/** "חזרה לסרטון המקורי": her original, and nothing applied any more. */
export async function recordedOriginal(supabase: SupabaseClient, userId: string, postId: string): Promise<string | null> {
  const rec = await readRecord(supabase, userId, postId)
  if (!rec) return null
  await writeRecord(supabase, userId, postId, { originalUrl: rec.originalUrl })
  return rec.originalUrl
}

/** Her original, read only — nothing reset (for a cover made from the original). */
export async function peekOriginal(supabase: SupabaseClient, userId: string, postId: string): Promise<string | null> {
  return (await readRecord(supabase, userId, postId))?.originalUrl ?? null
}
