import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  desiredFrameCount,
  splitScriptIntoFrames,
} from "@/lib/story-text-split"
import { getAuthUser } from "@/lib/auth-user"
import { generateImage } from "@/lib/openai-image"
import {
  noExtrasRule,
  pickComposition,
  resolveDesignDirection,
  type DesignDirection,
} from "@/lib/visual-language/direction"

// gpt-image-2 takes 30-120s per image; a long story fans out to up to 3
// frames run with limited concurrency, so leave generous headroom.
export const maxDuration = 300

// Instagram Story — 9:16 vertical.
const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 1920

// Parallel OpenAI image calls per story (rate-limit friendly).
const CONCURRENCY = 3

/**
 * AI "media-to-story" generation — gpt-image-2 (BYOK — users.openai_api_key)
 * renders each story frame as a COMPLETE designed 9:16 image, with the
 * Hebrew script baked into the composition (designed typography AND correct
 * spelling), following one shared design language so multi-frame stories
 * read as a single set. Same model + crop approach as
 * image-post/generate-media and carousel/generate-ai.
 *
 * The route is pure: it returns base64 PNGs (plus the frame count) and does
 * NOT persist anything. The client persists the chosen set via
 * PATCH /api/core-posts/{id} { storyImages } — the carousel-style
 * multi-image path — so persistence stays in one place.
 */

/**
 * Split the story body into designed frames.
 *
 * The split itself lives in `lib/story-text-split` so the Drive-import path
 * burns captions on exactly the same boundaries (Hani, 2026-07-29). Here we
 * still CHOOSE the frame count from the script's length — the AI path owns
 * that decision, whereas the import path is told the count by how many links
 * the user pasted.
 */
function splitStoryIntoFrames(body: string): string[] {
  return splitScriptIntoFrames(body, desiredFrameCount(body))
}


/**
 * Full-image prompt for one story frame. The LOOK comes from the user's
 * visual language (Settings → Media), or — without one — from a language
 * derived from her niche (see lib/visual-language/direction). The same
 * direction + composition go to every frame of one generation, so a
 * multi-frame story reads as one set. Story-specific: 9:16 full-bleed and
 * the Instagram Story safe zone.
 *
 * `frameIndex`/`frameCount` steer the per-frame role and a subtle progress
 * indicator; `composition` rotates per regenerate; `context` anchors the
 * imagery and mood to the post.
 */
function buildStoryPrompt(
  frameText: string,
  frameIndex: number,
  frameCount: number,
  direction: DesignDirection,
  composition: string,
  context: string,
): string {
  const role =
    frameCount === 1
      ? "This single frame carries the whole story — hook, message, and call-to-action — in a clear top-to-bottom hierarchy, the hook most dominant."
      : frameIndex === 0
        ? "This is the opening frame — the hook dominates and the visual is at its most striking, pulling the viewer in."
        : frameIndex === frameCount - 1
          ? "This is the closing frame — it lands the message and the call-to-action, warm and decisive."
          : `This is frame ${frameIndex + 1} of ${frameCount} — it carries the story forward.`

  const progress =
    frameCount > 1
      ? `- A small, subtle frame indicator "${frameIndex + 1}/${frameCount}" in a top corner, matching the palette (unobtrusive).`
      : null

  return [
    "Design a complete, polished vertical Instagram STORY image (9:16, full-bleed) in HEBREW.",
    "",
    "The frame contains exactly this Hebrew text, spelled EXACTLY as written, laid out right-to-left (RTL), and no other words. Do not translate, transliterate, paraphrase, reorder, or add anything:",
    `"""${frameText}"""`,
    "",
    role,
    "",
    "Design (IDENTICAL across every frame of this story — same canvas, palette, imagery style and type treatment):",
    ...direction.lines,
    "",
    composition,
    "- The imagery makes THIS frame's message visible — drawn from the post's subject and rendered in the visual language above, never generic stock decoration. Imagery and text share the composition without crowding each other.",
    "- Typography: Hebrew type with a clear hierarchy INSIDE the text — the single most important word or phrase is emphasised in the way the visual language describes; the rest stays clean and highly readable.",
    "",
    "Rules that always hold:",
    "- Correct Hebrew letterforms and right-to-left reading order; reproduce every character precisely.",
    "- High legibility: strong contrast between text and background.",
    "- INSTAGRAM STORY SAFE ZONE: keep ALL text and key elements within the central 62% of the height — leave a generous empty margin in the TOP ~14% and BOTTOM ~24% so the profile header and the reply bar never cover the text.",
    progress,
    "- The mood should relate to this post content (written in Hebrew): " +
      `"""${context}"""`,
    "",
    `Do NOT add any text other than the exact Hebrew lines above (and the tiny frame indicator if requested). ${noExtrasRule(direction)}`,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Center-crop the model's 1024×1536 image to an exact 1080×1920 (9:16)
 * canvas — gpt-image-2 has no documented native 9:16 size.
 * `preserveAspectRatio="xMidYMid slice"` is the SVG equivalent of CSS
 * object-fit:cover, trimming ~8% off each side (inside the prompt's safe
 * zone, so the centered text is kept). No fonts / no text in this pass.
 */
function cropToCanvas(imageBase64: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
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
    const post = postRow as {
      id: string
      title: string | null
      hook_text: string | null
      body: string | null
    } | null
    if (postErr || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // The text that appears ON the frames comes from the story variant —
    // server-authoritative, not echoed from the client.
    const { data: variantRow, error: variantErr } = await supabase
      .from("format_variants")
      .select("body")
      .eq("core_post_id", postId)
      .eq("format", "story")
      .single()
    const variant = variantRow as { body: string | null } | null
    if (variantErr || !variant?.body?.trim()) {
      return NextResponse.json(
        {
          error: "no_story_variant",
          message:
            "לפוסט הזה אין עדיין טקסט לפורמט סטורי. צרו קודם את הפורמט ואז אפשר לייצר ממנו סטורי.",
        },
        { status: 400 },
      )
    }

    const frames = splitStoryIntoFrames(variant.body)
    if (frames.length === 0) {
      return NextResponse.json(
        {
          error: "empty_story_text",
          message: "הטקסט של פורמט הסטורי ריק. מלאו אותו ונסו שוב.",
        },
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
          {
            error: "openai_not_connected",
            message:
              "כדי לייצר סטורי עם AI צריך לחבר מפתח OpenAI בהגדרות ← חיבורים ← OpenAI.",
          },
          { status: 402 },
        )
      }
      throw err
    }

    // The look: her visual language, else one derived from her niche.
    // Resolved once so every frame shares it; regenerate rotates only the
    // composition.
    const direction = await resolveDesignDirection(supabase, user.id, { format: "story" })
    const composition = pickComposition(variationIndex)

    // Theme context: title + hook carry the essence; the body is truncated
    // so a long post doesn't drown the composition instructions.
    const context = [post.title, post.hook_text, post.body?.slice(0, 500)]
      .filter(Boolean)
      .join("\n")

    const total = frames.length
    const images: string[] = new Array(total)

    // Simple concurrency pool — kinder to OpenAI rate limits than firing
    // all frames at once, much faster than fully sequential.
    let next = 0
    async function worker() {
      while (next < total) {
        const i = next++
        const prompt = buildStoryPrompt(
          frames[i],
          i,
          total,
          direction,
          composition,
          context,
        )
        const raw = await generateImage(openaiKey, prompt, {
          // gpt-image-2 — legible Hebrew glyphs are the whole point, so we
          // pay for "high" (same reasoning as image-post/generate-media).
          quality: "high",
          references: direction.references,
        })
        images[i] = cropToCanvas(raw)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    )

    return NextResponse.json({ images, frameCount: total })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[story/generate-media]", msg)
    return NextResponse.json(
      { error: `יצירת הסטורי נכשלה: ${msg}` },
      { status: 500 },
    )
  }
}
