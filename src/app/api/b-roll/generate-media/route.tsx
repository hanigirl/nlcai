import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import { Resvg } from "@resvg/resvg-js"
import ffmpegPath from "ffmpeg-static"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  CAPTION_CANVAS_HEIGHT,
  CAPTION_CANVAS_WIDTH,
  renderCaptionOverlayPng,
  renderSecondaryCaptionPng,
} from "@/lib/caption-overlay"
import { getAuthUser } from "@/lib/auth-user"
import { generateImage } from "@/lib/openai-image"
import {
  resolveDesignDirection,
  type DesignDirection,
} from "@/lib/visual-language/direction"

// gpt-image-2 takes 30-120s for one image.
export const maxDuration = 300

/**
 * AI b-roll — a still, not a clip (Hani, 2026-07-29: "מנוע יצירה לבי רול זה
 * בעצם תמונה עם כיתוב מעליה").
 *
 * The split of labour is the whole point, and it differs from the AI story:
 *   - the MODEL draws a background only, and is told in as many ways as the
 *     prompt allows to put no text in it;
 *   - WE lay the caption over it, with the same renderer that burns captions
 *     onto the user's own footage.
 *
 * Why not let the model set the type, as the story route does? Because then
 * the Hebrew is only as good as the model's spelling, and the caption looks
 * subtly different every run. Rendering it ourselves makes the text exact by
 * construction and identical to every other captioned surface in the app.
 *
 * The output is a 7-second CLIP, not a still (Hani, 2026-07-29). The
 * background drifts in a slow Ken Burns zoom and the caption fades up at ~0.7s
 * and stays. Animating them separately is only possible because they're
 * rendered separately — had the model drawn the text into the picture, there
 * would be nothing to move independently.
 *
 * Persists, unlike the AI story route. The story returns candidates for the
 * user to choose between; b-roll produces exactly one clip, so there is
 * nothing to choose and a round trip through the client to upload it would
 * just be ceremony. Same slot the burn path writes to.
 */

/** Instagram-ish b-roll length; long enough to read, short enough to loop. */
const CLIP_SECONDS = 7
const CLIP_FPS = 25

/**
 * Ken Burns on the still + the caption fading up over it.
 *
 * The background is upscaled to 2x BEFORE zoompan: zoompan samples at the
 * scale it's given, and at 1080 wide the drift visibly jitters pixel-by-pixel.
 * `on` is the output frame index, so the zoom is linear across the clip
 * rather than eased — a still drifting at constant speed reads as intentional;
 * one that accelerates reads as a glitch.
 */
function renderClip(
  backgroundPath: string,
  captionPath: string,
  secondaryPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary not found"))
      return
    }
    const frames = CLIP_SECONDS * CLIP_FPS
    const args = [
      "-y",
      "-loop", "1", "-i", backgroundPath,
      "-loop", "1", "-t", String(CLIP_SECONDS), "-i", captionPath,
      "-loop", "1", "-t", String(CLIP_SECONDS), "-i", secondaryPath,
      "-filter_complex",
      `[0:v]scale=${CAPTION_CANVAS_WIDTH * 2}:${CAPTION_CANVAS_HEIGHT * 2}:flags=lanczos,` +
        `zoompan=z='min(1+0.0006*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `d=${frames}:s=${CAPTION_CANVAS_WIDTH}x${CAPTION_CANVAS_HEIGHT}:fps=${CLIP_FPS},` +
        `trim=duration=${CLIP_SECONDS},setpts=PTS-STARTPTS,setsar=1[bg];` +
        // Fades in and STAYS — no fade-out. The last frame is the one that
        // gets screenshotted and re-shared.
        `[1:v]format=rgba,fade=t=in:st=0.7:d=0.9:alpha=1,setsar=1[cap];` +
        `[bg][cap]overlay=0:0:shortest=1[v1];` +
        // "קראו בתיאור" arrives at 2s — after the hook has been read, well
        // inside a 7s clip — and stays to the end.
        `[2:v]format=rgba,fade=t=in:st=2:d=0.7:alpha=1,setsar=1[cap2];` +
        `[v1][cap2]overlay=0:0[v]`,
      "-map", "[v]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-r", String(CLIP_FPS),
      "-t", String(CLIP_SECONDS),
      // Puts the moov atom first so the clip starts playing before it has
      // fully downloaded.
      "-movflags", "+faststart",
      outputPath,
    ]
    const proc = spawn(ffmpegPath as unknown as string, args)
    let stderr = ""
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`))
    })
  })
}

// Variety per press. The visual language stays fixed, so a second attempt
// changes the framing rather than the palette.
const FRAMINGS = [
  "Framing: one subject, close-up, filling the upper half.",
  "Framing: a wider scene with the subject small and atmospheric.",
  "Framing: an overhead / flat-lay arrangement of the subject's objects.",
  "Framing: an abstract, textural interpretation of the subject.",
]

/**
 * Background-only prompt. The "no text" instruction is repeated in three
 * different shapes on purpose — image models leak lettering into
 * backgrounds constantly, and one polite sentence does not hold. Anything
 * that slips through would sit UNDER our caption and read as a smudge.
 */
function buildBackgroundPrompt(
  direction: DesignDirection,
  framing: string,
  context: string,
): string {
  return [
    "Design a premium vertical 9:16 background image for a social video (full-bleed).",
    "",
    "ABSOLUTELY NO TEXT. No words, no letters, no numbers, no Hebrew or Latin characters, no captions, no watermarks, no logos, no signage, no UI chrome, no borders. If any surface in the scene would naturally carry writing, leave it blank.",
    "",
    ...direction.lines,
    "",
    framing,
    "- One clear subject drawn from the post's topic, rendered in the visual language above — never generic stock decoration.",
    "",
    // The caption lands in the lower-middle band, so that area has to stay
    // calm or the type sits on top of the busiest part of the picture.
    // The caption is WHITE, so even a light/pastel language needs a deeper
    // band there — in its own colours, not a generic black scrim.
    "- COMPOSITION: keep the lower-middle third calm and uncluttered, and deep enough in tone (a darker shade from the visual language's own palette) that WHITE caption text placed there afterwards reads clearly. Put the visual interest in the upper half.",
    "- The mood should relate to this post content (written in Hebrew): " +
      `"""${context}"""`,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Center-crop the model's 1024×1536 to an exact 1080×1920 — gpt-image-2 has
 * no documented native 9:16. `xMidYMid slice` is the SVG equivalent of CSS
 * object-fit:cover.
 */
function cropToCanvas(imageBase64: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTION_CANVAS_WIDTH}" height="${CAPTION_CANVAS_HEIGHT}" viewBox="0 0 ${CAPTION_CANVAS_WIDTH} ${CAPTION_CANVAS_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${CAPTION_CANVAS_WIDTH}" height="${CAPTION_CANVAS_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}

export async function POST(req: NextRequest) {
  const tmpFiles: string[] = []
  try {
    const { postId, variationIndex } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
    }
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id, hook_text, title, body")
      .eq("id", postId)
      .eq("user_id", user.id)
      .single()
    const post = postRow as {
      id: string
      hook_text: string | null
      title: string | null
      body: string | null
    } | null
    if (postErr || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { data: variantRow } = await supabase
      .from("format_variants")
      .select("body")
      .eq("core_post_id", postId)
      .eq("format", "b_roll")
      .maybeSingle()
    const variantBody = (variantRow as { body: string | null } | null)?.body

    // b-roll's script IS the hook (see api/core-posts/[id]/media), so the
    // caption is the hook alone unless the variant carries more.
    const hook =
      post.hook_text?.trim() ||
      post.title?.trim() ||
      variantBody?.split(/\n+/)[0]?.trim() ||
      ""
    if (!hook) {
      return NextResponse.json(
        {
          error: "no_hook",
          message: "אין טקסט כותרת לפוסט. הוסיפו הוק ואז נוכל לייצר בי-רול.",
        },
        { status: 400 },
      )
    }
    const rest = variantBody
      ?.split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.replace(/\s+/g, "") !== hook.replace(/\s+/g, ""))
      .join(" ")

    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "openai_not_connected") {
        return NextResponse.json(
          {
            error: "openai_not_connected",
            message:
              "כדי לייצר בי-רול צריך לחבר מפתח OpenAI בהגדרות.",
          },
          { status: 400 },
        )
      }
      throw e
    }

    // Her visual language (or the niche-derived one). No reference
    // elements: this is a text-free background and the caption is laid
    // over it afterwards, so a logo would collide with it.
    const direction = await resolveDesignDirection(supabase, user.id, {
      allowReferences: false,
    })
    const context = (post.body ?? variantBody ?? hook).slice(0, 600)

    const raw = await generateImage(
      openaiKey,
      buildBackgroundPrompt(
        direction,
        FRAMINGS[Math.abs(variationIndex ?? 0) % FRAMINGS.length],
        context,
      ),
    )
    const background = cropToCanvas(raw)
    // Background and caption stay SEPARATE files — that separation is what
    // lets ffmpeg drift one and fade the other.
    const captionPng = await renderCaptionOverlayPng(hook, rest || undefined)
    const secondaryPng = await renderSecondaryCaptionPng()

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const tmp = os.tmpdir()
    const stamp = crypto.randomUUID()
    const bgPath = path.join(tmp, `broll-bg-${stamp}.png`)
    const capPath = path.join(tmp, `broll-cap-${stamp}.png`)
    const cap2Path = path.join(tmp, `broll-cap2-${stamp}.png`)
    const outPath = path.join(tmp, `broll-${stamp}.mp4`)
    tmpFiles.push(bgPath, capPath, cap2Path, outPath)

    await fs.writeFile(bgPath, Buffer.from(background, "base64"))
    await fs.writeFile(capPath, captionPng)
    await fs.writeFile(cap2Path, secondaryPng)
    await renderClip(bgPath, capPath, cap2Path, outPath)
    const clip = await fs.readFile(outPath)

    // Store it and hand back the URL — the panel just renders what it gets.
    const storagePath = `${user.id}/b_roll/${stamp}.mp4`
    const { error: uploadError } = await supabase.storage
      .from("user-media")
      .upload(storagePath, clip, { contentType: "video/mp4" })
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }
    const publicUrl = supabase.storage
      .from("user-media")
      .getPublicUrl(storagePath).data.publicUrl

    // Auto-create the variant row: the user can generate a b-roll before the
    // post has been duplicated to that format.
    let { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", postId)
      .eq("format", "b_roll")
      .maybeSingle()
    if (!variant) {
      const { data: created } = await supabase
        .from("format_variants")
        .insert({ core_post_id: postId, format: "b_roll", body: "" } as never)
        .select("id")
        .single()
      variant = created
    }
    if (!variant) {
      return NextResponse.json(
        { error: "b_roll_variant_missing" },
        { status: 500 },
      )
    }
    const variantId = (variant as unknown as { id: string }).id

    // One b-roll per post, and it's a clip — clear BOTH slots so a generated
    // video can't sit alongside a stale still from an earlier run.
    await supabase
      .from("media_assets")
      .delete()
      .eq("format_variant_id", variantId)
      .in("asset_type", ["image", "video"])
    await supabase.from("media_assets").insert({
      format_variant_id: variantId,
      asset_type: "video",
      url: publicUrl,
      status: "completed",
    } as never)

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/generate-media]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    // Best-effort temp cleanup — never let it mask the real result.
    const fs = await import("fs/promises")
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)))
  }
}
