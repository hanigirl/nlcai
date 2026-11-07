import Anthropic from "@anthropic-ai/sdk"
import type { SlideData } from "@/lib/carousel-templates"

/**
 * "תעשה לי כזה" (Hani, 2026-11-07): a carousel she points at — a link's
 * slides, or screenshots — is a STRUCTURE to copy, rebuilt with the post's
 * own text. This step reads the reference (vision) and fits the script to it:
 *   - per reference slide: its role, layout, where the text sits, hierarchy;
 *   - its look (colours, type, decoration) — used only in "exact" mode;
 *   - the script re-split into exactly as many slides as the reference has,
 *     from the script's own words (never new claims).
 * The layout model then builds it (lib/carousel-composition,
 * composeFromStructure) — in her visual language ("brand", the default) or
 * as close as possible to the reference's look ("exact").
 */

export type StructureMode = "brand" | "exact"
/**
 * `template`: ONE reference image (a tweet, a single post) — a design to
 * apply to every slide; the script keeps its own slides (Hani, 2026-11-07:
 * one tweet screenshot used to make a 1-slide carousel).
 */
export type CarouselStructure = { analysis: string; slides: SlideData[]; template: boolean; needs: StructureNeed[] }

/**
 * Personal things the reference shows that only she can supply (Hani,
 * 2026-11-07: a tweet card came back with an empty grey avatar and no name —
 * "אם חסר לך משהו תבקש מהמשתמש"). The route fills what it already knows
 * (lib/card-identity) and asks for the rest before building.
 */
export type StructureNeed = "avatar" | "name" | "handle" | "logo" | "photo"
const NEEDS: StructureNeed[] = ["avatar", "name", "handle", "logo", "photo"]
function parseNeeds(raw: unknown): StructureNeed[] {
  return Array.isArray(raw) ? NEEDS.filter((n) => raw.includes(n)) : []
}
const NEEDS_ASK =
  'Also list in "needs" every PERSONAL element the reference shows that the creator must supply herself — "avatar" (a profile picture), "name" (a display name), "handle" (an @handle), "logo" (a brand logo), "photo" (a photo of her / her product). Only what is actually visible; [] if none.'


const MODEL = "claude-opus-5-5"
export const MAX_STRUCTURE_SLIDES = 10

function imageBlock(dataUrl: string): Anthropic.ContentBlockParam {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/)
  if (!m) throw new Error("bad_reference")
  return { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } }
}

export async function readCarouselStructure(
  apiKey: string,
  references: string[],
  script: SlideData[],
): Promise<CarouselStructure> {
  const refs = references.slice(0, MAX_STRUCTURE_SLIDES)
  if (refs.length === 1) return readTemplate(apiKey, refs[0], script)
  const client = new Anthropic({ apiKey })
  const content: Anthropic.ContentBlockParam[] = [
    ...refs.flatMap((r, i): Anthropic.ContentBlockParam[] => [{ type: "text", text: `Reference slide ${i + 1}:` }, imageBlock(r)]),
    {
      type: "text",
      text: [
        `Above are the ${refs.length} slides, in order, of an Instagram carousel someone else made (screenshots may include app chrome — ignore it). The creator wants a carousel built exactly like it, with HER text.`,
        "",
        "1. ANALYSIS (English, precise, for a designer who cannot see the images): for each reference slide — its role (cover / point / list / quote / CTA…), the layout (where the title, body, numbers, image or shape sit, alignment, proportions, margins), the text hierarchy (sizes relative to each other, weights), and how many lines of text it holds. Then the carousel's look: background colours, text colours, accent colour, type style (serif / sans, weight, case), decoration and recurring devices (slide numbers, arrows, handles, frames).",
        "",
        `2. SLIDES: her script, re-split into EXACTLY ${refs.length} slides that fit those roles — the cover gets the hook, the last slide its call to action if the reference ends with one. Use ONLY her script's words (Hebrew), in order; you may split or merge her slides and shorten to fit a slide's text amount, never add a claim or a new idea. Each slide: a title and an optional body.`,
        "",
        "Her script:",
        ...script.map((s) => `- [${s.type}] ${s.title}${s.body ? ` — ${s.body}` : ""}`),
        "",
        NEEDS_ASK,
        'Answer with a fenced json block only: {"analysis": "...", "slides": [{"type": "cover"|"content"|"cta", "title": "...", "body": "..."}], "needs": [...]}',
      ].join("\n"),
    },
  ]
  const message = await client.messages.create({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content }] })
  const text = message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = /```json\s*([\s\S]*?)```/i.exec(text)?.[1] ?? /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error("structure_unread")
  const parsed = JSON.parse(json) as { analysis?: unknown; slides?: { type?: unknown; title?: unknown; body?: unknown }[]; needs?: unknown }
  const slides = (parsed.slides ?? [])
    .map((s, i): SlideData => ({
      slide: i + 1,
      type: s.type === "cover" || s.type === "cta" ? s.type : "content",
      title: typeof s.title === "string" ? s.title.trim() : "",
      body: typeof s.body === "string" ? s.body.trim() : "",
    }))
    .filter((s) => s.title || s.body)
  if (typeof parsed.analysis !== "string" || slides.length < 1) throw new Error("structure_unread")
  return { analysis: parsed.analysis, slides: slides.slice(0, refs.length), template: false, needs: parseNeeds(parsed.needs) }
}

/** One reference: the design every slide takes; her script's slides stay as they are. */
async function readTemplate(apiKey: string, reference: string, script: SlideData[]): Promise<CarouselStructure> {
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: [
          imageBlock(reference),
          {
            type: "text",
            text: [
              "Above is ONE design the creator wants every slide of her Instagram carousel to look like (it may be a tweet / X post, a LinkedIn or Threads post, a quote card, a single slide — screenshots may include app chrome: ignore phone status bars and the app's own buttons, keep what makes the card).",
              "Describe it precisely, in English, for a designer who cannot see it, as a TEMPLATE to apply to every slide of a 4:5 carousel:",
              "- what it is (e.g. a tweet card) and its overall composition: background, the card (if any) and its size, corner radius, border/shadow, margins;",
              "- every element and exactly where it sits: avatar (shape, size, position), display name, handle, verified badge, timestamp, the post text (size relative to the frame, weight, alignment, line spacing), any engagement row (icons, counts), dividers;",
              "- the hierarchy (what's biggest/boldest) and the colours (background, card, text, secondary text, accents) and type style (serif/sans, weights);",
              "- how a cover vs a content slide vs a closing slide should use it (usually the same card with the slide's title as the post text, body under it).",
              NEEDS_ASK,
              'Answer with a fenced json block only: {"analysis": "...", "needs": [...]}',
            ].join("\n"),
          },
        ],
      },
    ],
  })
  const text = message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = /```json\s*([\s\S]*?)```/i.exec(text)?.[1] ?? /\{[\s\S]*\}/.exec(text)?.[0]
  const parsed = json ? (JSON.parse(json) as { analysis?: unknown; needs?: unknown }) : null
  const analysis = parsed?.analysis
  if (typeof analysis !== "string" || !analysis.trim()) throw new Error("structure_unread")
  return { analysis, slides: script, template: true, needs: parseNeeds(parsed?.needs) }
}

/** What the layout model is told on top of the brief. */
/** Her identity for the card's personal elements (lib/card-identity). */
export type CardIdentityForPrompt = { name?: string; handle?: string; avatar?: boolean }

export function structureNote(
  analysis: string,
  mode: StructureMode,
  count: number,
  template = false,
  identity: CardIdentityForPrompt = {},
): string {
  const who = [
    identity.name ? `display name "${identity.name}"` : "",
    identity.handle ? `handle "@${identity.handle.replace(/^@/, "")}"` : "",
    identity.avatar ? 'profile picture: <img class="avatar" src="__AVATAR__"> (a circle, object-fit: cover)' : "",
  ].filter(Boolean)
  return [
    "",
    "THIS OVERRIDES EVERY LAYOUT RULE ABOVE — the layout comes from the STRUCTURE REFERENCE, not from her visual language's usual layout or any template.",
    template
      ? `STRUCTURE TO COPY: the STRUCTURE REFERENCE image is ONE design (e.g. a tweet card). EVERY one of the ${count} slides is built as that design: the same composition, elements, positions, proportions and hierarchy on each slide, with that slide's text as the post's text (title first, body after). Where it shows an author's avatar, name and handle, those are HERS (below), never the reference author's.`
      : `STRUCTURE TO COPY: the STRUCTURE REFERENCE images are another creator's ${count}-slide carousel. Build this carousel with EXACTLY the same structure: the same number of slides (${count}), and on each slide the same layout, text positions, alignment, proportions, hierarchy and role as the matching reference slide.`,
    "Her text replaces theirs; never copy their words, handle, logo or photos.",
    who.length
      ? `HER IDENTITY on the card (use exactly these where the reference shows the author): ${who.join("; ")}.`
      : "",
    "Never leave a personal element as an empty placeholder or invent one: an element she didn't supply is left out of the design entirely (the layout closes up around it).",
    mode === "brand"
      ? "LOOK: ONLY her colours and fonts (and her pasted elements) come from her visual language above — applied onto the reference's layout. Everything else — composition, element positions, card, sizes, hierarchy — is the reference's."
      : "LOOK: as close as possible to the reference — its background and text colours, accent colour, type style (choose the closest of the available fonts), weights, case and decorative devices.",
    "",
    "The reference, described:",
    analysis,
  ].join("\n")
}
