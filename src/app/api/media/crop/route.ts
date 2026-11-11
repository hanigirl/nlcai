import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canOwnMediaText } from "@/lib/feature-access"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { guardedFetch } from "@/lib/server-fetch"
import { readCaptionRecord, writeCaptionRecord } from "@/lib/caption-record"
import { CANVAS_4_5, renderCaptionOverImagePng, renderCaptionOverlayPng } from "@/lib/caption-overlay"
import { isCaptionedRenderUrl } from "@/lib/own-media"
import { CENTRED, CROP_OUT, cleanCrop, cropRect, type CropRecord, type PictureCrop } from "@/lib/picture-crop"

/**
 * "חיתוך" on her own picture in an image post / carousel slide
 * (lib/picture-crop). Hani + Nataliya (canOwnMediaText).
 *
 *   GET  ?url=<the picture as shown>  → { original: data URL (preview size),
 *        width, height, crop } — the whole picture and where the frame is now.
 *   POST { url, crop }                 → { url } — the new 4:5 picture (with
 *        its caption redrawn when it had one). Nothing is saved to the post:
 *        the panel saves the set (media/own-edit "save").
 */

const BUCKET = "user-media"
const PREVIEW_MAX = 1600

const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

function storagePathOf(url: string): string | null {
  const m = /\/storage\/v1\/object\/public\/user-media\/([^?#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

/** Hers: a file in her own storage folder, or a Drive link. */
function isHers(url: string, userId: string): boolean {
  if (isDriveUrl(url)) return true
  const p = storagePathOf(url)
  return !!p && p.startsWith(`${userId}/`)
}

async function readCropRecord(supabase: Awaited<ReturnType<typeof createClient>>, url: string): Promise<CropRecord | null> {
  const p = storagePathOf(url)
  if (!p) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(`${p}.crop.json`)
  if (error || !data) return null
  try {
    const r = JSON.parse(await data.text()) as CropRecord
    return r?.v === 1 && r.kind === "crop" && typeof r.sourceUrl === "string" ? r : null
  } catch {
    return null
  }
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = isDriveUrl(url) ? await fetchDriveFile(extractDriveFileId(url)!) : await guardedFetch(url)
  if (!res.ok || (res.headers.get("content-type") || "").includes("text/html")) throw new Error("source_unreachable")
  return Buffer.from(await res.arrayBuffer())
}

/** The picture as shown → its caption (if any), the cut it is, and the original. */
async function resolve(supabase: Awaited<ReturnType<typeof createClient>>, url: string) {
  const caption = isCaptionedRenderUrl(url) ? await readCaptionRecord(supabase, url) : null
  if (isCaptionedRenderUrl(url) && !caption) return null
  const base = caption?.sourceUrl ?? url
  const cut = await readCropRecord(supabase, base)
  return { caption, original: cut?.sourceUrl ?? base, crop: cut?.crop ?? CENTRED }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return json({ error: "Unauthorized" }, 401)
  if (!canOwnMediaText(user.email)) return json({ error: "Forbidden" }, 403)
  const url = req.nextUrl.searchParams.get("url") ?? ""
  if (!isHers(url, user.id)) return json({ error: "not_hers" }, 400)
  try {
    const found = await resolve(supabase, url)
    if (!found) return json({ error: "no_original", message: "לא מצאנו את התמונה המקורית של השקופית הזו." }, 404)
    const bytes = await fetchBytes(found.original)
    const img = sharp(bytes).rotate()
    const meta = await img.metadata()
    // Orientation-corrected size (rotate() swaps width/height for 90° turns).
    const turned = (meta.orientation ?? 1) >= 5
    const width = (turned ? meta.height : meta.width) ?? 0
    const height = (turned ? meta.width : meta.height) ?? 0
    const preview = await img.resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    // Her words over the frame while she cuts (Hani, 2026-11-11) — the same
    // layer the save draws, on a transparent 4:5 canvas.
    const c = found.caption?.caption
    const layer = c ? await renderCaptionOverlayPng(c.headline ?? "", c.body ?? "", c.position ?? "bottom", c.style, CANVAS_4_5).catch(() => null) : null
    return json({
      original: `data:image/jpeg;base64,${preview.toString("base64")}`,
      width,
      height,
      crop: found.crop,
      ...(layer ? { caption: `data:image/png;base64,${layer.toString("base64")}` } : {}),
    })
  } catch (err) {
    console.error("[media/crop][GET]", err instanceof Error ? err.message : err)
    return json({ error: "load_failed", message: "לא הצלחנו לטעון את התמונה המקורית. נסו שוב." }, 500)
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return json({ error: "Unauthorized" }, 401)
  if (!canOwnMediaText(user.email)) return json({ error: "Forbidden" }, 403)
  const body = (await req.json().catch(() => ({}))) as { url?: string; crop?: unknown }
  const url = typeof body.url === "string" ? body.url : ""
  const crop: PictureCrop | null = cleanCrop(body.crop)
  if (!crop || !isHers(url, user.id)) return json({ error: "bad_request" }, 400)
  try {
    const found = await resolve(supabase, url)
    if (!found) return json({ error: "no_original", message: "לא מצאנו את התמונה המקורית של השקופית הזו." }, 404)
    const upright = await sharp(await fetchBytes(found.original)).rotate().toBuffer()
    const meta = await sharp(upright).metadata()
    const rect = cropRect(meta.width ?? 0, meta.height ?? 0, crop)
    const cut = await sharp(upright).extract(rect).resize(CROP_OUT.width, CROP_OUT.height, { fit: "fill" }).png().toBuffer()

    const id = crypto.randomUUID()
    const cutPath = `${user.id}/image/crop-${id}.png`
    const up = await supabase.storage.from(BUCKET).upload(cutPath, cut, { contentType: "image/png" })
    if (up.error) throw new Error(up.error.message)
    const record: CropRecord = { v: 1, kind: "crop", sourceUrl: found.original, crop }
    await supabase.storage.from(BUCKET).upload(`${cutPath}.crop.json`, JSON.stringify(record), { contentType: "application/json", upsert: true })
    const cutUrl = supabase.storage.from(BUCKET).getPublicUrl(cutPath).data.publicUrl
    if (!found.caption) return json({ url: cutUrl })

    // Her words go back on, exactly as they were, over the new cut.
    const c = found.caption.caption
    const png = await renderCaptionOverImagePng(cut.toString("base64"), c.headline ?? "", c.body ?? "", CANVAS_4_5, c.position ?? "bottom", c.style)
    const capPath = `${user.id}/image/captioned-${crypto.randomUUID()}.png`
    const capUp = await supabase.storage.from(BUCKET).upload(capPath, png, { contentType: "image/png" })
    if (capUp.error) throw new Error(capUp.error.message)
    const capUrl = supabase.storage.from(BUCKET).getPublicUrl(capPath).data.publicUrl
    await writeCaptionRecord(supabase, capUrl, cutUrl, c, found.caption.textSource)
    return json({ url: capUrl })
  } catch (err) {
    console.error("[media/crop][POST]", err instanceof Error ? err.message : err)
    return json({ error: "crop_failed", message: "החיתוך לא נשמר. נסו שוב." }, 500)
  }
}
