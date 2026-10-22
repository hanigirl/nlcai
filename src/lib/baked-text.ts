import Anthropic from "@anthropic-ai/sdk"
import { normaliseImage } from "@/lib/visual-language/image-input"

/**
 * Does a picture the user brought already carry its words?
 *
 * The caption tools lay the post's text over a BARE picture — a photo, a
 * background. A slide designed in Canva already has its headline set into the
 * image, and burning a second caption over it ruins it; offering the
 * "לכלול טקסט" / "מיקום" controls on it is a control with nothing to act on
 * (Hani, 2026-10-22). So the picture is looked at once, when it arrives.
 *
 * A name, handle, logo or watermark doesn't count — a bare photo with her
 * handle in the corner still wants its caption.
 *
 * Returns null when it couldn't tell (no key, model error): callers keep the
 * old behaviour rather than guess.
 */
export async function imageHasBakedText(
  apiKey: string,
  base64: string,
): Promise<boolean | null> {
  try {
    const image = await normaliseImage(Buffer.from(base64, "base64"))
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.mediaType, data: image.base64 },
            },
            {
              type: "text",
              text:
                "Is there designed text in this image — a headline, sentence or paragraph that is part of the design (in any language)? " +
                "Ignore a name, @handle, logo, watermark, page number or text printed on an object in a photo. " +
                "Answer only YES or NO.",
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
    console.error("[baked-text]", err instanceof Error ? err.message : err)
    return null
  }
}
