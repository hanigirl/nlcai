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
export type CarouselStructure = { analysis: string; slides: SlideData[] }

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
        'Answer with a fenced json block only: {"analysis": "...", "slides": [{"type": "cover"|"content"|"cta", "title": "...", "body": "..."}]}',
      ].join("\n"),
    },
  ]
  const message = await client.messages.create({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content }] })
  const text = message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = /```json\s*([\s\S]*?)```/i.exec(text)?.[1] ?? /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error("structure_unread")
  const parsed = JSON.parse(json) as { analysis?: unknown; slides?: { type?: unknown; title?: unknown; body?: unknown }[] }
  const slides = (parsed.slides ?? [])
    .map((s, i): SlideData => ({
      slide: i + 1,
      type: s.type === "cover" || s.type === "cta" ? s.type : "content",
      title: typeof s.title === "string" ? s.title.trim() : "",
      body: typeof s.body === "string" ? s.body.trim() : "",
    }))
    .filter((s) => s.title || s.body)
  if (typeof parsed.analysis !== "string" || slides.length < 1) throw new Error("structure_unread")
  return { analysis: parsed.analysis, slides: slides.slice(0, refs.length) }
}

/** What the layout model is told on top of the brief. */
export function structureNote(analysis: string, mode: StructureMode, count: number): string {
  return [
    "",
    `STRUCTURE TO COPY: the attached reference images are another creator's ${count}-slide carousel. Build this carousel with EXACTLY the same structure: the same number of slides (${count}), and on each slide the same layout, text positions, alignment, proportions, hierarchy and role as the matching reference slide. Her text replaces theirs; never copy their words, handle, logo or photos.`,
    mode === "brand"
      ? "LOOK: from HER visual language above (her colours, fonts, decoration, usage examples) — NOT the reference's. The reference images are ONLY for structure: ignore their colours, fonts and decoration."
      : "LOOK: as close as possible to the reference — its background and text colours, accent colour, type style (choose the closest of the available fonts), weights, case and decorative devices.",
    "",
    "The reference, described:",
    analysis,
  ].join("\n")
}
