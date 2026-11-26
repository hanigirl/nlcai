"use client"

import { driveThumbnailUrl, extractDriveFileId, isDriveUrl, playableVideoSrc } from "@/lib/drive-media"

/**
 * The picture behind a talking-head cover: one frame of her video, taken in
 * the browser.
 *
 * A Drive video used to send the cover route Drive's poster URL to fetch on
 * the server. From production that fetch never answered, and the route had
 * no time limit, so every cover on a Drive video hung for the full 5 minutes
 * and ended in a 504 (bug 2026-11-21: "לא הצלחתי ליצור קאבר הפעם" — every
 * cover request since 2026-11-16 timed out). The frame now comes through our
 * own same-origin video proxy (/api/media/drive-video — the one the player
 * already streams from), so the canvas isn't tainted and nothing waits on
 * Drive's poster. Drive's poster stays as the fallback only.
 *
 * The frame is scaled to the cover's size: a 4K frame as a data URL could
 * pass the 4.5MB request-body limit and fail the request before it starts.
 */

const COVER_W = 1080
const COVER_H = 1920

/** One frame of a video as a JPEG data URL, or null (no CORS, no load, timeout). */
export function videoFrameDataUrl(src: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      video.removeAttribute("src")
      video.load()
      resolve(v)
    }
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.muted = true
    video.preload = "auto"
    video.src = src
    video.onloadeddata = () => {
      // 1s in — past a black first frame; a clip shorter than that, its middle.
      video.currentTime = Number.isFinite(video.duration) && video.duration < 1 ? video.duration / 2 : 1
    }
    video.onseeked = () => {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return finish(null)
        const scale = Math.min(1, COVER_W / w, COVER_H / h)
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL("image/jpeg", 0.85))
      } catch (err) {
        // A tainted canvas (no CORS on the source) throws here.
        console.error("[cover-frame][capture]", err)
        finish(null)
      }
    }
    video.onerror = () => finish(null)
    setTimeout(() => finish(null), timeoutMs)
  })
}

/**
 * What to send the cover route as `thumbnail_url` for a Drive video: a frame
 * through our proxy, else Drive's poster URL (the route fetches it with a
 * time limit and makes the cover without a picture if it doesn't come).
 */
export async function driveCoverThumbnail(link: string): Promise<string | undefined> {
  if (!isDriveUrl(link)) return undefined
  const fileId = extractDriveFileId(link)
  if (!fileId) return undefined
  // The proxy fetches from Drive on the server before the first byte, so
  // give it longer than a direct file.
  const frame = await videoFrameDataUrl(playableVideoSrc(link), 15000)
  return frame ?? driveThumbnailUrl(fileId)
}

/**
 * Turn the cover route's answer into what to show her when there is no
 * cover. The route answers JSON with a Hebrew `message`; a platform timeout
 * answers HTML, so the status decides there.
 */
export async function coverFailureMessage(res: Response | null): Promise<string> {
  if (res) {
    const d = (await res.clone().json().catch(() => null)) as { message?: unknown } | null
    if (d && typeof d.message === "string" && d.message) return d.message
    if (res.status === 504 || res.status === 408) return "יצירת הקאבר לקחה יותר מדי זמן. נסו שוב בעוד רגע."
    if (res.status === 413) return "התמונה מהסרטון גדולה מדי לקאבר. נסו שוב."
    if (res.status === 401) return "נראה שהחיבור לחשבון פג. רעננו את העמוד ונסו שוב."
  }
  return "לא הצלחתי ליצור קאבר הפעם. נסו שוב."
}
