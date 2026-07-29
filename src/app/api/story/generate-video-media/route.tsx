import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import ffmpegPath from "ffmpeg-static"
import { createClient } from "@/lib/supabase/server"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { frameCaption } from "@/lib/story-text-split"
import { renderCaptionOverlayPng } from "@/lib/caption-overlay"
import { getAuthUser } from "@/lib/auth-user"

// Downloading + re-encoding a user video is heavier than an image render;
// libx264 on a short clip still runs in seconds, but leave generous headroom.
export const maxDuration = 300

// Instagram Story — 9:16 vertical (same target as the AI image story).
const CANVAS_WIDTH = 1080
const CANVAS_HEIGHT = 1920

// Hard cap on the burned clip length. IG stories are 60s/segment anyway, and
// this bounds the ffmpeg render time for a runaway-long source video.
const MAX_CLIP_SECONDS = 60

/**
 * "Video story" — the bring-your-own counterpart to the AI image story.
 *
 * The user supplies their OWN mp4 — either uploaded to user-media, or left
 * sitting in Google Drive as a share link (the default for video since
 * 2026-07-27; see `lib/drive-media.ts`). This route:
 *   0. resolves that source to a local temp file — streaming it straight
 *      from Drive when the stored asset is a link, which is the ONE moment
 *      the real bytes are needed and therefore the only place a size limit
 *      could ever bite,
 *   1. renders the post's HOOK as a transparent 9:16 overlay (satori → Resvg,
 *      reusing the Heebo Hebrew font + a legibility scrim), then
 *   2. burns it into the video with ffmpeg (cover-crop to 1080×1920), and
 *   3. stores the finished mp4 back in user-media and persists it as the
 *      story's media (media_assets, asset_type=video) — same slot the raw
 *      bring-your-own video already used, now with the text baked in.
 *
 * Unlike the image route (pure, returns base64), this one persists, because
 * a re-encoded video is too big to round-trip as base64 through the client.
 */

/**
 * Burn the overlay into the source video and cover-crop to exactly
 * 1080×1920 (scale-to-fill then crop — same object-fit:cover behaviour as
 * the image path), keeping any audio. Runs the bundled ffmpeg-static binary
 * so it works identically on Vercel and locally.
 */
function burnOverlay(
  inputPath: string,
  overlayPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary not found"))
      return
    }
    const args = [
      "-y",
      "-i", inputPath,
      "-i", overlayPath,
      "-filter_complex",
      `[0:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${CANVAS_WIDTH}:${CANVAS_HEIGHT},setsar=1[bg];` +
        `[bg][1:v]overlay=0:0[v]`,
      "-map", "[v]",
      "-map", "0:a?", // keep audio if the source has any
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-t", String(MAX_CLIP_SECONDS),
      outputPath,
    ]
    const proc = spawn(ffmpegPath, args)
    let stderr = ""
    proc.stderr.on("data", (d) => {
      // ffmpeg logs progress to stderr; keep only the tail for error context.
      stderr = (stderr + d.toString()).slice(-4000)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`))
    })
  })
}

export async function POST(req: NextRequest) {
  const tmpFiles: string[] = []
  try {
    const {
      postId,
      format: rawFormat,
      sourceUrl: rawSourceUrl,
      persist: rawPersist,
      frameIndex: rawFrameIndex,
      frameCount: rawFrameCount,
    } = (await req.json().catch(() => ({}))) as {
      postId?: string
      format?: string
      /**
       * Burn THIS source instead of the variant's stored video slot. The
       * story panel imports N frames by Drive link and needs each one burned
       * on the way in (Hani, 2026-07-29: "בלי כפתור נוסף"), and those frames
       * live as ordered image rows, not in the single video slot.
       */
      sourceUrl?: string
      /**
       * Write the result back into the variant's video slot. Defaults true —
       * the original one-video behaviour. Per-frame callers pass false and
       * store the returned URL themselves, in order, as part of the set.
       */
      persist?: boolean
      /**
       * Which frame of the story this source is, and how many there are.
       * The script is divided across the set so the frames read as one story
       * (Hani, 2026-07-29): frame 1 leads with the hook, the body is spread
       * over the middle, the closing block lands last. Omitted → the whole
       * script on a single frame.
       */
      frameIndex?: number
      frameCount?: number
    }
    const sourceUrl = rawSourceUrl?.trim() || undefined
    const persist = rawPersist !== false
    const frameCount = Math.max(1, Math.floor(rawFrameCount ?? 1))
    const frameIndex = Math.min(
      Math.max(0, Math.floor(rawFrameIndex ?? 0)),
      frameCount - 1,
    )
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }
    // Which format's video gets the hook burned in. Story was the only one when
    // this was written, so it was hardcoded; b-roll is the same operation on a
    // different variant — footage from the user with the post's hook laid over
    // it. Restricted to the formats that actually own a video, so a typo can't
    // send us looking for a variant that has no media.
    const format = rawFormat ?? "story"
    if (format !== "story" && format !== "b_roll") {
      return NextResponse.json(
        { error: 'format must be "story" or "b_roll"' },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Ownership + the hook that goes ON the video (server-authoritative).
    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id, hook_text, title")
      .eq("id", postId)
      .eq("user_id", user.id)
      .single()
    const post = postRow as {
      id: string
      hook_text: string | null
      title: string | null
    } | null
    if (postErr || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // The format_variant owns the source video (media_assets, video).
    const { data: variantRow } = await supabase
      .from("format_variants")
      .select("id, body")
      .eq("core_post_id", postId)
      .eq("format", format)
      .single()
    const variant = variantRow as { id: string; body: string | null } | null
    if (!variant) {
      return NextResponse.json(
        {
          error: "no_story_variant",
          message: "צרו קודם את פורמט הסטורי לפוסט הזה.",
        },
        { status: 400 },
      )
    }

    const { data: assetRow } = await supabase
      .from("media_assets")
      .select("url")
      .eq("format_variant_id", variant.id)
      .eq("asset_type", "video")
      .maybeSingle()
    // An explicit source wins; otherwise fall back to the variant's slot.
    const videoUrl = sourceUrl ?? (assetRow as { url: string } | null)?.url
    if (!videoUrl) {
      return NextResponse.json(
        {
          error: "no_source_video",
          message:
            "לא נמצא סרטון לסטורי. העלו סרטון או משכו אחד מגוגל דרייב, ואז אפשר להטמיע בו את הכיתוב.",
        },
        { status: 400 },
      )
    }

    // Overlay text: the hook is the headline (falls back to the title, then
    // the first line of the story script). Matches the reel-cover principle
    // — a short, punchy line, not the whole script.
    const hook =
      post.hook_text?.trim() ||
      post.title?.trim() ||
      variant.body?.split(/\n+/)[0]?.trim() ||
      ""
    if (!hook) {
      return NextResponse.json(
        {
          error: "no_hook",
          message: "אין טקסט כותרת לפוסט. הוסיפו הוק ואז נטמיע אותו בסרטון.",
        },
        { status: 400 },
      )
    }

    // This frame's share of the script. The whole script is divided across
    // `frameCount` frames on paragraph boundaries, so each frame carries a
    // coherent piece rather than the same caption repeated N times.
    //
    // Falls back to the hook alone when there's no script body to divide.
    const caption = variant.body?.trim()
      ? frameCaption(variant.body, frameIndex, frameCount)
      : { headline: hook, body: undefined }
    const overlayHook = caption.headline ?? (frameIndex === 0 ? hook : undefined)
    const overlayBody = caption.body
    if (!overlayHook && !overlayBody) {
      // Nothing to say on this frame — hand the source back untouched rather
      // than burning an empty pill onto it.
      return NextResponse.json({ url: sourceUrl ?? "" })
    }

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const tmp = os.tmpdir()
    const id = crypto.randomUUID()
    const inputPath = path.join(tmp, `story-src-${id}.mp4`)
    const overlayPath = path.join(tmp, `story-ovl-${id}.png`)
    const outputPath = path.join(tmp, `story-out-${id}.mp4`)
    tmpFiles.push(inputPath, overlayPath, outputPath)

    // Pull the source video + render the overlay in parallel.
    //
    // The source is either a Supabase storage URL (uploaded file) or a
    // Google Drive share link (the default for bring-your-own video). Drive
    // needs the interstitial-clearing fetch, and neither case should be
    // buffered whole in memory — a link-mode source has no 50MB ceiling, so
    // `arrayBuffer()` here would be an OOM waiting to happen. Stream both
    // straight to the temp file instead.
    const [videoRes, overlayPng] = await Promise.all([
      isDriveUrl(videoUrl)
        ? fetchDriveFile(extractDriveFileId(videoUrl)!)
        : fetch(videoUrl),
      renderCaptionOverlayPng(overlayHook, overlayBody),
    ])
    const srcContentType = (videoRes.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
    if (!videoRes.ok || !videoRes.body) {
      return NextResponse.json(
        { error: `לא הצלחנו לטעון את הסרטון (${videoRes.status})` },
        { status: 502 },
      )
    }
    // Drive answers a revoked/restricted file with a 200 HTML page, not an
    // error status — so a status check alone would hand ffmpeg a web page.
    if (isDriveUrl(videoUrl) && srcContentType.includes("text/html")) {
      await videoRes.body.cancel().catch(() => {})
      return NextResponse.json(
        {
          error: "drive_not_public",
          message:
            'הסרטון בדרייב כבר לא משותף. שנו את ההרשאה ל„כל מי שיש לו הקישור” ונסו שוב.',
        },
        { status: 400 },
      )
    }

    const { createWriteStream } = await import("fs")
    const { Readable } = await import("stream")
    const { pipeline } = await import("stream/promises")
    await pipeline(
      Readable.fromWeb(videoRes.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(inputPath),
    )
    await fs.writeFile(overlayPath, overlayPng)

    await burnOverlay(inputPath, overlayPath, outputPath)

    const outBuffer = await fs.readFile(outputPath)
    // "burned-" prefix marks a text-baked output. The client reads this from
    // the persisted URL to know the story video already has its caption (so it
    // shows a "caption embedded" state instead of offering to burn again and
    // double-stack the text).
    const storagePath = `${user.id}/video/burned-${crypto.randomUUID()}.mp4`
    const { error: uploadError } = await supabase.storage
      .from("user-media")
      .upload(storagePath, outBuffer, { contentType: "video/mp4" })
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }
    const publicUrl = supabase.storage
      .from("user-media")
      .getPublicUrl(storagePath).data.publicUrl

    // Persist as the story's video media — replaces the raw source in the
    // same (variant, video) slot, so the finished clip is what the post uses.
    // Skipped for per-frame burns: those belong to the ordered frame set, and
    // writing each one into the single video slot would leave the last frame
    // masquerading as "the story's video".
    if (persist) {
      await supabase
        .from("media_assets")
        .delete()
        .eq("format_variant_id", variant.id)
        .eq("asset_type", "video")
      await supabase.from("media_assets").insert({
        format_variant_id: variant.id,
        asset_type: "video",
        url: publicUrl,
        status: "completed",
      } as never)
    }

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[story/generate-video-media]", msg)
    return NextResponse.json(
      { error: `הטמעת הכיתוב בסרטון נכשלה: ${msg}` },
      { status: 500 },
    )
  } finally {
    // Best-effort temp cleanup — never let it mask the real result.
    const fs = await import("fs/promises")
    await Promise.all(
      tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)),
    )
  }
}
