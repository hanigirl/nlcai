/**
 * EXPERIMENT (Hani, 2026-11-10, branch exp/broll-drive-in-composition):
 * a visual-language b-roll takes one picture or video from her Drive b-roll
 * folder (Settings → מדיה → "מדיה מ-Google Drive" → בי-רול) and the motion
 * file sits WHOLE (never cropped — Hani: "לא לחתוך את התמונה בשום אופן") on
 * the generated visual-language background, its edges melting into it, with
 * the typography on top. No blurred copy of itself around it (she read those
 * bands as a crop). This deliberately loosens "שפה ויזואלית ≠ דרייב" for a
 * trial; it's gated (lib/feature-access DRIVE_IN_BROLL_EMAILS).
 *
 * The file is copied to our storage first (the renderer can't read Drive),
 * a video cut to the clip's length and re-encoded to WebM, which headless
 * Chromium plays (it has no H.264).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { listPublicFolder, type DriveFolderItem } from "@/lib/drive-folder"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { COMPOSITION_HEIGHT, COMPOSITION_SECONDS } from "@/lib/broll-animation/compose"

const BUCKET = "user-media"
/** Bigger files are skipped — the download alone would eat the clip's time. */
const MAX_BYTES = 250 * 1024 * 1024
const RASTER = /\.(jpe?g|png|webp)$/i

/** Her file in our storage, and its size (to place it whole). */
export type LibraryMedia = { kind: "image" | "video"; url: string; width: number; height: number; name: string }


async function brollFolderId(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  const folders = (data.user?.user_metadata as Record<string, unknown> | undefined)?.drive_folders as
    | Record<string, { id?: string }>
    | undefined
  return folders?.broll?.id ?? null
}

async function download(id: string): Promise<Buffer | null> {
  const res = await fetchDriveFile(id)
  if (!res.ok) return null
  const len = Number(res.headers.get("content-length") || 0)
  if (len > MAX_BYTES) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length > MAX_BYTES ? null : buf
}

async function toWebm(input: Buffer): Promise<Buffer> {
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const { spawn } = await import("child_process")
  const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string
  const stamp = crypto.randomUUID()
  const src = path.join(os.tmpdir(), `lib-${stamp}.in`)
  const out = path.join(os.tmpdir(), `lib-${stamp}.webm`)
  await fs.writeFile(src, input)
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath, [
        "-y", "-i", src,
        "-t", String(COMPOSITION_SECONDS + 1),
        "-an",
        "-vf", `scale=-2:${Math.round(COMPOSITION_HEIGHT * 0.75)}:force_original_aspect_ratio=decrease,fps=30`,
        "-c:v", "libvpx", "-b:v", "3M", "-deadline", "realtime", "-cpu-used", "8",
        out,
      ])
      let err = ""
      p.stderr.on("data", (d) => (err = (err + d).slice(-2000)))
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`library_transcode: ${err}`))))
    })
    return await fs.readFile(out)
  } finally {
    await Promise.all([fs.unlink(src), fs.unlink(out)].map((p) => p.catch(() => undefined)))
  }
}

async function firstFrame(webm: Buffer): Promise<Buffer> {
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const { spawn } = await import("child_process")
  const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string
  const stamp = crypto.randomUUID()
  const src = path.join(os.tmpdir(), `lib-${stamp}.webm`)
  const out = path.join(os.tmpdir(), `lib-${stamp}.png`)
  await fs.writeFile(src, webm)
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath, ["-y", "-i", src, "-frames:v", "1", out])
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("library_first_frame"))))
    })
    return await fs.readFile(out)
  } finally {
    await Promise.all([fs.unlink(src), fs.unlink(out)].map((p) => p.catch(() => undefined)))
  }
}

/**
 * One file from her b-roll folder, in our storage, or null when there's no
 * folder / nothing usable — then the b-roll is built as before.
 */
export async function pickLibraryMedia(
  supabase: SupabaseClient,
  userId: string,
  stamp: string,
): Promise<LibraryMedia | null> {
  const folderId = await brollFolderId(userId)
  if (!folderId) return null
  const listing = await listPublicFolder(folderId, true).catch(() => null)
  if (!listing || "error" in listing) return null
  const usable = listing.items.filter((i: DriveFolderItem) => i.kind === "video" || RASTER.test(i.name))
  // Random order, then the first one that downloads.
  const order = usable.sort(() => Math.random() - 0.5).slice(0, 3)
  const sharp = (await import("sharp")).default
  for (const item of order) {
    const buf = await download(item.id).catch(() => null)
    if (!buf) continue
    let body: Buffer
    let size: Buffer
    if (item.kind === "image") {
      body = await sharp(buf).rotate().resize(1080, 1920, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
      size = body
    } else {
      const webm = await toWebm(buf).catch(() => null)
      if (!webm) continue
      const frame = await firstFrame(webm).catch(() => null)
      if (!frame) continue
      body = webm
      size = frame
    }
    const meta = await sharp(size).metadata()
    const ext = item.kind === "image" ? "jpg" : "webm"
    const path = `${userId}/b_roll/${stamp}-library.${ext}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType: item.kind === "image" ? "image/jpeg" : "video/webm" })
    if (error) continue
    return {
      kind: item.kind,
      url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      width: meta.width ?? 1080,
      height: meta.height ?? 1920,
      name: item.name,
    }
  }
  return null
}
