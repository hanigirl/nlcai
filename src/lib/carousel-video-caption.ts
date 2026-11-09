import Anthropic from "@anthropic-ai/sdk"

/**
 * The words on a carousel video slide (Hani, 2026-11-06: "כיתוב על הסרטון
 * מגיע מהסקריפט כמובן אבל צריכה להיות גמישות לשנות גם מהצאט").
 *
 * By default: the slide's own words from the carousel script. Her message in
 * the chat can change them — her own text ("תכתוב על הסרטון: ..."), or a
 * shorter / rewritten caption — and whatever is left of it is the design
 * (colours, position, motion). Without any words about the text, the
 * script stays exactly as it is.
 *
 * On any model error the script is kept and her whole message is the design
 * — the caption never silently loses what she wrote.
 */
export type VideoCaptionWords = { headline: string; body?: string; design?: string }

export async function videoCaptionWords(
  apiKey: string,
  script: { headline: string; body?: string },
  instruction: string | undefined,
): Promise<VideoCaptionWords> {
  const ask = instruction?.trim()
  if (!ask) return { ...script }
  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            "An animated caption goes on a video slide of an Instagram carousel (Hebrew).",
            `The slide's words from the script — headline: ${JSON.stringify(script.headline)}${script.body ? `, body: ${JSON.stringify(script.body)}` : ""}.`,
            `Her message about this video: ${JSON.stringify(ask)}`,
            "",
            "Decide the caption's words:",
            "- If she gives her own text to put on the video (e.g. 'תכתוב על הסרטון: ...', a quoted line), use exactly her words as the headline (and no body unless she gave a second line).",
            "- If she asks to shorten, rewrite, change or translate the caption, rewrite the script's words that way, in natural spoken Hebrew.",
            "- Otherwise keep the script's headline and body EXACTLY as they are.",
            "Everything in her message that is about the look (colour, size, position, font, motion, plate) is the design — copy it, in her words.",
            'Answer with JSON only: {"headline": "...", "body": "..." or null, "design": "..." or null}',
          ].join("\n"),
        },
      ],
    })
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    const parsed = json ? (JSON.parse(json) as { headline?: unknown; body?: unknown; design?: unknown }) : null
    const headline = typeof parsed?.headline === "string" ? parsed.headline.trim() : ""
    if (!headline) return { ...script, design: ask }
    return {
      headline,
      ...(typeof parsed?.body === "string" && parsed.body.trim() ? { body: parsed.body.trim() } : {}),
      ...(typeof parsed?.design === "string" && parsed.design.trim() ? { design: parsed.design.trim() } : {}),
    }
  } catch (err) {
    console.error("[carousel-video-caption]", err instanceof Error ? err.message : err)
    return { ...script, design: ask }
  }
}

/** A script unit as the video caption takes it: a body alone becomes the headline, verbatim. */
export function scriptWords(unit: { headline?: string; body?: string }): { headline: string; body?: string } {
  if (unit.headline) return { headline: unit.headline, ...(unit.body ? { body: unit.body } : {}) }
  return { headline: unit.body ?? "" }
}

const squash = (t: string) => t.replace(/[\s"'״׳.,!?:;—–-]+/g, "")

/**
 * The words are the script's (Hani, 2026-11-09: "apply the text of the
 * script, not add any additional text"): whatever the model wrote is kept
 * only when it IS the script, or words she dictated in her message. A
 * shortened / rewritten caption is dropped back to the script; the look she
 * asked for (design) always stays.
 */
export function holdVideoWordsToScript(
  words: VideoCaptionWords,
  script: { headline: string; body?: string },
  instruction: string | undefined,
): VideoCaptionWords {
  const said = squash(instruction ?? "")
  const theirs = squash([words.headline, words.body].filter(Boolean).join(""))
  const fromScript = theirs === squash([script.headline, script.body].filter(Boolean).join(""))
  const dictated = !!theirs && said.includes(theirs)
  const design = words.design ?? (instruction?.trim() || undefined)
  if (fromScript || dictated) return { headline: words.headline, ...(words.body ? { body: words.body } : {}), ...(design ? { design } : {}) }
  return { ...script, ...(design ? { design } : {}) }
}
