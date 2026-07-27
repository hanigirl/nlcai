import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { extractDriveFileId, driveEmbedUrl, driveThumbnailUrl } from "@/lib/drive-media"
import { probeDriveFile } from "@/lib/drive-fetch"

// Headroom over the 12s Drive header timeout in lib/drive-fetch, so OUR
// error wins the race against the platform killing the function.
export const maxDuration = 30

/**
 * POST /api/media/drive-info
 *
 * Resolves a Google Drive share link WITHOUT downloading the file.
 *
 * This is the paste-time counterpart to `/api/media/from-drive`. It answers
 * the only two questions the UI actually needs on paste — "is this link
 * reachable?" and "is it a video or an image?" — at the cost of one round
 * trip, instead of a full transfer to our bucket.
 *
 * Videos are then stored as the LINK itself and previewed through Drive's
 * embedded player, which is why a 2GB reel no longer trips a 50MB cap.
 * Images still go through `/api/media/from-drive` (see the invariant note
 * in `lib/drive-media.ts`), and the caller routes them there based on the
 * `kind` this endpoint returns.
 *
 * Response: { fileId, kind, contentType, sizeBytes, embedUrl, thumbnailUrl }
 * Errors mirror the download route: invalid_drive_link | drive_not_public.
 */
export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string }
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 })
    }

    const fileId = extractDriveFileId(url)
    if (!fileId) {
      return NextResponse.json({ error: "invalid_drive_link" }, { status: 400 })
    }

    // Auth-gate it like every other media endpoint — this reaches out to a
    // third party on the caller's behalf, so it isn't an open proxy.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const probe = await probeDriveFile(fileId)
    if (typeof probe === "string") {
      return NextResponse.json({ error: probe }, { status: 400 })
    }

    return NextResponse.json({
      fileId,
      kind: probe.kind,
      contentType: probe.contentType,
      sizeBytes: probe.sizeBytes,
      embedUrl: driveEmbedUrl(fileId),
      thumbnailUrl: driveThumbnailUrl(fileId),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[media/drive-info]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
