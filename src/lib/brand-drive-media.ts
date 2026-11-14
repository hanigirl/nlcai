/**
 * "שפת המותג" uses HER media (Nataliya, PM, 2026-11-14, Notion #1): when she
 * has a Drive folder in Settings → מדיה → "מדיה מ-Google Drive", a brand-
 * language piece always takes from it, without asking which picture — a
 * carousel / story / image post prefers pictures, a b-roll prefers videos
 * (lib/broll-animation/library-media). Without a folder, the brand language
 * generates text, colours and elements only (lib/visual-language/graphic-only).
 *
 * Gated: Hani + Nataliya (brandDriveMedia in lib/feature-access).
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { listPublicFolder, type DriveFolderItem } from "@/lib/drive-folder"
import { driveFileBytes } from "@/lib/broll-animation/library-media"

export type BrandDriveFormat = "carousel" | "story" | "image_post" | "b_roll"

/**
 * Which of her folders each format reads, first match wins. "photos" /
 * "videos" are the one-folder-per-kind settings (Notion #20); the old per-
 * format folders follow, so what she saved before keeps working.
 */
const FOLDERS: Record<BrandDriveFormat, string[]> = {
  carousel: ["photos", "carousel", "images"],
  story: ["photos", "story", "images"],
  image_post: ["photos", "images", "carousel", "story"],
  b_roll: ["videos", "broll"],
}

const RASTER = /\.(jpe?g|png|webp)$/i

/** Her folder ids for this format, in order of preference ([] when she connected none). */
export async function brandDriveFolders(userId: string, format: BrandDriveFormat): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  const folders = (data.user?.user_metadata as Record<string, unknown> | undefined)?.drive_folders as
    | Record<string, { id?: string } | undefined>
    | undefined
  if (!folders) return []
  return [...new Set(FOLDERS[format].map((k) => folders[k]?.id).filter((id): id is string => !!id))]
}

/** Her first folder for this format, or null. */
export async function brandDriveFolder(userId: string, format: BrandDriveFormat): Promise<string | null> {
  return (await brandDriveFolders(userId, format))[0] ?? null
}

/**
 * Up to `count` of her pictures from the format's folder, as data URLs (the
 * layout engine's "her picture" input), in random order. [] when there's no
 * folder or nothing readable — then the piece is generated as before.
 */
export async function pickBrandDrivePictures(userId: string, format: BrandDriveFormat, count: number): Promise<string[]> {
  if (count < 1) return []
  // The first of her folders that has pictures (a story folder of videos only falls back to "images").
  let pictures: DriveFolderItem[] = []
  for (const folderId of await brandDriveFolders(userId, format)) {
    const listing = await listPublicFolder(folderId, true).catch(() => null)
    if (!listing || "error" in listing) continue
    pictures = listing.items.filter((i: DriveFolderItem) => i.kind === "image" && RASTER.test(i.name)).sort(() => Math.random() - 0.5)
    if (pictures.length) break
  }
  // A few failed downloads at most, so a broken folder can't stall the generation.
  pictures = pictures.slice(0, count + 3)
  const sharp = (await import("sharp")).default
  const out: string[] = []
  for (const item of pictures) {
    if (out.length >= count) break
    const buf = await driveFileBytes(item.id)
    if (!buf) continue
    try {
      // Small enough for the request and the models (a data URL each).
      const jpg = await sharp(buf).rotate().resize(1440, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      out.push(`data:image/jpeg;base64,${jpg.toString("base64")}`)
    } catch {
      continue
    }
  }
  return out
}

/** A video of hers for a story frame: from the videos folder (or the old story folder). */
async function pickStoryVideo(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  const folders = (data.user?.user_metadata as Record<string, unknown> | undefined)?.drive_folders as
    | Record<string, { id?: string } | undefined>
    | undefined
  for (const key of ["videos", "story"]) {
    const id = folders?.[key]?.id
    if (!id) continue
    const listing = await listPublicFolder(id, true).catch(() => null)
    if (!listing || "error" in listing) continue
    const videos = listing.items.filter((i: DriveFolderItem) => i.kind === "video")
    if (videos.length) return `https://drive.google.com/file/d/${videos[Math.floor(Math.random() * videos.length)].id}/view`
  }
  return null
}

/**
 * A brand-language story takes, at random, a picture OR a video of hers
 * (Hani, 2026-11-14: "צריך לקחת רנדומלית מאחד מהם"). A picture goes into the
 * design of the first frame; a video becomes a frame of its own (her video
 * with that frame's text). Pictures only when the story has a single frame.
 */
export async function pickBrandDriveStoryMedia(
  userId: string,
  frames: number,
): Promise<{ kind: "image"; dataUrl: string } | { kind: "video"; url: string } | null> {
  const tryVideo = frames > 1 && Math.random() < 0.5
  if (tryVideo) {
    const url = await pickStoryVideo(userId).catch(() => null)
    if (url) return { kind: "video", url }
  }
  const [pic] = await pickBrandDrivePictures(userId, "story", 1).catch(() => [] as string[])
  if (pic) return { kind: "image", dataUrl: pic }
  if (!tryVideo && frames > 1) {
    const url = await pickStoryVideo(userId).catch(() => null)
    if (url) return { kind: "video", url }
  }
  return null
}
