import { extractFileContent, type FileContent } from "@/lib/extract-file-content"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"

/**
 * A knowledge-source LINK is a link to a text file, nothing else:
 *   - a Google Doc (read through its plain-text export), or
 *   - a file in Google Drive that is itself a supported text file
 *     (docx / pdf / txt / md / vtt / srt — the same list as an upload).
 *
 * Arbitrary web pages are out on purpose: a scraped page is navigation,
 * cookie banners and footers, and pretending otherwise promised more than
 * the feature delivers. Both paths need the file shared as "anyone with the
 * link".
 *
 * Unlike `scrape-url.ts` this never truncates — a transcript has to be read
 * to the end. The length cap lives in the processing step, where it is
 * reported to the user.
 */

export type LinkFailure = "link_not_supported" | "link_not_public" | "file_unreadable"

export type LinkResult =
  | { ok: true; content: Extract<FileContent, { kind: "text" | "pdf" }>; fileName?: string }
  | { ok: false; error: LinkFailure; message?: string }

const GOOGLE_DOC_RE = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/

/** `filename*=UTF-8''…` (RFC 5987) first, then plain `filename="…"`. */
function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""))
    } catch {
      // fall through to the plain form
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null
}

export async function readKnowledgeLink(url: string): Promise<LinkResult> {
  const doc = url.match(GOOGLE_DOC_RE)
  if (doc) {
    try {
      const res = await fetch(
        `https://docs.google.com/document/d/${doc[1]}/export?format=txt`,
        { signal: AbortSignal.timeout(20_000) },
      )
      const type = res.headers.get("content-type") || ""
      // A private doc answers with Google's sign-in page (HTML), not text.
      if (!res.ok || type.includes("text/html")) return { ok: false, error: "link_not_public" }
      const text = (await res.text()).trim()
      if (!text) return { ok: false, error: "file_unreadable", message: "המסמך ריק." }
      return { ok: true, content: { kind: "text", text } }
    } catch {
      return { ok: false, error: "link_not_public" }
    }
  }

  const fileId = isDriveUrl(url) ? extractDriveFileId(url) : null
  if (!fileId) return { ok: false, error: "link_not_supported" }

  try {
    const res = await fetchDriveFile(fileId)
    const type = res.headers.get("content-type") || ""
    if (!res.ok || type.includes("text/html")) return { ok: false, error: "link_not_public" }
    const fileName = fileNameFrom(res.headers.get("content-disposition")) ?? ""
    const buffer = Buffer.from(await res.arrayBuffer())
    const content = await extractFileContent(fileName, buffer)
    if (content.kind === "unsupported") {
      return { ok: false, error: "file_unreadable", message: content.message }
    }
    return { ok: true, content, fileName }
  } catch {
    return { ok: false, error: "link_not_public" }
  }
}
