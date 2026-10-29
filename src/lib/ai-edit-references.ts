import type Anthropic from "@anthropic-ai/sdk"

/**
 * Reference images for "עריכה עם AI" on a format (Hani, 2026-10-29): a
 * screenshot or picture she attaches to show what she means — "הכתוביות
 * שייראו ככה". Every format's AI edit panel (copy and media) can attach them;
 * the core post chat does not.
 *
 * They travel as data URLs (the client shrinks them to JPEG first, see
 * components/ai-edit-reference.tsx) and reach Claude as image blocks next to
 * her instruction. Nothing is stored; what lasts is the style rule
 * learnFromInstruction distils from the instruction + the image.
 */

export const MAX_REFERENCES = 3

/** What a message with only references (no text) asks for. */
export const REFERENCE_ONLY_INSTRUCTION = "שיהיה כמו ברפרנס שצירפתי"
/** Per image, after the client shrinks it. Keeps 3 under Vercel's 4.5MB body. */
const MAX_DATA_URL_CHARS = 1_400_000

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/

type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif"

/** The valid ones, capped — anything else in the request body is dropped. */
export function parseReferences(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is string => typeof r === "string" && r.length <= MAX_DATA_URL_CHARS && DATA_URL.test(r))
    .slice(0, MAX_REFERENCES)
}

/** Claude content blocks: the images, then a line saying what they are. */
export function referenceBlocks(refs: string[]): Anthropic.ContentBlockParam[] {
  if (!refs.length) return []
  const images = refs.map((r): Anthropic.ContentBlockParam => {
    const [, mediaType, data] = r.match(DATA_URL)!
    return { type: "image", source: { type: "base64", media_type: mediaType as MediaType, data } }
  })
  return [
    ...images,
    {
      type: "text",
      text:
        refs.length === 1
          ? "The image above is a REFERENCE she attached to show what she wants (a screenshot or an example). It is not her post. Use it to understand her request: match the look, structure or tone she points at."
          : `The ${refs.length} images above are REFERENCES she attached to show what she wants (screenshots or examples). They are not her post. Use them to understand her request: match the look, structure or tone she points at.`,
    },
  ]
}
