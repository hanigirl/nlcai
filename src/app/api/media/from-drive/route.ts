import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { extractDriveFileId } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"

// Downloads a file from a public Google Drive share link and stores it in
// Supabase Storage.
//
// SCOPE NOTE (2026-07-27): this is no longer the path a Drive VIDEO takes.
// Videos are stored as the share link itself and previewed through Drive's
// embedded player — see `lib/drive-media.ts` for why, and
// `/api/media/drive-info` for the paste-time probe that replaced this call.
// What still comes through here:
//   - Drive IMAGES (small, and downstream needs same-origin bytes)
//   - the carousel slide import (`store: false`, base64 pass-through)
// The 50MB cap below therefore only ever applies to those, which is the
// whole point: it stopped being a ceiling on the user's video length.

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

    const fileId = extractDriveFileId(url)
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
