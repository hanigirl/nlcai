import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { parseImagePostBody, type ImagePostTexts } from "@/lib/image-post-text"
import { assertFeedSafeAspect } from "@/lib/social/media-spec"
import { generateImage } from "@/lib/openai-image"
import {
  noExtrasRule,
  pickComposition,
  resolveDesignDirection,
  type DesignDirection,
} from "@/lib/visual-language/direction"

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
 * gpt-image-2 has no documented native 4:5 size, so we generate the
 * closest portrait (1024×1536) and a thin Resvg pass center-crops it to
 * exactly 1080×1350. The prompt keeps all text in the central safe zone
 * so the crop never clips it.
 *
 * The route is pure: it returns a base64 PNG and does not persist
 * anything. The client reuses the existing upload path (Storage +
 * POST /api/core-posts/{id}/media) so persistence stays in one place.
 */

/**
 * Full-image prompt: the model designs the whole post, INCLUDING the
 * Hebrew text. We give it the exact lines (quoted, so it copies them
 * verbatim), a clear typographic hierarchy, RTL guidance, and a safe-zone
 * rule so the later center-crop to 4:5 never clips the text. The
 * `variationIndex` picks a distinct design direction so each regeneration
 * is visually different from the last.
 */
function buildImagePrompt(
  texts: ImagePostTexts,
  context: string,
  direction: DesignDirection,
  composition: string,
): string {
  const textLines = [
    `Headline (largest, boldest, dominant): "${texts.headline}"`,
    texts.subheadline
      ? `Sub-headline (medium, below the headline): "${texts.subheadline}"`
      : null,
    texts.bottom
      ? `Bottom line (smallest, near the lower area — a short CTA/closer): "${texts.bottom}"`
      : null,
  ]
    .filter(Boolean)
    .join("\n")

  return [
    "Design a complete, polished vertical (portrait) social media post image in HEBREW.",
    "",
    ...direction.lines,
    "",
    composition,
    "",
    "The image MUST contain exactly this Hebrew text, spelled EXACTLY as written, laid out right-to-left (RTL). Do not translate, transliterate, paraphrase, or add any other words:",
    textLines,
    "",
    "Rules that always hold (independent of the style above):",
    "- Strong visual hierarchy — the headline is clearly dominant.",
    "- Correct Hebrew letterforms and right-to-left reading order; reproduce every character precisely.",
    "- High legibility: strong contrast between text and background (use a clean area, scrim, or a solid shape behind the text if the style needs it).",
    "- Keep ALL text within the central 70% of the height, with generous top and bottom margins, so nothing is cut off near the edges.",
    "- The mood should still relate to this post content (written in Hebrew): " +
      `"""${context}"""`,
    "",
    `Do NOT add any text other than the exact lines above. ${noExtrasRule(direction)}`,
  ].join("\n")
}

/* ------------------------- normalize pass ------------------------ */

/**
 * Center-crop the model's 1024×1536 image to an exact 1080×1350 (4:5)
 * canvas — gpt-image-2 has no documented native 4:5 size. We wrap the PNG in a
 * minimal SVG and let Resvg rasterize it; `preserveAspectRatio="xMidYMid
 * slice"` is the SVG equivalent of CSS object-fit:cover, trimming ~8% off
 * the top and bottom (inside the prompt's safe zone, so text is kept).
 * No fonts / no text — this pass draws nothing of its own.
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
    const context = [post.title, post.hook_text, post.body?.slice(0, 600)]
      .filter(Boolean)
      .join("\n")
    const direction = await resolveDesignDirection(supabase, user.id, { format: "image_post" })
    const generatedBase64 = await generateImage(
      openaiKey,
      buildImagePrompt(texts, context, direction, pickComposition(variationIndex)),
      // Legible Hebrew glyphs are the whole point here, so we pay for "high".
      { quality: "high", references: direction.references },
    )

    // Center-crop the model's image to an exact 4:5 canvas via Resvg.
    const resvg = new Resvg(cropToCanvasSvg(generatedBase64))
    const png = Buffer.from(resvg.render().asPng()).toString("base64")

    return NextResponse.json({ image: png, texts })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[image-post/generate-media]", msg)
    return NextResponse.json({ error: `יצירת התמונה נכשלה: ${msg}` }, { status: 500 })
  }
}
