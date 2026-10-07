import Anthropic from "@anthropic-ai/sdk"
import type { ModelImage } from "@/lib/visual-language/image-input"

/**
 * Two jobs, one model:
 *
 * 1. analyzeVisualLanguage — reads the user's brand colours, graphic elements
 *    (with her note on each) and design examples, and either writes ONE design
 *    brief the image model can follow, or reports that the inputs don't share
 *    a language (and says why, in Hebrew, so she can fix them).
 *
 * 2. deriveNicheVisualLanguage — when she has no visual language, invents a
 *    fitting one from her niche (a doctor → clean clinical blues; parenting
 *    guidance → soft pastels) instead of the old one-size neon/3D look.
 */

const MODEL = "claude-opus-5-5"

const SPEC_RULES = `The style_spec is handed VERBATIM to an image model (gpt-image) that designs Instagram stories, feed posts, carousels and video backgrounds with Hebrew text baked in. Write it in English, as direct design instructions, 120-220 words, covering:
- Canvas/background treatment (light or dark, flat, gradient, photographic, textured…)
- Palette with exact hex values and the ROLE of each (background, headline, accent, highlight)
- Typography feel for Hebrew (weight, width, serif/sans character, case of emphasis, how the key phrase is highlighted)
- Imagery style (photo / illustration / 3D / flat shapes / none) and how much of the frame it takes
- Composition habits (alignment, whitespace, framing devices, recurring shapes)
- Mood in 3-5 adjectives
Never mention fonts by file name, never ask for a logo or any text — text content is supplied separately.`

const ANALYZE_SYSTEM = `You are a senior brand designer. A content creator gives you her brand inputs. Your job is to extract the visual language they share and turn it into a reusable design brief.

Inputs you may receive:
- BRAND COLOURS she chose (up to 3 hex values, in priority order).
- GRAPHIC ELEMENTS — each image is labelled "Element <id>" with her note on what it is / when it's used.
- DESIGN EXAMPLES — posters, banners, posts, or a screenshot of her website / sales page, labelled "Example N". A website screenshot may come with an extracted colour palette.

Decide first: do these inputs express ONE clear, unified visual language?
- consistent = true when the examples share a recognisable system (palette, type treatment, imagery style, composition) and the chosen colours belong to it. Small variation is normal; a brand still reads as itself.
- consistent = false when the examples contradict each other (e.g. one is pastel and hand-drawn, another is dark neon 3D, a third is a stock-photo collage), OR the chosen brand colours don't appear in / clash with the examples, OR the examples are so generic that no language can be identified.
- With no examples at all, judge the colours and elements on their own: consistent unless they clearly clash.

When inconsistent, issues_he lists each concrete contradiction in short, kind, specific Hebrew (refer to "דוגמה 2", "האלמנט <name>", the colour hex), and still fill summary_he with what you DID see. style_spec may then be an empty string.

When consistent:
- summary_he: 2-3 Hebrew sentences describing the language the way a designer would explain it to the creator.
- style_spec: the brief (rules below). The brand colours she chose are authoritative — build the palette around them.
- palette: the colours in priority order with a short English role each.
- elements: for EVERY element provided, its id, a short Hebrew name, and an English instruction for the image model on when and how to use it, derived from her note (e.g. "small, bottom corner of closing frames only"). If her note is empty, infer the use from the image.

${SPEC_RULES}`

const NICHE_SYSTEM = `You are a senior brand designer. A content creator has NOT defined a visual language yet. From her niche, who she is and who she serves, choose the visual language a thoughtful designer would give her brand — one that her audience instantly reads as belonging to that world and that builds trust with them.

Examples of the reasoning (do not copy literally):
- A physician / health expert → clean, calm, trustworthy: whites and clinical blues, precise modern sans type, subtle tech/medical motifs, generous whitespace.
- Parent guidance → soft, warm, safe: pastels, rounded shapes, gentle hand-drawn or soft illustration, friendly rounded type.
- Finance / business coaching → confident, sharp: deep navy or charcoal with one strong accent, editorial grid, bold condensed headlines.
- Yoga / wellbeing → natural, airy: earthy neutrals, organic textures, light serif type, lots of breathing room.

Do NOT default to dark canvases, neon gradients, glossy 3D glass objects or "futuristic tech" unless the niche genuinely calls for it. Avoid generic AI-stock aesthetics.

summary_he: 2 Hebrew sentences explaining the chosen language and why it fits her niche.

${SPEC_RULES}`

const ANALYZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["consistent", "issues_he", "summary_he", "style_spec", "palette", "elements"],
  properties: {
    consistent: { type: "boolean" },
    issues_he: { type: "array", items: { type: "string" } },
    summary_he: { type: "string" },
    style_spec: { type: "string" },
    palette: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hex", "role"],
        properties: { hex: { type: "string" }, role: { type: "string" } },
      },
    },
    elements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "usage"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          usage: { type: "string" },
        },
      },
    },
  },
} as const

const NICHE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary_he", "style_spec"],
  properties: {
    summary_he: { type: "string" },
    style_spec: { type: "string" },
  },
} as const

export interface AnalyzeInput {
  colors: string[]
  elements: { id: string; description: string; image: ModelImage }[]
  examples: { label: string; image: ModelImage; palette?: string[] }[]
  niche: string | null
}

export interface AnalyzeOutput {
  consistent: boolean
  issues_he: string[]
  summary_he: string
  style_spec: string
  palette: { hex: string; role: string }[]
  elements: { id: string; name: string; usage: string }[]
}

function imageBlock(img: ModelImage): Anthropic.Messages.ImageBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }
}

async function runJson<T>(
  apiKey: string,
  system: string,
  content: Anthropic.Messages.ContentBlockParam[],
  schema: Record<string, unknown>,
): Promise<T> {
  const anthropic = new Anthropic({ apiKey })
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  })
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to analyse these images")
  }
  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
  return JSON.parse(text) as T
}

export async function analyzeVisualLanguage(
  apiKey: string,
  input: AnalyzeInput,
): Promise<AnalyzeOutput> {
  const content: Anthropic.Messages.ContentBlockParam[] = []

  content.push({
    type: "text",
    text:
      `BRAND COLOURS: ${input.colors.length ? input.colors.join(", ") : "(none chosen)"}\n` +
      (input.niche ? `Her niche (context only): ${input.niche}\n` : ""),
  })

  if (input.elements.length) {
    content.push({ type: "text", text: "GRAPHIC ELEMENTS:" })
    for (const el of input.elements) {
      content.push({
        type: "text",
        text: `Element ${el.id} — her note: ${el.description.trim() || "(no note)"}`,
      })
      content.push(imageBlock(el.image))
    }
  }

  if (input.examples.length) {
    content.push({ type: "text", text: "DESIGN EXAMPLES:" })
    input.examples.forEach((ex, i) => {
      content.push({
        type: "text",
        text:
          `Example ${i + 1} (${ex.label})` +
          (ex.palette?.length ? ` — extracted palette: ${ex.palette.join(", ")}` : ""),
      })
      content.push(imageBlock(ex.image))
    })
  }

  content.push({
    type: "text",
    text: "Analyse these inputs as instructed and return the JSON result.",
  })

  return runJson<AnalyzeOutput>(apiKey, ANALYZE_SYSTEM, content, ANALYZE_SCHEMA)
}

export async function deriveNicheVisualLanguage(
  apiKey: string,
  identity: { niche: string; whoIAm?: string | null; whoIServe?: string | null },
): Promise<{ summary_he: string; style_spec: string }> {
  const lines = [
    `Niche: ${identity.niche}`,
    identity.whoIAm ? `Who she is: ${identity.whoIAm.slice(0, 800)}` : null,
    identity.whoIServe ? `Who she serves: ${identity.whoIServe.slice(0, 800)}` : null,
  ].filter(Boolean)
  return runJson(apiKey, NICHE_SYSTEM, [{ type: "text", text: lines.join("\n") }], NICHE_SCHEMA)
}
