import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import { createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import ffmpegPath from "ffmpeg-static"
import { renderOwnVideoCaption } from "@/lib/own-video-captions"
import { RENDER_FPS } from "@/lib/broll-animation/render"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { frameCaption } from "@/lib/story-text-split"
import {
  renderCaptionOverlayPng,
  renderSecondaryCaptionPng,
} from "@/lib/caption-overlay"
import { hasDescriptionCta } from "@/lib/broll-copy"
import { getAuthUser } from "@/lib/auth-user"
import { cleanCaptionSpec, type CaptionSpec } from "@/lib/own-media"
import { writeCaptionRecord } from "@/lib/caption-record"
import { guardedFetch } from "@/lib/server-fetch"
import { canOwnMediaText } from "@/lib/feature-access"
import { NO_SCRIPT_TEXT, scriptTextFor, type TextSource } from "@/lib/script-text"
import { captionLookFor } from "@/lib/caption-look"

// Downloading + re-encoding a user video is heavier than an image render;
// libx264 on a short clip still runs in seconds, but leave generous headroom.
// The animated caption on her own video (lib/own-video-captions) is an Opus
// composition plus a frame render before the burn — the b-roll engine's
// budget (Pro + Fluid compute allow 800s).
export const maxDuration = 800

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

/** The clip's length in seconds, read from ffmpeg's own probe output (null when it can't tell). */
function clipSeconds(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null)
    const proc = spawn(ffmpegPath, ["-i", inputPath])
    let err = ""
    proc.stderr.on("data", (d) => {
      err += d.toString()
    })
    proc.on("error", () => resolve(null))
    proc.on("close", () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null)
    })
  })
}

/**
 * Lay the ANIMATED caption layer (PNG frames with alpha, lib/own-video-
 * captions) over her clip: the entrance plays, its last frame holds, and it
 * fades out over the clip's last half second. Same cover-crop and audio as
 * the still burn.
 */
async function burnAnimatedOverlay(inputPath: string, framesPattern: string, fps: number, outputPath: string): Promise<void> {
  const total = Math.min(MAX_CLIP_SECONDS, (await clipSeconds(inputPath)) ?? MAX_CLIP_SECONDS)
  const fadeAt = Math.max(0, total - 0.5)
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary not found"))
      return
    }
    // ONE template literal per line on purpose (see burnOverlay).
    const filter =
      `[0:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=increase,crop=${CANVAS_WIDTH}:${CANVAS_HEIGHT},setsar=1[bg];` +
      `[1:v]format=rgba,tpad=stop_mode=clone:stop_duration=${MAX_CLIP_SECONDS},fade=t=out:st=${fadeAt.toFixed(2)}:d=0.5:alpha=1,setsar=1[cap];` +
      `[bg][cap]overlay=0:0:shortest=1[v]`
    const args = [
      "-y",
      "-i", inputPath,
      "-framerate", String(fps), "-i", framesPattern,
      "-filter_complex", filter,
      "-map", "[v]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-t", String(total),
      outputPath,
    ]
    const proc = spawn(ffmpegPath, args)
    let stderr = ""
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    proc.on("error", reject)
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))))
  })
}

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
  /**
   * Optional second caption ("קראו בתיאור" on b-roll), arriving after the
   * hook has had time to land.
   */
  secondaryPath?: string,
  /**
   * The source is a STILL (her picture as a b-roll, gated): held for this
   * many seconds so the text can fade in over it — a b-roll is a clip.
   */
  stillSeconds?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary not found"))
      return
    }
    // The caption FADES IN rather than being present from frame one
    // (Hani, 2026-07-29). The AI b-roll generator always animated its
    // caption; this path — the user's own clip from Drive — pasted a static
    // layer, so the same feature behaved differently depending on where the
    // footage came from.
    const filter =
      // ONE template literal on purpose. Split into two joined by `+`, the
      // production build folds them and drops the first one's tail — the
      // filter shipped as "scale=1080:1920crop=..." and every burn failed
      // with "Option not found" (2026-10-07). Don't split this line.
      `[0:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=increase,crop=${CANVAS_WIDTH}:${CANVAS_HEIGHT},setsar=1[bg];` +
      `[1:v]format=rgba,fade=t=in:st=0.7:d=0.9:alpha=1,setsar=1[cap];` +
      (secondaryPath
        ? // Comes in at 2s, once the hook has been read, and stays.
          `[bg][cap]overlay=0:0[v1];` +
          `[2:v]format=rgba,fade=t=in:st=2:d=0.7:alpha=1,setsar=1[cap2];` +
          `[v1][cap2]overlay=0:0[v]`
        : `[bg][cap]overlay=0:0[v]`)

    const length = stillSeconds ?? MAX_CLIP_SECONDS
    const args = [
      "-y",
      ...(stillSeconds ? ["-loop", "1", "-framerate", "30", "-t", String(stillSeconds)] : []),
      "-i", inputPath,
      // `-loop 1` on the caption stills is what makes the fade possible, and
      // it is NOT optional: a single-frame input has no timeline, so `fade`
      // holds it at its t=0 value — fully transparent — and overlay's
      // repeat-last-frame behaviour then pastes that invisible frame for the
      // whole clip. Without the loop the caption never appears at all.
      // Verified by sampling frame colour at 0.2s / 1.5s / 3.0s.
      "-loop", "1", "-t", String(length), "-i", overlayPath,
      ...(secondaryPath
        ? ["-loop", "1", "-t", String(length), "-i", secondaryPath]
        : []),
      "-filter_complex",
      filter,
      "-map", "[v]",
      "-map", "0:a?", // keep audio if the source has any
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-t", String(length),
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

const squashWords = (t?: string | null) => (t ?? "").replace(/[\s"'״׳.,!?:;—–-]+/g, "")

/** The same words (spacing / punctuation aside). */
function sameWords(a: { headline?: string; body?: string }, b: { headline?: string; body?: string } | null): boolean {
  return !!b && squashWords([a.headline, a.body].join("")) === squashWords([b.headline, b.body].join(""))
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
      caption: rawCaption,
      animated: rawAnimated,
    } = (await req.json().catch(() => ({}))) as {
      /**
       * The AI edit of her own video (lib/own-media-edit): the caption is an
       * animated motion design in her visual language (lib/own-video-
       * captions), not the still plate. Needs her Claude key; without one —
       * or if the composition fails — the still plate is burned as before.
       */
      animated?: boolean
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
      /**
       * "עריכת מדיה עם AI" on her own video (Hani, 2026-10-29): the exact
       * words, placement and look to burn, instead of the post's script.
       * Always paired with `sourceUrl` = the clip as she brought it.
       */
      caption?: unknown
    }
    let override: CaptionSpec | null = rawCaption ? cleanCaptionSpec(rawCaption) : null
    if (override && !override.headline && !override.body) {
      return NextResponse.json({ error: "caption_empty", message: "אין טקסט לכיתוב." }, { status: 400 })
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
    // Her picture as a b-roll (gated, Hani 2026-11-10): it becomes a clip
    // with the text coming in — not a still with the text pasted on.
    const { data: stillRow } =
      !assetRow && format === "b_roll" && canOwnMediaText(user.email)
        ? await supabase
            .from("media_assets")
            .select("url")
            .eq("format_variant_id", variant.id)
            .eq("asset_type", "image")
            .maybeSingle()
        : { data: null }
    // An explicit source wins; otherwise fall back to the variant's slot.
    const videoUrl =
      sourceUrl ?? (assetRow as { url: string } | null)?.url ?? (stillRow as { url: string } | null)?.url
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

    // Her own media + the script's text (Hani, 2026-11-09 — gated, story
    // only): the words are the script's story for THIS frame, verbatim — never
    // the hook or title, never the script re-split across the file count. A
    // frame the script has no story for gets no text, and the caller is told.
    const ownStory = format === "story" && canOwnMediaText(user.email)
    if (ownStory) {
      if (!override) {
        const unit = scriptTextFor("story", variant.body, frameIndex)
        if (!unit) {
          return NextResponse.json({ error: "no_script_text", message: NO_SCRIPT_TEXT }, { status: 400 })
        }
        override = { headline: unit.headline, body: unit.body, position: "bottom" }
      }
      // Reads on dark and light footage alike: her brand box, or white on black.
      if (!override.style) override = { ...override, style: await captionLookFor(supabase, user.id) }
    }

    // B-roll, own media + script text (Hani, 2026-11-09, gated): the words
    // on her clip are the b-roll script's — its first line, then the reading
    // caption (lib/script-text) — never the hook / title, never an added
    // "קראו בתיאור" plate. No script text → nothing is invented; she's told.
    const brollScript = format === "b_roll" && canOwnMediaText(user.email)
    const brollText = brollScript ? scriptTextFor("b_roll", variant.body) : null
    if (brollScript && !override && !brollText) {
      return NextResponse.json({ error: "no_script_text", message: NO_SCRIPT_TEXT }, { status: 400 })
    }

    // Overlay text: the hook is the headline (falls back to the title, then
    // the first line of the story script). Matches the reel-cover principle
    // — a short, punchy line, not the whole script.
    const hook =
      post.hook_text?.trim() ||
      post.title?.trim() ||
      variant.body?.split(/\n+/)[0]?.trim() ||
      ""
    if (!hook && !override && !brollText) {
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
    const caption = brollText
      ? brollText
      : variant.body?.trim()
      ? frameCaption(variant.body, frameIndex, frameCount)
      : { headline: hook, body: undefined }
    const overlayHook = override
      ? override.headline
      : brollText
      ? brollText.headline
      : caption.headline ?? (frameIndex === 0 ? hook : undefined)
    const overlayBody = override ? override.body : caption.body
    const position = override?.position ?? "bottom"
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
        : guardedFetch(videoUrl),
      // Her own video: the Drive look always — white words, a box per line,
      // her primary colour or black (Hani, 2026-11-09).
      // (Hani only for now — everyone else keeps the look they had.)
      renderCaptionOverlayPng(
        overlayHook,
        overlayBody,
        position,
        canOwnMediaText(user.email) ? { ...(await captionLookFor(supabase, user.id)), ...override?.style } : override?.style,
      ),
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

    // A picture is not a clip: through ffmpeg it came back as a near
    // single-frame mp4. Stills take the still caption path (api/media/caption-image).
    if (ownStory && srcContentType.startsWith("image/")) {
      await videoRes.body.cancel().catch(() => {})
      return NextResponse.json(
        { error: "not_a_video", message: "זו תמונה ולא סרטון — הטקסט על תמונה נכנס בדרך של התמונות." },
        { status: 400 },
      )
    }

    // Her picture as a b-roll (gated): held 7s — the AI b-roll's length —
    // with the text fading in. ffmpeg reads a still by its extension.
    const stillSource = brollScript && srcContentType.startsWith("image/")
    let srcPath = inputPath
    if (stillSource) {
      const ext = srcContentType.includes("png") ? "png" : srcContentType.includes("webp") ? "webp" : "jpg"
      srcPath = path.join(tmp, `story-src-${id}.${ext}`)
      tmpFiles.push(srcPath)
    }

    // Static imports, not `await import("stream")`: the dynamic form came back
    // with `Readable` undefined in a dev server ("Cannot read properties of
    // undefined (reading 'fromWeb')", 2026-10-07), failing every burn there.
    await pipeline(
      Readable.fromWeb(videoRes.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(srcPath),
    )
    await fs.writeFile(overlayPath, overlayPng)

    // Every b-roll carries the follow-up line; the story doesn't — its frames
    // already end on their own CTA block.
    let secondaryPath: string | undefined
    if (format === "b_roll" && !brollScript && !hasDescriptionCta(overlayHook, overlayBody)) {
      const fsMod = await import("fs/promises")
      const pathMod = await import("path")
      secondaryPath = pathMod.join(tmp, `story-ovl2-${id}.png`)
      tmpFiles.push(secondaryPath)
      await fsMod.writeFile(secondaryPath, await renderSecondaryCaptionPng())
    }

    // Her own video, edited with AI: the animated caption in her visual
    // language. Any failure on the way falls back to the still plate.
    let animatedDone = false
    // B-roll (gated): why the animated caption didn't happen, so the chat
    // can say so instead of "done" over a still plate.
    let animatedFallback: "no_key" | "failed" | undefined
    if (rawAnimated === true && override) {
      const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => null)
      if (!anthropicKey && brollScript) animatedFallback = "no_key"
      if (anthropicKey) {
        const framesDir = await fs.mkdtemp(path.join(tmp, `story-anim-${id}-`))
        try {
          await renderOwnVideoCaption(supabase, user.id, anthropicKey, format, { ...override, position }, framesDir)
          await burnAnimatedOverlay(inputPath, path.join(framesDir, "f%04d.png"), RENDER_FPS, outputPath)
          animatedDone = true
        } catch (err) {
          console.error("[story/generate-video-media] animated caption, falling back to the still plate", err)
          if (brollScript) animatedFallback = "failed"
        } finally {
          await fs.rm(framesDir, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    }
    if (!animatedDone) await burnOverlay(srcPath, overlayPath, outputPath, secondaryPath, stillSource ? 7 : undefined)

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
      // A b-roll is ONE piece (gated): a still left beside the clip would
      // be read back instead of it, so both slots are cleared.
      await supabase
        .from("media_assets")
        .delete()
        .eq("format_variant_id", variant.id)
        .in("asset_type", brollScript ? ["video", "image"] : ["video"])
      await supabase.from("media_assets").insert({
        format_variant_id: variant.id,
        asset_type: "video",
        url: publicUrl,
        status: "completed",
      } as never)
    }

    // Remember what this render was drawn over, and what it says — so the
    // caption can later be rewritten or taken off without stacking.
    // Where the words came from (b-roll, gated): the script's, or hers.
    const textSource: TextSource | undefined = brollScript
      ? !override || sameWords(override, brollText)
        ? "script"
        : "dictated"
      : undefined
    await writeCaptionRecord(supabase, publicUrl, videoUrl, {
      headline: overlayHook,
      body: overlayBody,
      position,
      style: override?.style,
      ...(override?.design ? { design: override.design } : {}),
    }, textSource ?? (ownStory && !rawCaption ? "script" : undefined))

    return NextResponse.json({
      url: publicUrl,
      ...(animatedFallback ? { animatedFallback } : {}),
    })
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
