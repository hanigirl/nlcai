import Anthropic from "@anthropic-ai/sdk"
import type { ModelImage } from "@/lib/visual-language/image-input"
import type { VisualLanguage } from "@/lib/visual-language/types"

/**
 * One usage example against her visual language, right after she uploads it
 * (Hani, 2026-11-11: "משוב מיידי במידה וזה עניין של שניות … אם זה יותר מ-10
 * שניות לוותר"). A small, fast model; anything slower than FIT_CHECK_MS is
 * dropped and the next analysis decides instead — never a wait she sees.
 */

const MODEL = "claude-haiku-5-5"
export const FIT_CHECK_MS = 10_000

export const FIT_RULES = `Her brand colours, graphic elements and analysed visual language ARE her brand. An example FITS when it reads as the same brand: its palette stays within her colours (plus white, black, greys and tints of them), and its imagery style and mood belong to the language. Layout, composition and density may differ — that is what examples are for. Never judge the typeface: text is always set in her brand fonts. It does NOT fit when it pulls elsewhere: a palette dominated by colours outside her brand, a different imagery style or mood (e.g. dark neon 3D against a light hand-drawn language, a stock-photo collage against flat illustration), or plainly another brand's look.`

export interface FitVerdict {
  fits: boolean
  /** Short Hebrew reason when it doesn't fit, e.g. "רקע ניאון כהה, השפה שלכם בהירה ורכה". */
  reason_he: string
}

export async function checkExampleFit(
  apiKey: string,
  input: { colors: string[]; language: VisualLanguage; image: ModelImage },
): Promise<FitVerdict | null> {
  const vl = input.language
  const brief = [
    `BRAND COLOURS: ${input.colors.length ? input.colors.join(", ") : "(none chosen)"}`,
    vl.palette.length ? `PALETTE: ${vl.palette.map((p) => `${p.hex} (${p.role})`).join(", ")}` : null,
    vl.elements.length ? `GRAPHIC ELEMENTS: ${vl.elements.map((e) => `${e.name} — ${e.usage}`).join("; ")}` : null,
    `LANGUAGE (Hebrew summary): ${vl.summary_he}`,
    `LANGUAGE (design brief): ${vl.style_spec}`,
  ]
    .filter(Boolean)
    .join("\n")
  const anthropic = new Anthropic({ apiKey })
  try {
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 300,
        system: `You check whether one design example belongs to a content creator's visual language.\n\n${FIT_RULES}\n\nAnswer with JSON only: {"fits": true|false, "reason_he": "..."} — reason_he is empty when it fits; otherwise one short, kind, specific Hebrew sentence (max 12 words) naming what differs, addressed in plural ("השפה שלכם").`,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: brief },
              { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 } },
              { type: "text", text: "Does this example fit her visual language? JSON only." },
            ],
          },
        ],
      },
      { timeout: FIT_CHECK_MS, maxRetries: 0 },
    )
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    const json = text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null
    const parsed = JSON.parse(json) as { fits?: unknown; reason_he?: unknown }
    if (typeof parsed.fits !== "boolean") return null
    return { fits: parsed.fits, reason_he: parsed.fits ? "" : String(parsed.reason_he ?? "").trim() || "לא תואם לשפה הוויזואלית שלכם" }
  } catch (err) {
    // Slow, out of credits, anything: the analysis decides later.
    console.error("[example-fit]", err instanceof Error ? err.message : err)
    return null
  }
}
