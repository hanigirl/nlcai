import Anthropic from "@anthropic-ai/sdk"
import type { ModelImage } from "@/lib/visual-language/image-input"
import type {
  ElementAnchor,
  ElementSlides,
  ExampleKind,
  VisualFormat,
} from "@/lib/visual-language/types"

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

Classify every example in example_kinds (by its number) as exactly one of: carousel, story, feed_post, cover, website, banner, poster, other. A carousel is a multi-slide feed series (often shown as several slides side by side, numbered, or with a swipe cue); a cover is a reel/video cover; a website is a page screenshot.

When inconsistent, issues_he lists each concrete contradiction in short, kind, specific Hebrew (refer to "דוגמה 2", "האלמנט <name>", the colour hex), and still fill summary_he with what you DID see. style_spec may then be an empty string.

When consistent:
- summary_he: 2-3 Hebrew sentences describing the language the way a designer would explain it to the creator.
- style_spec: the brief (rules below). The brand colours she chose are authoritative — build the palette around them.
- palette: the colours in priority order with a short English role each.
- preview: four hex colours for a tiny mock slide of her carousel — bg (slide background), accent (her highlight colour), title (headline text colour), body (body text colour). Must be readable together.
- formats: how the language adapts to each output format. Each value is 50-120 English words of format-specific instructions that ADD to style_spec (never repeat or contradict it):
  - carousel: Instagram 4:5 multi-slide series — how the cover slide differs from content slides and the closing slide, slide numbering / swipe cues, how continuity carries across slides.
  - story: 9:16 vertical with the top ~14% and bottom ~24% kept clear — how text and imagery stack, how multi-frame stories connect.
  - image_post: single 4:5 feed image — headline / sub-headline / closing line hierarchy and layout.
  - b_roll: a TEXT-FREE 9:16 video background — imagery, texture and tone only; a white caption is added later in the lower-middle band.
  When examples of a format exist, describe what THOSE examples actually do (layout, recurring devices, density). When none exist, extrapolate thoughtfully from the language and say so in one short clause. Websites, posters and banners inform the language, not slide structure.
- elements: for EVERY element provided, its id, a short Hebrew name, and an English instruction for the image model on when and how to use it, derived from her note (e.g. "small, bottom corner of closing frames only"). If her note is empty, infer the use from the image.
  Then decide whether the element has a FIXED position:
  - fixed = true when her note names a position ("always bottom-left", "בצד שמאל למטה") OR the examples show it in the same spot on every design. Fixed elements are pasted by code at exact pixels, identical on every slide — so be precise.
  - anchor: the corner/edge it sits at (top-left, top-right, bottom-left, bottom-right, top-center, bottom-center). Her note wins over the examples. "שמאל" = left, "ימין" = right, as seen on the image.
  - width_pct: the element's width as a percentage of the frame width, MEASURED from the examples where it appears (e.g. a badge spanning about a quarter of the slide → 25). Without examples pick a modest size (badges/logos 18-28, arrow groups 20-30).
  - margin_x_pct / margin_y_pct: its distance from the side edge and from the top/bottom edge, both as a percentage of the frame WIDTH, measured from the examples; default 5. Never less than 4.
  - slides: which slides/frames of a multi-image piece carry it — all, cover, content, closing, or not_cover — from her note and the examples.
  - formats: which of carousel, story, image_post it appears in. If her note ties it to one format (e.g. "לקרוסלות"), list only that one.
  When fixed = false, still fill these fields with sensible values; they are ignored.

${SPEC_RULES}`

const NICHE_SYSTEM = `You are a senior brand designer. A content creator has NOT defined a visual language yet. From her niche, who she is and who she serves, choose the visual language a thoughtful designer would give her brand — one that her audience instantly reads as belonging to that world and that builds trust with them.

Examples of the reasoning (do not copy literally):
- A physician / health expert → clean, calm, trustworthy: whites and clinical blues, precise modern sans type, subtle tech/medical motifs, generous whitespace.
- Parent guidance → soft, warm, safe: pastels, rounded shapes, gentle hand-drawn or soft illustration, friendly rounded type.
- Finance / business coaching → confident, sharp: deep navy or charcoal with one strong accent, editorial grid, bold condensed headlines.
- Yoga / wellbeing → natural, airy: earthy neutrals, organic textures, light serif type, lots of breathing room.

Do NOT default to dark canvases, neon gradients, glossy 3D glass objects or "futuristic tech" unless the niche genuinely calls for it. Avoid generic AI-stock aesthetics.

summary_he: 2 Hebrew sentences explaining the chosen language and why it fits her niche.

Also write two tone variants of the SAME niche language — same world, imagery, motifs, type character and mood, only the canvas tone changes. Each is a complete brief in the same format as style_spec:
- dark_spec: a DARK design for this niche. The background is a deep colour that belongs to the niche's world (e.g. kids' education → deep navy or midnight blue with playful toys and warm light accents; wellness → deep forest green or warm charcoal), with light text and the niche's accent colours glowing against it. Dark here means deep and rich, NOT neon, NOT glossy 3D glass, NOT generic sci-fi.
- light_spec: a LIGHT design for this niche — a light, airy canvas in the niche's palette with dark readable text.

${SPEC_RULES}`

const ANALYZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["consistent", "issues_he", "summary_he", "style_spec", "palette", "elements", "example_kinds", "preview", "formats"],
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
    example_kinds: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["example", "kind"],
        properties: {
          example: { type: "integer" },
          kind: {
            type: "string",
            enum: ["carousel", "story", "feed_post", "cover", "website", "banner", "poster", "other"],
          },
        },
      },
    },
    preview: {
      type: "object",
      additionalProperties: false,
      required: ["bg", "accent", "title", "body"],
      properties: {
        bg: { type: "string" },
        accent: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
    },
    formats: {
      type: "object",
      additionalProperties: false,
      required: ["carousel", "story", "image_post", "b_roll"],
      properties: {
        carousel: { type: "string" },
        story: { type: "string" },
        image_post: { type: "string" },
        b_roll: { type: "string" },
      },
    },
    elements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "name", "usage", "fixed", "anchor", "width_pct",
          "margin_x_pct", "margin_y_pct", "slides", "formats",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          usage: { type: "string" },
          fixed: { type: "boolean" },
          anchor: {
            type: "string",
            enum: ["top-left", "top-right", "bottom-left", "bottom-right", "top-center", "bottom-center"],
          },
          width_pct: { type: "number" },
          margin_x_pct: { type: "number" },
          margin_y_pct: { type: "number" },
          slides: { type: "string", enum: ["all", "cover", "content", "closing", "not_cover"] },
          formats: {
            type: "array",
            items: { type: "string", enum: ["carousel", "story", "image_post"] },
          },
        },
      },
    },
  },
} as const

const NICHE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary_he", "style_spec", "dark_spec", "light_spec"],
  properties: {
    summary_he: { type: "string" },
    style_spec: { type: "string" },
    dark_spec: { type: "string" },
    light_spec: { type: "string" },
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
  elements: {
    id: string
    name: string
    usage: string
    fixed: boolean
    anchor: ElementAnchor
    width_pct: number
    margin_x_pct: number
    margin_y_pct: number
    slides: ElementSlides
    formats: VisualFormat[]
  }[]
  /** 1-based example number → what kind of design it is. */
  example_kinds: { example: number; kind: ExampleKind }[]
  preview: { bg: string; accent: string; title: string; body: string }
  formats: Record<VisualFormat, string>
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
): Promise<{ summary_he: string; style_spec: string; dark_spec: string; light_spec: string }> {
  const lines = [
    `Niche: ${identity.niche}`,
    identity.whoIAm ? `Who she is: ${identity.whoIAm.slice(0, 800)}` : null,
    identity.whoIServe ? `Who she serves: ${identity.whoIServe.slice(0, 800)}` : null,
  ].filter(Boolean)
  return runJson(apiKey, NICHE_SYSTEM, [{ type: "text", text: lines.join("\n") }], NICHE_SCHEMA)
}
