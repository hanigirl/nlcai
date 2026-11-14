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

/** Which of her folders each format reads, first match wins. */
const FOLDERS: Record<BrandDriveFormat, string[]> = {
  carousel: ["carousel", "images"],
  story: ["story", "images"],
  image_post: ["images", "carousel", "story"],
  b_roll: ["broll"],
}

const RASTER = /\.(jpe?g|png|webp)$/i

/** Her folder id for this format, or null when she connected none. */
export async function brandDriveFolder(userId: string, format: BrandDriveFormat): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  const folders = (data.user?.user_metadata as Record<string, unknown> | undefined)?.drive_folders as
    | Record<string, { id?: string } | undefined>
    | undefined
  if (!folders) return null
  for (const key of FOLDERS[format]) {
    const id = folders[key]?.id
    if (id) return id
  }
  return null
}

/**
 * Up to `count` of her pictures from the format's folder, as data URLs (the
 * layout engine's "her picture" input), in random order. [] when there's no
 * folder or nothing readable — then the piece is generated as before.
 */
export async function pickBrandDrivePictures(userId: string, format: BrandDriveFormat, count: number): Promise<string[]> {
  const folderId = await brandDriveFolder(userId, format)
  if (!folderId || count < 1) return []
  const listing = await listPublicFolder(folderId, true).catch(() => null)
  if (!listing || "error" in listing) return []
  const pictures = listing.items
    .filter((i: DriveFolderItem) => i.kind === "image" && RASTER.test(i.name))
    .sort(() => Math.random() - 0.5)
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
