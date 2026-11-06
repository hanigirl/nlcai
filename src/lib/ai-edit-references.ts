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
 * the chat's visual memory distils from them (lib/style-memory).
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

/**
 * The carousel's slide slots (Hani, 2026-11-06: "יש לי עכשיו 3 שקופיות ואני
 * רוצה להמשיך לסדר את ה 6"): up to a carousel's maximum, one picture per
 * slide. The 3 above is a request-size cap (every picture rides in the body
 * as a data URL, under Vercel's 4.5MB) — slot pictures are uploaded to her
 * storage first and sent as URLs, so they don't count against it.
 */
export const MAX_SLOT_REFERENCES = 10

/**
 * References that may be HER storage URLs (slot pictures) as well as data
 * URLs: each URL is fetched here and turned into a data URL, so every model
 * call and `referenceBuffer` work unchanged. Only her own folder of our
 * storage — anything else is dropped.
 */
export async function resolveReferences(raw: unknown, userId: string, max = MAX_SLOT_REFERENCES): Promise<string[]> {
  if (!Array.isArray(raw)) return []
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const prefix = base ? `${new URL(base).origin}/storage/v1/object/public/user-media/${userId}/` : null
  const out = await Promise.all(
    raw.slice(0, max).map(async (r): Promise<string | null> => {
      if (typeof r !== "string") return null
      if (DATA_URL.test(r)) return r.length <= MAX_DATA_URL_CHARS ? r : null
      if (!prefix || !r.startsWith(prefix)) return null
      try {
        const res = await fetch(r)
        if (!res.ok) return null
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim()
        if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return null
        const b64 = Buffer.from(await res.arrayBuffer()).toString("base64")
        return `data:${type};base64,${b64}`
      } catch {
        return null
      }
    }),
  )
  return out.filter((x): x is string => !!x)
}

function imageBlock(r: string): Anthropic.ContentBlockParam {
  const [, mediaType, data] = r.match(DATA_URL)!
  return { type: "image", source: { type: "base64", media_type: mediaType as MediaType, data } }
}

/** The attached image's own bytes — for placing HER file as-is, never a redraw. */
export function referenceBuffer(r: string): Buffer {
  return Buffer.from(r.match(DATA_URL)![2], "base64")
}

/**
 * Claude content blocks: the images, then a line saying what they are.
 *
 * `placeable`: the edit can put an attached image INTO the design (Hani,
 * 2026-11-05 — "לשלב את התמונה הזו בקאבר" got her character redrawn from a
 * description instead of using her file). The images are then numbered, and
 * Claude decides per image whether it is content to place or a look to match.
 */
export function referenceBlocks(refs: string[], opts: { placeable?: boolean } = {}): Anthropic.ContentBlockParam[] {
  if (!refs.length) return []
  if (opts.placeable) {
    return [
      ...refs.flatMap((r, i): Anthropic.ContentBlockParam[] => [
        { type: "text", text: `Attached image ${i + 1}:` },
        imageBlock(r),
      ]),
      {
        type: "text",
        text: `Above ${refs.length === 1 ? "is 1 image" : `are ${refs.length} images`} she attached to this request (numbered "Attached image 1..${refs.length}"). Each one is EITHER her own content to put into the design as it is — her character, photo, illustration, logo or product, when she says to place / add / use / integrate it (e.g. "תשימי את התמונה הזו", "לשלב את התמונה", "תוסיפי את הדמות הזו") — OR a reference for the look she wants (e.g. "שיהיה כמו זה", "בסגנון הזה"). Decide from her words. Content she wants placed is used as her exact file — never redrawn, re-imagined or described into a new picture.`,
      },
    ]
  }
  const images = refs.map(imageBlock)
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
