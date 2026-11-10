import { KEEP_INSIDE_FRAME_RULE } from "@/lib/openai-image"
import { reservedZoneLines } from "@/lib/visual-language/fixed-elements"
import { noExtrasRule, type DesignDirection } from "@/lib/visual-language/direction"
import type { ImagePostTexts } from "@/lib/image-post-text"

/**
 * The image post's prompt and canvas. Shared by the generator
 * (api/image-post/generate-media) and the edit agent (lib/edit-agent/
 * story-agent), so a post the agent redraws is made exactly the way it was.
 */

// Instagram feed image post — 4:5 portrait.
export const IMAGE_POST_WIDTH = 1080
export const IMAGE_POST_HEIGHT = 1350
const IMAGE_WIDTH = IMAGE_POST_WIDTH
const IMAGE_HEIGHT = IMAGE_POST_HEIGHT

/**
 * Full-image prompt: the model designs the whole post, INCLUDING the
 * Hebrew text. We give it the exact lines (quoted, so it copies them
 * verbatim), a clear typographic hierarchy, RTL guidance, and a rule that
 * nothing touches the edge.
 *
 * The LOOK is the user's visual language (or one derived from her niche —
 * see lib/visual-language/direction). Regenerating keeps that language and
 * rotates only the composition.
 */
export function buildImagePostPrompt(
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
    KEEP_INSIDE_FRAME_RULE,
    ...reservedZoneLines(direction.fixed, "single", IMAGE_WIDTH, IMAGE_HEIGHT),
    // No context = nothing but the lines above to draw from (the fixed path).
    ...(context ? ["- The mood should still relate to this post content (written in Hebrew): " + `"""${context}"""`] : []),
    "",
    `Do NOT add any text other than the exact lines above. ${noExtrasRule(direction)}`,
  ].join("\n")
}

