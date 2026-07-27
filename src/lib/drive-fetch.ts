/**
 * Server-side Google Drive download helpers.
 *
 * Split out of `/api/media/from-drive` so three callers can share the
 * interstitial-clearing logic:
 *   - `/api/media/from-drive`      — downloads + stores (images, carousel)
 *   - `/api/media/drive-info`      — resolves kind/size WITHOUT downloading
 *   - `/api/story/generate-video-media` — streams the source at render time
 *
 * SERVER ONLY. Drive does not send CORS headers on these endpoints, so
 * none of this works from the browser — that is precisely why the preview
 * path uses Drive's own <iframe> player instead (see `drive-media.ts`).
 */

import { driveDownloadUrl } from "@/lib/drive-media"

export type DriveFailure =
  | "invalid_drive_link"
  | "drive_not_public"
  | "drive_timeout"

/**
 * How long we'll wait for Drive to send RESPONSE HEADERS. This is not a
 * download budget — fetch resolves as soon as headers land, so a 2GB file
 * clears this in the same time as a 2MB one. Drive normally answers in
 * well under a second.
 *
 * Deliberately kept UNDER the serverless function limit: if the platform
 * kills the function first, the client gets an HTML 504 it can't parse and
 * the user sees a generic network error. Failing here instead means we
 * return real JSON (`drive_timeout`) and the UI can say something useful.
 */
const DRIVE_HEADER_TIMEOUT_MS = 12_000

/**
 * Fetch a public Drive file, transparently clearing the "can't scan for
 * viruses" interstitial that Drive shows for larger files (it returns an
 * HTML form whose hidden inputs we resubmit).
 *
 * Throws a TimeoutError (from AbortSignal.timeout) if Drive doesn't answer
 * within DRIVE_HEADER_TIMEOUT_MS — callers map that to `drive_timeout`.
 */
export async function fetchDriveFile(id: string): Promise<Response> {
  const first = await fetch(driveDownloadUrl(id), {
    signal: AbortSignal.timeout(DRIVE_HEADER_TIMEOUT_MS),
  })
  const ct = first.headers.get("content-type") || ""
  if (!ct.includes("text/html")) return first

  // Interstitial page — rebuild the query from its hidden form fields.
  const html = await first.text()
  const params = new URLSearchParams()
  const inputRe =
    /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = inputRe.exec(html)) !== null) {
    params.set(match[1], match[2])
  }
  if (!params.has("id")) params.set("id", id)
  if (!params.has("export")) params.set("export", "download")
  if (!params.has("confirm")) params.set("confirm", "t")
  return fetch(
    `https://drive.usercontent.google.com/download?${params.toString()}`,
    { signal: AbortSignal.timeout(DRIVE_HEADER_TIMEOUT_MS) },
  )
}

export interface DriveProbe {
  contentType: string
  kind: "image" | "video"
  /** From the content-length header. Drive omits it often enough that
   *  callers must treat null as "unknown", never as "empty". */
  sizeBytes: number | null
}

/**
 * Resolve what sits behind a Drive link WITHOUT downloading it.
 *
 * We still issue a GET (Drive's download endpoint ignores HEAD), but we
 * read the headers and then cancel the body stream — so a 2GB video costs
 * us a few KB and a round trip instead of a full transfer. This is what
 * makes "paste a link" instant and size-unlimited.
 *
 * Returns a `DriveFailure` string when the link isn't usable, so callers
 * can map it to the same user-facing errors the download path uses.
 */
export async function probeDriveFile(
  id: string,
): Promise<DriveProbe | DriveFailure> {
  let res: Response
  try {
    res = await fetchDriveFile(id)
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException. Anything
    // else here is a network fault reaching Drive — both are "we couldn't
    // get an answer", and both must surface rather than hang.
    console.error("[drive-fetch][probe]", err)
    return "drive_timeout"
  }
  const contentType = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()

  // Still HTML → not publicly downloadable (restricted, or a folder).
  if (!res.ok || contentType.includes("text/html")) {
    // Release the connection; we're not reading this body.
    await res.body?.cancel().catch(() => {})
    return "drive_not_public"
  }

  await res.body?.cancel().catch(() => {})

  const lenHeader = res.headers.get("content-length")
  const sizeBytes = lenHeader ? Number(lenHeader) : null

  return {
    contentType,
    kind: contentType.startsWith("image/") ? "image" : "video",
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
  }
}
