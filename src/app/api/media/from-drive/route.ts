import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Downloads a file from a public Google Drive share link and stores it in
// Supabase Storage — the talking_head panel uses this instead of a local
// upload, so a Drive video lands as a persistent URL exactly like an
// avatar-generated video.

const MAX_BYTES = 50 * 1024 * 1024 // match the user-media bucket cap (50MB)

const EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

/** Pull the Drive file id out of the common share-link shapes. */
function extractFileId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/, // /file/d/<id>/view
    /[?&]id=([a-zA-Z0-9_-]+)/, // ?id=<id> / open?id=<id>
    /\/d\/([a-zA-Z0-9_-]+)/, // /d/<id>
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

/**
 * Fetch a public Drive file, transparently clearing the "can't scan for
 * viruses" interstitial that Drive shows for larger files (it returns an
 * HTML form whose hidden inputs we resubmit).
 */
async function fetchDriveFile(id: string): Promise<Response> {
  const base = "https://drive.usercontent.google.com/download"
  const first = await fetch(`${base}?id=${id}&export=download&confirm=t`)
  const ct = first.headers.get("content-type") || ""
  if (!ct.includes("text/html")) return first

  // Interstitial page — rebuild the query from its hidden form fields.
  const html = await first.text()
  const params = new URLSearchParams()
  const inputRe = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = inputRe.exec(html)) !== null) {
    params.set(match[1], match[2])
  }
  if (!params.has("id")) params.set("id", id)
  if (!params.has("export")) params.set("export", "download")
  if (!params.has("confirm")) params.set("confirm", "t")
  return fetch(`${base}?${params.toString()}`)
}

export async function POST(req: NextRequest) {
  try {
    const { url, store } = (await req.json()) as {
      url?: string
      // When `false`, return the downloaded bytes as base64 instead of
      // uploading to Storage. The carousel import needs base64 (its whole
      // pipeline is base64 in-memory and re-stores on save) — storing here
      // too would leave an orphan file per slide. Defaults to storing, so
      // talking_head / story / image_post are unaffected.
      store?: boolean
    }
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 })
    }

    const fileId = extractFileId(url)
    if (!fileId) {
      return NextResponse.json({ error: "invalid_drive_link" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const res = await fetchDriveFile(fileId)
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim()
    if (!res.ok || contentType.includes("text/html")) {
      // Still HTML → the file isn't publicly downloadable (or the link is a
      // folder / restricted). Surface a clear, actionable error.
      return NextResponse.json({ error: "drive_not_public" }, { status: 400 })
    }

    const lenHeader = res.headers.get("content-length")
    if (lenHeader && Number(lenHeader) > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 })
    }

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 })
    }

    const isImage = contentType.startsWith("image/")
    const kind = isImage ? "image" : "video"

    // Base64 pass-through (carousel import) — no Storage write. Images only:
    // a carousel slide is always an image, and base64-ing a 50MB video would
    // be pointless payload.
    if (store === false) {
      if (!isImage) {
        return NextResponse.json({ error: "not_an_image" }, { status: 400 })
      }
      return NextResponse.json({
        base64: Buffer.from(buffer).toString("base64"),
        contentType,
        kind,
      })
    }

    const ext = EXT_BY_TYPE[contentType] || (isImage ? "jpg" : "mp4")
    const storagePath = `${user.id}/${kind}/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("user-media")
      .upload(storagePath, buffer, {
        contentType: contentType || (isImage ? "image/jpeg" : "video/mp4"),
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const publicUrl = supabase.storage
      .from("user-media")
      .getPublicUrl(storagePath).data.publicUrl

    return NextResponse.json({ url: publicUrl, contentType, kind })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[media/from-drive]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
