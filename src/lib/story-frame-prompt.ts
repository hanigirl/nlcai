import { Resvg } from "@resvg/resvg-js"
import { KEEP_INSIDE_FRAME_RULE } from "@/lib/openai-image"
import { reservedZoneLines, type ImageRole } from "@/lib/visual-language/fixed-elements"
import { noExtrasRule, type DesignDirection } from "@/lib/visual-language/direction"

/**
 * One designed story frame: its prompt, its role and its canvas. Shared by
 * the generator (api/story/generate-media) and the story edit agent
 * (lib/edit-agent/story-agent), so a frame the agent redraws is made exactly
 * the way the story was.
 */

// Instagram Story — 9:16 vertical.
export const STORY_WIDTH = 1080
export const STORY_HEIGHT = 1920
const IMAGE_WIDTH = STORY_WIDTH
const IMAGE_HEIGHT = STORY_HEIGHT

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
export function frameRole(frameIndex: number, frameCount: number): ImageRole {
  if (frameCount === 1) return "single"
  if (frameIndex === 0) return "cover"
  return frameIndex === frameCount - 1 ? "closing" : "content"
}

export function buildStoryPrompt(
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
    KEEP_INSIDE_FRAME_RULE,
    ...reservedZoneLines(direction.fixed, frameRole(frameIndex, frameCount), IMAGE_WIDTH, IMAGE_HEIGHT),
    progress,
    context ? "- The mood should relate to this post content (written in Hebrew): " + `"""${context}"""` : "",
    "",
    `Do NOT add any text other than the exact Hebrew lines above (and the tiny frame indicator if requested). ${noExtrasRule(direction)}`,
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
export function cropStoryToCanvas(imageBase64: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}

