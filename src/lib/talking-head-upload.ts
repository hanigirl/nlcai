"use client"

import { getCurrentUser } from "@/lib/supabase/current-user"

/**
 * Her talking-head video from her computer (own media text, gated — Hani
 * 2026-11-09): stored in user-media like every other upload, then saved as the
 * post's video (core-posts PATCH videoUrl). Used by the media panel's
 * "מהמחשב" and by the AI chat when she attaches a clip there. A Drive link
 * needs none of this — the link itself is the media.
 */

const BUCKET = "user-media"
/** The storage bucket's per-file cap; bigger clips go through Drive (no cap). */
export const MAX_TH_UPLOAD_MB = 50

export class ThUploadError extends Error {}

export async function uploadTalkingHeadFile(file: File, onProgress?: (pct: number) => void): Promise<string> {
  if (!file.type.startsWith("video/")) throw new ThUploadError("זה לא קובץ וידאו. בחרו סרטון.")
  const mb = file.size / 1024 / 1024
  if (mb > MAX_TH_UPLOAD_MB) {
    throw new ThUploadError(`הסרטון גדול מדי (${mb.toFixed(0)}MB, עד ${MAX_TH_UPLOAD_MB}MB מהמחשב). העלו אותו מגוגל דרייב — שם אין הגבלת גודל.`)
  }
  const { createClient } = await import("@/lib/supabase/client")
  const supabase = createClient()
  const {
    data: { user },
  } = await getCurrentUser(supabase)
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!user || !session) throw new ThUploadError("לא מזוהה משתמש. רעננו ונסו שוב.")
  const ext = file.name.split(".").pop()?.toLowerCase() || "mp4"
  const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "mp4"
  const storagePath = `${user.id}/video/${crypto.randomUUID()}.${safeExt}`
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`
  // XHR, not supabase-js: progress events for a big clip.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`)
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ThUploadError("העלאת הסרטון נכשלה. נסו שוב, או העלו אותו מגוגל דרייב."))
    xhr.onerror = () => reject(new ThUploadError("שגיאת רשת בהעלאת הסרטון. נסו שוב."))
    xhr.send(file)
  })
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
}

/** Saved as the post's talking-head video before anything works on it. */
export async function saveTalkingHeadVideo(postId: string, url: string): Promise<boolean> {
  const res = await fetch(`/api/core-posts/${postId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl: url }),
  }).catch(() => null)
  return !!res?.ok
}
