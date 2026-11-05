import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { fetchDriveFile } from "@/lib/drive-fetch"

/**
 * POST { id, kind } → { image: dataUrl, frame: boolean } | { error, message }
 *
 * "מגוגל דרייב" in the AI panel's add-image menu (Hani, 2026-11-06): a file
 * from the Drive folder linked to this format in Settings becomes an
 * attachment exactly like one from her computer — a picture, as a data URL
 * the panel shrinks and sends with her message.
 *
 *   - An image: the file itself (Drive download; HEIC and other formats the
 *     server can't read fall back to Drive's own full-size preview of it).
 *   - A video: the AI panel works with pictures, so what it gets is ONE frame —
 *     Drive's own preview frame of the clip — and `frame: true` says so. The
 *     clip itself is not sent; using a clip as the media stays with "מדיה
 *     משלכם מ Google Drive".
 *
 * No AI call, nothing stored.
 */

const MAX_BYTES = 25_000_000
const MAX_SIDE = 1600

/** Drive's public preview of a file (images and videos alike), by id. */
const previewUrl = (id: string) => `https://lh3.googleusercontent.com/d/${id}=w${MAX_SIDE}`

async function toDataUrl(input: Buffer): Promise<string> {
  const img = sharp(input).rotate()
  const meta = await img.metadata()
  const resized = img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
  if (meta.hasAlpha) return `data:image/png;base64,${(await resized.png().toBuffer()).toString("base64")}`
  return `data:image/jpeg;base64,${(await resized.jpeg({ quality: 88 }).toBuffer()).toString("base64")}`
}

async function readCapped(res: Response): Promise<Buffer | null> {
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length > MAX_BYTES ? null : buf
}

async function fromPreview(id: string): Promise<string | null> {
  const res = await fetch(previewUrl(id), { signal: AbortSignal.timeout(12_000) })
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null
  const buf = await readCapped(res)
  return buf ? toDataUrl(buf) : null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id, kind } = (await req.json().catch(() => ({}))) as { id?: unknown; kind?: unknown }
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    return NextResponse.json({ error: "bad_id", message: "הקובץ הזה לא נמצא בדרייב." }, { status: 400 })
  }

  try {
    if (kind === "video") {
      const image = await fromPreview(id)
      if (!image) throw new Error("no_frame")
      return NextResponse.json({ image, frame: true })
    }
    // The picture itself; Drive's preview when the server can't read it.
    try {
      const res = await fetchDriveFile(id)
      const type = res.headers.get("content-type") ?? ""
      if (res.ok && type.startsWith("image/")) {
        const buf = await readCapped(res)
        if (buf) return NextResponse.json({ image: await toDataUrl(buf), frame: false })
      }
    } catch {
      // Fall through to the preview.
    }
    const image = await fromPreview(id)
    if (!image) throw new Error("no_image")
    return NextResponse.json({ image, frame: false })
  } catch {
    return NextResponse.json(
      {
        error: "drive_unreadable",
        message: "לא הצלחתי להביא את הקובץ הזה מהדרייב. בדקו שהתיקייה משותפת לכל מי שיש לו את הקישור, או צרפו אותו מהמחשב.",
      },
      { status: 422 },
    )
  }
}
