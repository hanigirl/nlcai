"use client"

import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"

/**
 * One carousel VIDEO slide from her clip (Hani, 2026-11-06), through
 * api/carousel/video-slide: a Drive link, or a file from her computer (put in
 * storage first — a video is too big to send through the route's body).
 * `caption.design` = her instruction: the slide gets the own-video animated
 * caption; without it the clip goes in as it is (padded to 4:5).
 */
export type VideoSlideResult = { ok: true; url: string; seconds: number } | { ok: false; message: string }

export async function makeCarouselVideoSlide(opts: {
  postId: string
  drive?: string
  file?: File
  caption?: { design?: string; slideIndex: number }
}): Promise<VideoSlideResult> {
  try {
    let url: string | undefined
    if (opts.file) {
      const supabase = createClient()
      const {
        data: { user },
      } = await getCurrentUser(supabase)
      if (!user) return { ok: false, message: "לא מזוהה משתמש. רעננו ונסו שוב." }
      const ext = (opts.file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4"
      const path = `${user.id}/video/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from("user-media")
        .upload(path, opts.file, { contentType: opts.file.type || "video/mp4" })
      if (error) return { ok: false, message: `העלאת הסרטון נכשלה: ${error.message}` }
      url = supabase.storage.from("user-media").getPublicUrl(path).data.publicUrl
    }
    const res = await fetch("/api/carousel/video-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: opts.postId, drive: opts.drive, url, caption: opts.caption }),
    })
    const data = (await res.json().catch(() => ({}))) as { url?: string; seconds?: number; message?: string }
    if (!res.ok || !data.url) return { ok: false, message: data.message || "לא הצלחתי להכין את שקופית הווידאו. נסו שוב." }
    return { ok: true, url: data.url, seconds: data.seconds ?? 0 }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "לא הצלחתי להכין את שקופית הווידאו." }
  }
}
