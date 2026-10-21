import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { CAPTION_CANVAS_HEIGHT, CAPTION_CANVAS_WIDTH } from "@/lib/caption-overlay"
import { getAuthUser } from "@/lib/auth-user"
import { buildCompositionBrief } from "@/lib/broll-animation/brief"
import { composeBRoll, finalizeHtml } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import { saveBRoll, uploadBackground } from "@/lib/broll-animation/store"
import { generateImage } from "@/lib/openai-image"
import { isMediaStyle } from "@/lib/visual-language/types"
import {
  resolveDesignDirection,
  type DesignDirection,
} from "@/lib/visual-language/direction"

// gpt-image-2 takes 30-120s for one image.
export const maxDuration = 300

/**
 * AI b-roll — a generated background with the hook ANIMATED over it by
 * Claude Opus (Hani, 2026-10-22). Replaces the static caption plate.
 *
 * Two models, two jobs, run in parallel:
 *   - the image model draws the background only (still told to put no text in
 *     it — lettering it invents would fight the real type);
 *   - Opus writes the motion design as HTML in her fonts and brand colours,
 *     with the hook and "קראו בתיאור" verbatim (lib/broll-animation/compose).
 * A headless browser then renders the HTML frame by frame into a 7s MP4
 * (lib/broll-animation/render). The HTML is stored next to the clip so
 * "עריכה עם AI" can revise it (api/b-roll/edit).
 */

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
    "- COMPOSITION: animated Hebrew headline type will be laid over the middle of the frame afterwards — leave a calm, uncluttered area there and put the visual interest around it.",
    "- The mood should relate to this post content (written in Hebrew): " +
      `"""${context}"""`,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Normalise the model's image to exactly 1080×1920. The model now paints the
 * exact ratio (lib/openai-image), so `xMidYMid slice` (CSS object-fit:cover)
 * only scales; it trims anything only if OpenAI refused the custom size and
 * we fell back to 1024×1536.
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
    const { postId, variationIndex, style } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
      style?: unknown
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
      format: "b_roll",
      allowReferences: false,
      style: isMediaStyle(style) ? style : undefined,
    })
    let anthropicKey: string
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "anthropic_not_connected") {
        return NextResponse.json(
          {
            error: "anthropic_not_connected",
            message: "כדי לייצר בי-רול צריך לחבר מפתח Claude בהגדרות.",
          },
          { status: 400 },
        )
      }
      throw e
    }

    const context = (post.body ?? variantBody ?? hook).slice(0, 600)
    const mediaStyle = isMediaStyle(style) ? style : undefined
    const brief = await buildCompositionBrief(
      supabase,
      user.id,
      { hook, rest: rest || undefined },
      direction.lines,
      mediaStyle,
    )

    // Background and motion design don't depend on each other — run both.
    const [raw, template] = await Promise.all([
      generateImage(
        openaiKey,
        buildBackgroundPrompt(
          direction,
          FRAMINGS[Math.abs(variationIndex ?? 0) % FRAMINGS.length],
          context,
        ),
        { shape: "9:16", references: direction.references },
      ),
      composeBRoll(anthropicKey, brief, Math.abs(variationIndex ?? 0)),
    ])
    const background = Buffer.from(cropToCanvas(raw), "base64")

    const stamp = crypto.randomUUID()
    const backgroundUrl = await uploadBackground(supabase, user.id, stamp, background)

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-${stamp}.mp4`)
    tmpFiles.push(outPath)
    await renderComposition(finalizeHtml(template, backgroundUrl, brief.fonts), outPath)
    const clip = await fs.readFile(outPath)

    const publicUrl = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      template,
      brief,
      backgroundUrl,
      edits: [],
    })

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/generate-media]", msg)
    const message =
      msg === "composition_invalid" || msg === "composition_not_seekable"
        ? "יצירת האנימציה לא הצליחה הפעם. נסו שוב."
        : undefined
    return NextResponse.json({ error: msg, message }, { status: 500 })
  } finally {
    // Best-effort temp cleanup — never let it mask the real result.
    const fs = await import("fs/promises")
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)))
  }
}
