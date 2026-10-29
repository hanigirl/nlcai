/**
 * Read a public Google Drive FOLDER — the media library she points each
 * format at in Settings → מדיה → "מדיה מ-Google Drive" (Hani, 2026-10-22).
 *
 * SERVER ONLY. No API key and no OAuth: a folder shared as "anyone with the
 * link · viewer" renders Drive's embedded folder view, and that page lists
 * every file (id + name). The picker shows Drive's own thumbnails and hands
 * the chosen files to the per-file import that already exists, as
 * `https://drive.google.com/file/d/<id>/view` links — the same links she
 * used to paste one by one.
 */

export type DriveFolderError = "not_drive" | "file_not_folder" | "not_public"

export type DriveFolderItem = {
  id: string
  name: string
  kind: "image" | "video"
  /** Drive's thumbnail for it, from the folder view (videos included). */
  thumb?: string
}

export type DriveFolderListing = { name: string; items: DriveFolderItem[] }

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?|avif)$/i

/** The folder id from a share link, or why there isn't one. */
export function parseFolderLink(raw: string): { id: string } | { error: DriveFolderError } {
  const url = raw.trim()
  if (!/drive\.google\.com|docs\.google\.com/i.test(url)) return { error: "not_drive" }
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/)
  if (m) return { id: m[1] }
  return { error: "file_not_folder" }
}

export function driveFileLink(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/**
 * List the folder's images and videos, in Drive's order. A folder that isn't
 * shared publicly (or doesn't exist) answers 404 — both read as "not open for
 * viewing", which is the fix she can actually make.
 */
export async function listPublicFolder(
  folderId: string,
): Promise<DriveFolderListing | { error: DriveFolderError }> {
  const res = await fetch(
    `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`,
    { signal: AbortSignal.timeout(12_000), cache: "no-store" },
  )
  if (!res.ok) return { error: "not_public" }
  const html = await res.text()
  // A private folder can also answer 200 with a sign-in page.
  if (!/flip-entry|folder-view|flip-view/i.test(html) && /accounts\.google\.com/i.test(html)) {
    return { error: "not_public" }
  }

  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]
  const name = decodeEntities((title ?? "").trim())

  const items: DriveFolderItem[] = []
  const seen = new Set<string>()
  // Each file: <div class="flip-entry" id="entry-<id>" …> … <div class="flip-entry-title">name</div>
  const entryRe = /id="entry-([a-zA-Z0-9_-]+)"([\s\S]*?)flip-entry-title">([^<]*)</g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(html)) !== null) {
    const [, id, body, rawName] = m
    if (seen.has(id)) continue
    // Sub-folders link to /drive/folders/ — not media.
    if (/\/folders\//.test(body)) continue
    const fileName = decodeEntities(rawName.trim())
    // By extension first; a file named without one (a phone export, a
    // renamed upload) falls back to the type icon Drive draws for it
    // (…/type/image/jpeg, …/type/video/mp4). Before, those were dropped and an
    // images folder could read as empty.
    const mime = body.match(/\/type\/(image|video)\//)?.[1] as "image" | "video" | undefined
    const kind = VIDEO_EXT.test(fileName) ? "video" : IMAGE_EXT.test(fileName) ? "image" : (mime ?? null)
    if (!kind) continue
    seen.add(id)
    // The entry's own preview image; its size suffix (=s190) is asked bigger.
    const img = body.match(/<img src="(https:\/\/lh3\.googleusercontent\.com\/[^"]+)"/)?.[1]
    const thumb = img ? decodeEntities(img).replace(/=s\d+$/, "=s400") : undefined
    items.push({ id, name: fileName, kind, ...(thumb ? { thumb } : {}) })
  }
  return { name, items }
}
