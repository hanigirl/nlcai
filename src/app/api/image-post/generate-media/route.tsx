import { BLANK_NEEDS_BRIEF, PLACE_FAILED_GEN, normalizeMediaBrief, withMediaBrief, withMediaReferences, withPlacedImages } from "@/lib/media-brief"
import { withGraphicOnly } from "@/lib/visual-language/graphic-only"
import { canOwnMediaText, gatePlacement, PICTURE_IS_BACKGROUND, refusesPlacingIntoDesign } from "@/lib/feature-access"
import { picturesPlaced, placedImages } from "@/lib/placed-check"
import { parseReferences } from "@/lib/ai-edit-references"
import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { parseImagePostBody } from "@/lib/image-post-text"
import { buildImagePostPrompt } from "@/lib/image-post-prompt"
import { assertFeedSafeAspect } from "@/lib/social/media-spec"
import { generateImage } from "@/lib/openai-image"
import { applyFixedElements } from "@/lib/visual-language/fixed-elements"
import { isMediaStyle } from "@/lib/visual-language/types"
import { pickComposition, resolveDesignDirection } from "@/lib/visual-language/direction"

// gpt-image-2 generation can take 60-120s; leave headroom for the normalize pass.
export const maxDuration = 300

// Instagram feed image post — 4:5 portrait, which is the TALLEST shape the
// feed accepts (the rule is 4:5 to 1.91:1). Asserted rather than trusted, so
// this pair can never drift to 9:16 without the generator saying so.
const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 1350
assertFeedSafeAspect(IMAGE_WIDTH, IMAGE_HEIGHT, "פוסט תמונה")

/**
 * AI media generation for the `image_post` format.
 *
 * gpt-image-2 (BYOK — users.openai_api_key) renders the FULL image,
 * including the post's headline / sub-headline / bottom text, so the
 * typography is designed by the model rather than flatly overlaid in
 * code. The exact text comes from the image_post format_variant
 * (server-authoritative — never echoed from the client).
 *
 * Why gpt-image-2: gpt-image-1 garbled Hebrew letterforms/spelling.
 * gpt-image-2 (Apr 2026) has ~99% character-level text accuracy across
 * scripts, so baking the Hebrew text into the model output is now viable
 * — designed typography AND correct spelling. Still worth a human glance.
 *
 * gpt-image-2 paints the exact 4:5 ratio (see lib/openai-image) and a thin
 * Resvg pass scales it to exactly 1080×1350 — no trimming, so corner
 * elements arrive whole.
 *
 * The route is pure: it returns a base64 PNG and does not persist
 * anything. The client reuses the existing upload path (Storage +
 * POST /api/core-posts/{id}/media) so persistence stays in one place.
 */

/* ------------------------- normalize pass ------------------------ */

/**
 * Normalise the model's image to exactly 1080×1350. The model now paints the
 * exact ratio (lib/openai-image), so `xMidYMid slice` (CSS object-fit:cover)
 * only scales; it trims anything only if OpenAI refused the custom size and
 * we fell back to 1024×1536.
 */
function cropToCanvasSvg(imageBase64: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  )
}

export async function POST(req: NextRequest) {
  try {
    const { postId, variationIndex, style, brief, references, place } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
      style?: unknown
      /** Her own direction for this piece (lib/media-brief). */
      brief?: unknown
      /** Look references (a picture pulled from a link) — lib/ai-edit-references. */
      references?: unknown
      /** Pictures she attached to put INTO the image as they are (lib/media-brief withPlacedImages). */
      place?: unknown
    }
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }
    if (style === "blank" && !normalizeMediaBrief(brief)) {
      return NextResponse.json(BLANK_NEEDS_BRIEF, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Ownership + theme context in one fetch.
    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id, title, hook_text, body")
      .eq("id", postId)
      .eq("user_id", user.id)
      .single()
    const post = postRow as { id: string; title: string | null; hook_text: string | null; body: string | null } | null
    if (postErr || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // The text that appears ON the image comes from the image_post
    // variant — server-authoritative, not echoed from the client.
    const { data: variantRow, error: variantErr } = await supabase
      .from("format_variants")
      .select("body")
      .eq("core_post_id", postId)
      .eq("format", "image_post")
      .single()
    const variant = variantRow as { body: string | null } | null
    if (variantErr || !variant?.body) {
      return NextResponse.json(
        { error: "no_image_post_variant", message: "לפוסט הזה אין עדיין טקסט לפורמט פוסט תמונה. צרו קודם את הפורמט." },
        { status: 400 },
      )
    }

    const texts = parseImagePostBody(variant.body)
    if (!texts) {
      return NextResponse.json(
        { error: "empty_image_post_text", message: "הטקסט של פורמט התמונה ריק. מלאו אותו ונסו שוב." },
        { status: 400 },
      )
    }

    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "openai_not_connected") {
        return NextResponse.json(
          { error: "openai_not_connected", message: "כדי לייצר תמונות עם AI צריך לחבר מפתח OpenAI בהגדרות ← חיבורים ← OpenAI." },
          { status: 402 },
        )
      }
      throw err
    }

    // Theme context: title + hook carry the essence; the body is truncated
    // so a long post doesn't drown the composition instructions.
    // Fixed path (Hani only, lib/feature-access canOwnMediaText): no title or
    // hook in the prompt at all — a quoted hook is words the model can draw,
    // and the only words on the image are the script's (lib/script-text).
    const context = (
      canOwnMediaText(user.email)
        ? // Not even the core post (Hani, 2026-11-09): given "for the mood", the
          // image model drew its whole text onto the picture.
          []
        : [post.title, post.hook_text, post.body?.slice(0, 600)]
    )
      .filter(Boolean)
      .join("\n")
    // Her own pictures go in as they are; a link's picture is a look only.
    // Placing is Hani-only for now (lib/feature-access); off it, all are looks.
    if (refusesPlacingIntoDesign(user.email, parseReferences(place))) {
      return NextResponse.json(PICTURE_IS_BACKGROUND, { status: 409 })
    }
    const gated = gatePlacement(user.email, parseReferences(place), parseReferences(references))
    const placed = await placedImages(gated.place)
    const direction = withMediaReferences(
      withPlacedImages(
        withMediaBrief(
          // Her language makes graphics only, never a photo (gated).
          withGraphicOnly(
            await resolveDesignDirection(supabase, user.id, {
              format: "image_post",
              style: isMediaStyle(style) ? style : undefined,
            }),
            user.email,
          ),
          normalizeMediaBrief(brief),
        ),
        placed,
      ),
      gated.looks,
    )
    const generatedBase64 = await generateImage(
      openaiKey,
      buildImagePostPrompt(texts, context, direction, pickComposition(variationIndex)),
      // Legible Hebrew glyphs are the whole point here, so we pay for "high".
      { shape: "4:5", quality: "high", references: direction.references, strict: placed.length > 0 },
    )
    // Her picture must really be in it — a look-alike or a miss is not kept.
    if (placed.length) {
      const claudeKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => null)
      if ((await picturesPlaced(claudeKey, placed, generatedBase64)) === false) {
        return NextResponse.json(PLACE_FAILED_GEN, { status: 422 })
      }
    }

    // Center-crop the model's image to an exact 4:5 canvas via Resvg.
    const resvg = new Resvg(cropToCanvasSvg(generatedBase64))
    const png = await applyFixedElements(
      Buffer.from(resvg.render().asPng()).toString("base64"),
      direction.fixed,
      "single",
    )

    return NextResponse.json({ image: png, texts })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[image-post/generate-media]", msg)
    return NextResponse.json({ error: `יצירת התמונה נכשלה: ${msg}` }, { status: 500 })
  }
}
