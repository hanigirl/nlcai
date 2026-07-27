/**
 * Google Drive media helpers — shared by client and server.
 *
 * Why this exists (2026-07-27, per Hani):
 *   Originally, pasting a Drive link DOWNLOADED the whole file onto our
 *   Supabase bucket, right there on paste. That capped media at 50MB and
 *   made every paste wait for a full upload — for a need that only arises
 *   when the user actually renders something (burning a caption into a
 *   story video).
 *
 *   The model now is LINK-FIRST for video: the Drive share link itself is
 *   stored as the format's media asset, previewed through Drive's own
 *   embedded player (no bytes cross our servers, no size cap), and the
 *   real file is pulled only at render time — see `resolveVideoSource` in
 *   the story burn route.
 *
 * IMPORTANT invariant: a Drive URL stored in `media_assets.url` is always
 * a VIDEO. Drive IMAGES still take the old download-and-store path
 * (`/api/media/from-drive`), because everything downstream of an image —
 * canvas frame capture, AI compositing, the image_post download button —
 * needs same-origin bytes, and images are small enough that the copy is
 * cheap. That invariant is what lets `isVideoUrl` below treat "is a Drive
 * link" as "is a video" without consulting the database.
 */

/** Drive / Docs share-link shapes we accept. */
const DRIVE_HOST_RE = /drive\.google\.com|docs\.google\.com/i

const FILE_ID_PATTERNS = [
  /\/file\/d\/([a-zA-Z0-9_-]+)/, // /file/d/<id>/view
  /[?&]id=([a-zA-Z0-9_-]+)/, // ?id=<id> / open?id=<id>
  /\/d\/([a-zA-Z0-9_-]+)/, // /d/<id>
]

/** True for any Google Drive / Docs link, complete or not. */
export function isDriveUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return DRIVE_HOST_RE.test(url)
}

/** Pull the Drive file id out of the common share-link shapes. */
export function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url) return null
  for (const re of FILE_ID_PATTERNS) {
    const m = url.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

/**
 * True once the field holds a Drive link we can actually act on — host
 * matches AND a file id is extractable. The debounced auto-handlers key
 * off this so they don't fire on every keystroke of a half-pasted URL.
 */
export function isCompleteDriveUrl(url: string | null | undefined): boolean {
  return isDriveUrl(url) && extractDriveFileId(url) !== null
}

/**
 * Drive's own embedded player. Works for a file of ANY size and never
 * touches our servers — this is what replaced the download-on-paste.
 * Requires the file to be shared as "anyone with the link", which the
 * Drive flow already asked of the user.
 */
export function driveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`
}

/**
 * A static poster frame for a Drive file. Used where an <iframe> is the
 * wrong element (reel-cover generation, small thumbnails) — Drive renders
 * this server-side, so it works for videos too.
 */
export function driveThumbnailUrl(fileId: string, width = 1000): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`
}

/** The direct-download endpoint. Server-side use only — Drive does not
 *  serve this with CORS headers, so it cannot back a <video> or <img>. */
export function driveDownloadUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
}

/**
 * Whether a stored media URL should render as a video.
 *
 * Two cases:
 *   - Supabase storage URLs keep the original extension, so the regex is
 *     reliable for uploaded files.
 *   - Drive links carry no extension — but per the invariant documented
 *     at the top of this file, a Drive URL in `media_assets` is always a
 *     video, so the host check is enough.
 */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (isDriveUrl(url)) return true
  return /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url)
}
