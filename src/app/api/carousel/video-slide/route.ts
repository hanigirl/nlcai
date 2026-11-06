import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import ffmpegPath from "ffmpeg-static"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { extractDriveFileId } from "@/lib/drive-media"
import { parseTextToSlides } from "@/lib/carousel-slides"
import { videoCaptionWords } from "@/lib/carousel-video-caption"
import { renderOwnVideoCaption, OVERLAY_SECONDS } from "@/lib/own-video-captions"
import {
  CAROUSEL_VIDEO_HEIGHT,
  CAROUSEL_VIDEO_MAX_MB,
  CAROUSEL_VIDEO_MAX_SECONDS,
  CAROUSEL_VIDEO_SOURCE_MAX_MB,
  CAROUSEL_VIDEO_WIDTH,
  carouselVideoTooLongMessage,
} from "@/lib/carousel-video"

/**
 * POST { postId, drive?: link, url?: our storage URL, caption?: { design, slideIndex } }
 *   → { url, seconds } | { error, message }
 *
 * A VIDEO slide for a carousel (Hani, 2026-11-06 — Instagram carousels can mix
 * pictures and clips). Her clip, from Drive or already uploaded from her
 * computer, made into a carousel slide:
 *   - at most CAROUSEL_VIDEO_MAX_SECONDS — a longer clip is refused, plainly,
 *     with its length (never silently trimmed);
 *   - the carousel's 4:5 frame (1080×1350): her whole picture, over a blurred
 *     fill of itself — padded, not cropped into her subject;
 *   - with `caption`: the animated caption of her own-video AI edit (Ben's
 *     lib/own-video-captions) — the slide's own words from the carousel
 *     script, designed per her instruction, laid over her untouched footage.
 * The finished mp4 is stored and its URL returned; the carousel set saves it
 * as a `video` row in its place (lib/media-asset-set).
 */

export const maxDuration = 800

const W = CAROUSEL_VIDEO_WIDTH
const H = CAROUSEL_VIDEO_HEIGHT

class SlideError extends Error {
  constructor(public code: string, message: string, public status = 422) {
    super(message)
  }
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found"))
    const proc = spawn(ffmpegPath, args)
    let err = ""
    proc.stderr.on("data", (d) => {
      err = (err + d.toString()).slice(-6000)
    })
    proc.on("error", reject)
    proc.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err}`))))
  })
}

/** The clip's length in seconds, from ffmpeg's probe (null when it can't tell). */
function clipSeconds(input: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null)
    const proc = spawn(ffmpegPath, ["-i", input])
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

/** Her whole clip in the 4:5 frame, over a blurred fill of itself. */
const PAD_FILTER =
  `[0:v]split=2[a][b];` +
  `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:4,eq=brightness=-0.06[bg];` +
  `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
  `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]`

const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]

export async function POST(req: NextRequest) {
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const stamp = crypto.randomUUID()
  const work = path.join(os.tmpdir(), `carousel-video-${stamp}`)
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { postId, drive, url, caption } = (await req.json().catch(() => ({}))) as {
      postId?: string
      drive?: string
      url?: string
      caption?: { design?: string; slideIndex?: number }
    }
    if (!postId || (!drive && !url)) throw new SlideError("bad_request", "חסר סרטון.", 400)

    const { data: post } = await supabase
      .from("core_posts")
      .select("id, hook_text, title")
      .eq("id", postId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!post) throw new SlideError("not_found", "הפוסט לא נמצא.", 404)

    await fs.mkdir(work, { recursive: true })
    const input = path.join(work, "in")

    // ---- her clip ----
    let res: Response
    if (drive) {
      const id = extractDriveFileId(drive)
      if (!id) throw new SlideError("invalid_drive_link", "לא זוהה קובץ בקישור מהדרייב.")
      res = await fetchDriveFile(id)
      if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
        throw new SlideError("drive_not_public", "הסרטון בדרייב לא פתוח לצפייה. שתפו אותו לכל מי שיש לו את הקישור.")
      }
    } else {
      const origin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null
      if (!origin || new URL(url!).origin !== origin) throw new SlideError("bad_url", "הסרטון לא נמצא.", 400)
      res = await fetch(url!)
      if (!res.ok) throw new SlideError("not_found", "הסרטון לא נמצא.")
    }
    const declared = Number(res.headers.get("content-length") || 0)
    if (declared > CAROUSEL_VIDEO_SOURCE_MAX_MB * 1024 * 1024) {
      throw new SlideError("too_large", `הסרטון גדול מדי (מעל ${CAROUSEL_VIDEO_SOURCE_MAX_MB}MB).`)
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > CAROUSEL_VIDEO_SOURCE_MAX_MB * 1024 * 1024) {
      throw new SlideError("too_large", `הסרטון גדול מדי (מעל ${CAROUSEL_VIDEO_SOURCE_MAX_MB}MB).`)
    }
    await fs.writeFile(input, bytes)

    const seconds = await clipSeconds(input)
    if (seconds === null) throw new SlideError("not_video", "לא הצלחתי לקרוא את הקובץ כסרטון.")
    if (seconds > CAROUSEL_VIDEO_MAX_SECONDS + 0.5) {
      throw new SlideError("too_long", carouselVideoTooLongMessage(seconds))
    }

    // ---- the slide ----
    const output = path.join(work, "out.mp4")
    if (caption) {
      const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => null)
      if (!anthropicKey) throw new SlideError("anthropic_not_connected", "כדי להוסיף כיתוב מונפש צריך לחבר מפתח Claude בהגדרות.", 400)
      // The slide's own words, from the carousel script; the hook when the
      // script has no slide there.
      const { data: variant } = await supabase
        .from("format_variants")
        .select("body")
        .eq("core_post_id", postId)
        .eq("format", "carousel")
        .maybeSingle()
      const slides = parseTextToSlides((variant as { body: string | null } | null)?.body ?? "")
      const at = slides[Math.max(0, caption.slideIndex ?? 0)]
      const p = post as { hook_text: string | null; title: string | null }
      const scriptHeadline = at?.title?.trim() || p.hook_text?.trim() || p.title?.trim() || ""
      const scriptBody = at?.title ? at.body?.trim() || undefined : undefined
      // The script's words by default; her message can change them, not
      // only their look (Hani, 2026-11-06 — lib/carousel-video-caption).
      const words = await videoCaptionWords(anthropicKey, { headline: scriptHeadline, body: scriptBody }, caption.design)
      const framesDir = path.join(work, "frames")
      await fs.mkdir(framesDir, { recursive: true })
      const frames = await renderOwnVideoCaption(
        supabase,
        user.id,
        anthropicKey,
        "carousel",
        { headline: words.headline, body: words.body, design: words.design },
        framesDir,
      )
      const fps = Math.max(1, Math.round(frames / OVERLAY_SECONDS))
      const fadeAt = Math.max(0, seconds - 0.5)
      // The 9:16 layer's middle 1350px over the 4:5 slide; its last frame
      // holds and fades out at the end, like the story / b-roll burn.
      const filter =
        PAD_FILTER +
        `;[1:v]format=rgba,crop=${W}:${H}:0:285,tpad=stop_mode=clone:stop_duration=${CAROUSEL_VIDEO_MAX_SECONDS},fade=t=out:st=${fadeAt.toFixed(2)}:d=0.5:alpha=1,setsar=1[cap]` +
        `;[base][cap]overlay=0:0:shortest=1[v]`
      await run([
        "-y", "-i", input,
        "-framerate", String(fps), "-i", path.join(framesDir, "f%04d.png"),
        "-filter_complex", filter,
        "-map", "[v]", "-map", "0:a?",
        ...ENCODE,
        "-t", String(seconds),
        output,
      ])
    } else {
      await run(["-y", "-i", input, "-filter_complex", PAD_FILTER, "-map", "[base]", "-map", "0:a?", ...ENCODE, output])
    }

    const out = await fs.readFile(output)
    if (out.length > CAROUSEL_VIDEO_MAX_MB * 1024 * 1024) {
      throw new SlideError("too_large", `שקופית הווידאו יצאה גדולה מ-${CAROUSEL_VIDEO_MAX_MB}MB. נסו סרטון קצר יותר.`)
    }
    const storagePath = `${user.id}/carousel/video-${stamp}.mp4`
    const { error: upErr } = await supabase.storage
      .from("user-media")
      .upload(storagePath, out, { contentType: "video/mp4" })
    if (upErr) throw new Error(upErr.message)
    const publicUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl
    return NextResponse.json({ url: publicUrl, seconds: Math.round(seconds) })
  } catch (err) {
    if (err instanceof SlideError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status })
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[carousel/video-slide]", msg)
    return NextResponse.json(
      { error: "video_slide_failed", message: "לא הצלחתי להכין את שקופית הווידאו. נסו שוב." },
      { status: 500 },
    )
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}
