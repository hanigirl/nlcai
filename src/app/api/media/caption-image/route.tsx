import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { frameCaption } from "@/lib/story-text-split"
import { parseTextToSlides } from "@/lib/carousel-slides"
import { parseImagePostBody } from "@/lib/image-post-text"
import { BROLL_VIDEO_CTA } from "@/lib/broll-copy"
import {
  CANVAS_4_5,
  CANVAS_9_16,
  renderCaptionOverImagePng,
  type CaptionPosition,
} from "@/lib/caption-overlay"
import { getAuthUser } from "@/lib/auth-user"

// One satori render + one Resvg rasterize. No model call, no ffmpeg — this
// is seconds, not minutes, but a 50MB source still has to be pulled first.
export const maxDuration = 120

/**
 * Burn the post's caption onto a STILL the user brought themselves.
 *
 * The gap this closes (Hani, 2026-08-13): every other media surface already
 * lays the post's words over the picture — the AI image post has gpt-image-2
 * design them in, the story burns them onto each imported frame, the b-roll
 * burns them onto the user's clip. The one path that produced a bare,
 * wordless asset was the one people actually use most: uploading your own
 * image. So the same post looked finished when the AI made the picture and
 * unfinished when you brought your own.
 *
 * This is the still-image sibling of `story/generate-video-media`: same
 * caption renderer, same "attaching IS the instruction to caption it"
 * contract, no ffmpeg because there is no timeline to composite against.
 *
 * WHICH text goes on depends on the format, and deliberately so:
 *   - image_post → the image_post variant's own headline / sub-headline,
 *     i.e. exactly the lines gpt-image-2 would have drawn. A feed image that
 *     says something different from its AI counterpart is a bug, not a
 *     variation.
 *   - b_roll / story → the hook plus this frame's slice of the script, which
 *     is what the video path burns in.
 *
 * The caption always carries the post's FULL text (Hani, 2026-08-13): the
 * hook plus the body. There is no headline-only mode — the words on the
 * picture have to match the words in the post.
 */

type CaptionFormat = "image_post" | "b_roll" | "story" | "carousel"

const CANVAS_FOR: Record<CaptionFormat, typeof CANVAS_4_5> = {
  image_post: CANVAS_4_5,
  b_roll: CANVAS_9_16,
  story: CANVAS_9_16,
  // The carousel renders at 1080x1350, the same portrait frame as a feed
  // image post, so a slide the user brought gets the same safe zone.
  carousel: CANVAS_4_5,
}

function isPosition(v: unknown): v is CaptionPosition {
  return v === "top" || v === "center" || v === "bottom"
}

/** Pull an image (storage URL or Drive share link) down as base64. */
async function fetchImageBase64(
  url: string,
): Promise<{ base64: string } | { error: string; message?: string }> {
  const res = isDriveUrl(url)
    ? await fetchDriveFile(extractDriveFileId(url)!)
    : await fetch(url)
  const contentType = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
  if (!res.ok) {
    return { error: `לא הצלחנו לטעון את התמונה (${res.status})` }
  }
  // Drive answers a revoked file with a 200 HTML page, so the status alone
  // would hand the renderer a web page to draw.
  if (contentType.includes("text/html")) {
    return {
      error: "drive_not_public",
      message:
        'התמונה בדרייב כבר לא משותפת. שנו את ההרשאה ל„כל מי שיש לו הקישור” ונסו שוב.',
    }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return { base64: buf.toString("base64") }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      postId?: string
      format?: string
      sourceUrl?: string
      position?: string
      persist?: boolean
      /**
       * Carousel only. The slides arrive as bytes rather than a URL — the
       * import already pulled them out of Drive — and each one takes its own
       * slide's words, so the caller says which slide this is.
       */
      imageBase64?: string
      slideIndex?: number
    }

    const format: CaptionFormat =
      body.format === "b_roll"
        ? "b_roll"
        : body.format === "story"
          ? "story"
          : body.format === "carousel"
            ? "carousel"
            : "image_post"
    const canvas = CANVAS_FOR[format]
    const position: CaptionPosition = isPosition(body.position)
      ? body.position
      : format === "image_post"
        ? "bottom"
        : "bottom"
    /* ---------------------------- real mode ----------------------------- */
    const postId = body.postId
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }
    const persist = body.persist !== false

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Ownership + the fallback headline, in one fetch.
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
          error: "no_variant",
          message: "צרו קודם את הפורמט הזה לפוסט.",
        },
        { status: 400 },
      )
    }

    // Carousel slides arrive as bytes — the Drive import already pulled them
    // down, so re-fetching by URL would be a second round trip for something
    // the caller is holding.
    const inlineBase64 =
      format === "carousel" ? body.imageBase64?.trim() || undefined : undefined

    // The image to caption: an explicit source wins, otherwise the format's
    // stored image slot.
    let sourceUrl = body.sourceUrl?.trim() || undefined
    if (!sourceUrl && !inlineBase64) {
      const { data: assetRow } = await supabase
        .from("media_assets")
        .select("url")
        .eq("format_variant_id", variant.id)
        .eq("asset_type", "image")
        .maybeSingle()
      sourceUrl = (assetRow as { url: string } | null)?.url
    }
    if (!sourceUrl && !inlineBase64) {
      return NextResponse.json(
        {
          error: "no_source_image",
          message:
            "לא נמצאה תמונה. העלו תמונה או משכו אחת מגוגל דרייב, ואז נטמיע בה את הכיתוב.",
        },
        { status: 400 },
      )
    }

    /* ------------------------- what the caption says ------------------- */
    let overlayHook: string | undefined
    let overlayBody: string | undefined

    if (format === "carousel") {
      // A slide carries its own title and body — the same split the panel
      // shows, so the words burned into the picture are the words the user
      // read next to it.
      const slides = variant.body ? parseTextToSlides(variant.body) : []
      const slide = slides[body.slideIndex ?? 0]
      overlayHook = slide?.title?.trim() || undefined
      overlayBody = slide?.body?.trim() || undefined
      // A cover slide with no body still needs its headline; falling back to
      // the post's hook keeps slide 1 from coming out bare.
      if (!overlayHook && !overlayBody) {
        overlayHook = post.hook_text?.trim() || post.title?.trim() || undefined
      }
    } else if (format === "image_post") {
      // The lines gpt-image-2 would have drawn — same post, same words,
      // whichever way the picture was made.
      const texts = variant.body ? parseImagePostBody(variant.body) : null
      overlayHook =
        texts?.headline?.trim() ||
        post.hook_text?.trim() ||
        post.title?.trim() ||
        undefined
      overlayBody =
        [texts?.subheadline, texts?.bottom]
          .filter((v) => !!v?.trim())
          .join("\n")
          .trim() || undefined
    } else {
      const hook =
        post.hook_text?.trim() ||
        post.title?.trim() ||
        variant.body?.split(/\n+/)[0]?.trim() ||
        ""
      const caption = variant.body?.trim()
        ? frameCaption(variant.body, 0, 1)
        : { headline: hook, body: undefined as string | undefined }
      overlayHook = caption.headline ?? hook
      overlayBody = caption.body
      // Every b-roll carries the follow-up line. On a clip it arrives on its
      // own beat as a second layer; a still has no timeline, so it joins the
      // body block instead of being dropped.
      if (format === "b_roll") {
        overlayBody = [overlayBody, BROLL_VIDEO_CTA].filter(Boolean).join("\n")
      }
    }

    if (!overlayHook && !overlayBody) {
      return NextResponse.json(
        {
          error: "no_caption_text",
          message: "אין טקסט לפוסט הזה, אז אין מה להטמיע בתמונה.",
        },
        { status: 400 },
      )
    }

    /* ----------------------------- render ------------------------------ */
    let sourceBase64: string
    if (inlineBase64) {
      sourceBase64 = inlineBase64
    } else {
      const src = await fetchImageBase64(sourceUrl!)
      if ("error" in src) {
        return NextResponse.json(src, { status: 400 })
      }
      sourceBase64 = src.base64
    }

    const png = await renderCaptionOverImagePng(
      sourceBase64,
      overlayHook,
      overlayBody,
      canvas,
      position,
    )

    // A carousel slide goes back as bytes: the panel holds the whole set and
    // saves it in one go, exactly as it does for an uncaptioned import.
    // Uploading each slide here would leave orphans behind every re-import,
    // and deleting the format's image asset — what the single-image path does
    // below — would wipe the other slides.
    if (format === "carousel") {
      return NextResponse.json({ image: png.toString("base64") })
    }

    // "captioned-" marks a text-baked output, the same way "burned-" does for
    // video. The client reads it off the URL to know an image already carries
    // its caption, so re-opening the panel can't stack a second one on top.
    const storagePath = `${user.id}/image/captioned-${crypto.randomUUID()}.png`
    const { error: uploadError } = await supabase.storage
      .from("user-media")
      .upload(storagePath, png, { contentType: "image/png" })
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }
    const publicUrl = supabase.storage
      .from("user-media")
      .getPublicUrl(storagePath).data.publicUrl

    if (persist) {
      await supabase
        .from("media_assets")
        .delete()
        .eq("format_variant_id", variant.id)
        .eq("asset_type", "image")
      await supabase.from("media_assets").insert({
        format_variant_id: variant.id,
        asset_type: "image",
        url: publicUrl,
        status: "completed",
      } as never)
    }

    // The ORIGINAL comes back too: both variants let the user fall back to
    // the picture they brought, and neither can offer that if the only URL
    // we hand back is the captioned one.
    return NextResponse.json({ url: publicUrl, originalUrl: sourceUrl })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[media/caption-image]", msg)
    return NextResponse.json(
      { error: `הטמעת הכיתוב בתמונה נכשלה: ${msg}` },
      { status: 500 },
    )
  }
}
