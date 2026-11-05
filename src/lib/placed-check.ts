import Anthropic from "@anthropic-ai/sdk"
import { normaliseImage, type ModelImage } from "@/lib/visual-language/image-input"

/**
 * Did the generation really put her picture in? (Hani, 2026-11-05 — "התמונה
 * תכנס ביצירה הראשונה"). The image model was handed her file and told to
 * reproduce it; it can still leave it out, or paint a look-alike — the very
 * "invented substitute" she has been burned by. One look by Claude, comparing
 * her picture with the result, decides whether the result is kept.
 *
 * Returns true / false, or null when it couldn't tell (no Claude key, model
 * error) — then the caller keeps the result and the check is skipped, never
 * turned into a false failure.
 */
export async function picturesPlaced(
  apiKey: string | null,
  placed: ModelImage[],
  resultBase64: string,
): Promise<boolean | null> {
  if (!apiKey || !placed.length) return null
  try {
    const result = await normaliseImage(Buffer.from(resultBase64, "base64"))
    const block = (img: ModelImage): Anthropic.ContentBlockParam => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    })
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 5,
      messages: [
        {
          role: "user",
          content: [
            ...placed.flatMap((img, i): Anthropic.ContentBlockParam[] => [
              { type: "text", text: `Her picture ${i + 1}:` },
              block(img),
            ]),
            { type: "text", text: "The finished design:" },
            block(result),
            {
              type: "text",
              text:
                `Does the finished design contain ${placed.length > 1 ? "EVERY one of her pictures" : "her picture"} — the SAME photo, character, illustration, logo or product, recognisably the same subject with the same details (it may be resized, framed, masked or have its background removed)? ` +
                "A different person, a redrawn or re-imagined look-alike, or a picture that is missing all count as NO. Answer only YES or NO.",
            },
          ],
        },
      ],
    })
    const answer = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .toUpperCase()
    if (answer.startsWith("YES")) return true
    if (answer.startsWith("NO")) return false
    return null
  } catch (err) {
    console.error("[placed-check]", err instanceof Error ? err.message : err)
    return null
  }
}

/** Her attached data URLs → model images (PNG keeps a cut-out's transparency). */
export function placedImages(refs: string[]): Promise<ModelImage[]> {
  return Promise.all(
    refs.map((r) => normaliseImage(Buffer.from(r.slice(r.indexOf(",") + 1), "base64"))),
  )
}
