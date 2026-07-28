import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import ffmpegPath from "ffmpeg-static"
import { RtlText } from "@/lib/carousel-templates/shared"
import { createClient } from "@/lib/supabase/server"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"

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

// ---- Hebrew font ----
// Rubik, NOT Heebo: the local Heebo-*.ttf files are ~23KB Latin-only subsets
// with NO Hebrew glyphs (satori renders tofu boxes with them). The full
// Rubik-*.ttf files (~175KB) carry Hebrew — this is exactly why the live
// carousel `default` template renders Hebrew via satori using `fontFamily:
// "Rubik"`. We reuse the same font here.
let rubikExtraBold: ArrayBuffer | null = null
let rubikBold: ArrayBuffer | null = null

async function loadRubik() {
  if (rubikExtraBold && rubikBold)
    return { extraBold: rubikExtraBold, bold: rubikBold }
  const fs = await import("fs/promises")
  const path = await import("path")
  const read = async (file: string) => {
    const buf = await fs.readFile(
      path.join(process.cwd(), "public", "fonts", file),
    )
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  rubikExtraBold = await read("Rubik-ExtraBold.ttf")
  rubikBold = await read("Rubik-Bold.ttf")
  return { extraBold: rubikExtraBold, bold: rubikBold }
}

/**
 * Font size steps down as the hook gets longer, so a short punchy hook is
 * big and a longer one still fits without overflowing the safe band.
 */
function fontSizeForHook(text: string): number {
  const len = text.trim().length
  if (len <= 22) return 96
  if (len <= 44) return 78
  if (len <= 80) return 62
  return 52
}

/**
 * The body sits UNDER the hook and must read as secondary, so it steps down
 * from the hook's size rather than tracking its own length independently —
 * the ratio is what makes the hierarchy legible at a glance.
 */
function fontSizeForBody(hookSize: number, body: string): number {
  const base = Math.round(hookSize * 0.46)
  const len = body.trim().length
  if (len <= 90) return base
  if (len <= 180) return Math.round(base * 0.86)
  return Math.round(base * 0.74)
}

/**
 * How much body text can sit on a story frame before it stops being a story.
 * Past this we trim on a word boundary and add an ellipsis — silently
 * dropping the tail would let a long script render as a wall of type that
 * overflows the safe zone.
 */
const MAX_BODY_CHARS = 240

export function trimBodyForOverlay(body: string): string {
  const clean = body.trim().replace(/\s+/g, " ")
  if (clean.length <= MAX_BODY_CHARS) return clean
  const cut = clean.slice(0, MAX_BODY_CHARS)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/**
 * Transparent 9:16 overlay burned onto the user's OWN media.
 *
 * Visual language is deliberately the reel cover's (Hani, 2026-07-28: "בדומה
 * למה שעשינו בקאבר"): white Rubik ExtraBold on a SOLID black pill, 24px
 * radius, centred. The previous version used a translucent 42%-black scrim
 * with a 32px radius — close enough to look like a mistake next to a cover,
 * far enough to read as a different product.
 *
 * Two tiers, not one: the hook is the headline and the body is support, so
 * they get separate pills with a gap between them. One merged block made the
 * hook stop reading as a hook.
 *
 * Nothing here runs for an AI-generated story — those frames arrive from the
 * model with their text already designed in, and laying a second caption over
 * them would double it up.
 */
async function renderOverlayPng(hook: string, body?: string): Promise<Buffer> {
  const { extraBold, bold } = await loadRubik()
  const hookSize = fontSizeForHook(hook)
  const bodyText = body ? trimBodyForOverlay(body) : ""
  const bodySize = bodyText ? fontSizeForBody(hookSize, bodyText) : 0

  // Same solid pill the cover uses — it carries contrast on any footage, so
  // no scrim and no text-shadow are needed on top of it.
  const pill = {
    display: "flex" as const,
    backgroundColor: "#000000",
    borderRadius: 24,
    maxWidth: CANVAS_WIDTH - 180,
  }

  const svg = await satori(
    <div
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        // Keep the text inside the IG safe zone: clear of the reply bar
        // (bottom ~24%) and the profile header (top ~14%).
        paddingBottom: 520,
        paddingLeft: 90,
        paddingRight: 90,
        // The gap IS the separation between hook and body.
        gap: 20,
      }}
    >
      <div style={{ ...pill, padding: "36px 48px" }}>
        {/* RtlText, NOT a raw string: satori has no BiDi, so bare Hebrew
            renders mirrored. This is the SAME shared helper the carousel
            templates use. */}
        <RtlText
          text={hook}
          align="center"
          style={{
            color: "#ffffff",
            fontFamily: "Rubik",
            fontWeight: 800,
            fontSize: hookSize,
            lineHeight: 1.25,
          }}
        />
      </div>

      {bodyText && (
        <div style={{ ...pill, padding: "24px 40px" }}>
          <RtlText
            text={bodyText}
            align="center"
            style={{
              color: "#ffffff",
              fontFamily: "Rubik",
              // Bold, not ExtraBold — the weight drop reinforces the size
              // drop so the hierarchy survives even at a glance.
              fontWeight: 700,
              fontSize: bodySize,
              lineHeight: 1.35,
            }}
          />
        </div>
      )}
    </div>,
    {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fonts: [
        { name: "Rubik", data: extraBold, weight: 800, style: "normal" },
        { name: "Rubik", data: bold, weight: 700, style: "normal" },
      ],
    },
  )

  return Buffer.from(
    new Resvg(svg, { background: "rgba(0,0,0,0)" }).render().asPng(),
  )
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
    const { postId, format: rawFormat } = (await req.json().catch(() => ({}))) as {
      postId?: string
      format?: string
    }
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
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
    const videoUrl = (assetRow as { url: string } | null)?.url
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

    // The story body, minus whatever line the hook already came from — the
    // script usually opens WITH the hook, and burning it twice (once big,
    // once small, one under the other) is the obvious failure mode here.
    const overlayBody = (() => {
      const raw = variant.body?.trim()
      if (!raw) return undefined
      const rest = raw
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        // Compare loosely: the script's opening line is often the hook with
        // different punctuation or spacing.
        .filter((line) => line.replace(/\s+/g, "") !== hook.replace(/\s+/g, ""))
        .join(" ")
      return rest || undefined
    })()

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
      renderOverlayPng(hook, overlayBody),
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
