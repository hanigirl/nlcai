import { Resvg } from "@resvg/resvg-js"
import { CAPTION_CANVAS_HEIGHT, CAPTION_CANVAS_WIDTH } from "@/lib/caption-overlay"
import type { DesignDirection } from "@/lib/visual-language/direction"

/**
 * The text-free 9:16 background the Opus animation is laid over. Shared by
 * the AI b-roll (api/b-roll/generate-media) and the animated frame added to
 * her own story (api/media/own-edit, Hani 2026-10-29) — one look for both.
 */

// Variety per press. The visual language stays fixed, so a second attempt
// changes the framing rather than the palette.
export const BACKGROUND_FRAMINGS = [
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
export function buildBackgroundPrompt(
  direction: DesignDirection,
  framing: string,
  context: string,
  extraLines: string[] = [],
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
    "- COMPOSITION: animated Hebrew headline type will be laid over the middle of the frame afterwards — leave a calm, uncluttered area there and put the visual interest around it.",
    ...extraLines,
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
export function cropToCanvas(imageBase64: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTION_CANVAS_WIDTH}" height="${CAPTION_CANVAS_HEIGHT}" viewBox="0 0 ${CAPTION_CANVAS_WIDTH} ${CAPTION_CANVAS_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${CAPTION_CANVAS_WIDTH}" height="${CAPTION_CANVAS_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}
