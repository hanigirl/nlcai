import { createHash } from "crypto"
import Anthropic from "@anthropic-ai/sdk"
import { structureNote, type CardIdentityForPrompt, type StructureMode } from "@/lib/carousel-structure"
import { referenceBlocks } from "@/lib/ai-edit-references"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SlideData } from "@/lib/carousel-templates"
import { fontHead, fontRoleLines, type BrandFont } from "@/lib/broll-animation/compose"
import { launch } from "@/lib/broll-animation/render"
import type { MediaStyle } from "@/lib/visual-language/types"
import { guardedFetch } from "@/lib/server-fetch"
import { loadExampleForModels } from "@/lib/visual-language/image-input"

/**
 * AI carousel, laid out in code (Hani, 2026-10-22).
 *
 * The image model used to draw every slide on its own, text included, so each
 * slide came out with its own fonts, sizes and number position — and never her
 * real font files. A carousel is slides read one after another; it has to be
 * one system.
 *
 * Now:
 *   - Claude Opus designs ONE HTML document for the whole series: a single
 *     stylesheet, her brand fonts only, one type scale, one grid, the slide
 *     number in the same place on every slide. Every slide is a
 *     <section class="slide"> 1080×1350.
 *   - The image model draws only each slide's illustration — no text — which
 *     the layout places in the same slot on every content slide.
 *   - A headless browser screenshots each section. If any text box overflows,
 *     the type scale shrinks for ALL slides together, so sizes stay identical.
 *
 * The composition is kept per post so "עריכה עם AI" edits the layout itself
 * (exact, obedient) and only redraws illustrations she asks about.
 */

export const SLIDE_W = 1080
export const SLIDE_H = 1350
const MODEL = "claude-opus-5-5"
const IMAGE_TOKEN = (i: number) => `__SLIDE_IMAGE_${i + 1}__`

export interface CarouselBrief {
  slides: SlideData[]
  fonts: BrandFont[]
  palette: { hex: string; role: string }[]
  /** Visual language + her standing preferences (resolveDesignDirection lines). */
  styleLines: string[]
  /** Corners kept free for brand elements pasted afterwards. */
  reservedLines: string[]
  /**
   * Public URLs of her carousel usage examples (Settings → visual language →
   * "דוגמאות לשימוש"). When present they ARE the template: the layout copies
   * them one-to-one (Hani, 2026-10-22).
   */
  examples?: string[]
  /**
   * She has brand colours: the examples supply composition only and are
   * sent in grayscale, so their palette can't leak (Hani, 2026-11-09).
   */
  examplesGray?: boolean
  /** Names of the brand elements we paste afterwards — never drawn. */
  pastedElements?: string[]
  /**
   * The look it was made in. Compositions saved before 2026-11-05 don't have
   * it — it is read from their visual-language line (styleOfLines).
   */
  style?: MediaStyle
}

export interface StoredCarousel {
  html: string
  brief: CarouselBrief
  /** Public URL of each slide's illustration, by slide index. */
  illustrations: string[]
  edits: string[]
  /**
   * Fingerprint of each slide this composition produced, in order. The post
   * stores the PNG bytes as-is, so "עריכה עם AI" edits the layout only while
   * the post still holds exactly these slides — once any slide was replaced,
   * uploaded, removed or reordered, the layout is no longer the carousel and
   * the edit works on the real images instead (never overwriting hers).
   */
  slideHashes?: string[]
  /**
   * Per slide: true when its illustration is her own picture (placed from
   * an attached image), never redrawn when the look changes. Missing on
   * compositions saved before 2026-11-05.
   */
  ownArt?: boolean[]
}

export function slideHash(png: Buffer): string {
  return createHash("sha256").update(png).digest("hex")
}

/** True when the post's slides (public URLs, in order) are exactly the ones this composition made. */
export async function carouselStillMatches(stored: StoredCarousel, urls: string[]): Promise<boolean> {
  const expected = stored.slideHashes
  if (!expected?.length || expected.length !== urls.length) return false
  try {
    const actual = await Promise.all(
      urls.map(async (url) => {
        const res = await guardedFetch(url)
        if (!res.ok) throw new Error(`slide fetch ${res.status}`)
        return slideHash(Buffer.from(await res.arrayBuffer()))
      }),
    )
    return actual.every((h, i) => h === expected[i])
  } catch {
    return false
  }
}

const SYSTEM = `You are a senior editorial designer building Instagram carousels for Hebrew-speaking creators, in HTML/CSS.

You output ONE HTML document containing every slide of the carousel as <section class="slide" data-slide="N"> elements (N = 1..count, in order), each exactly ${SLIDE_W}px × ${SLIDE_H}px, position relative, overflow hidden. The page is screenshotted slide by slide.

THE CAROUSEL IS ONE SYSTEM — slides are swiped one after another, so consistency is the whole job:
1. Fonts: ONLY the brand fonts, by role. Everything — titles, body, numbers, callouts, buttons — is set in the PRIMARY font: write font-family: var(--font-primary), never a font name. The secondary font (if she has one) is an accent only: put it on an element with class "accent" (font-family: var(--font-accent)) for at most a short teaser line or one highlighted word — never a title, never a body paragraph. We define those variables to her fonts (they're loaded for you). At most two weights (e.g. 400 and 700).
2. One type scale, defined ONCE in :root as CSS variables, and every font-size written as calc(var(--type-scale) * <px>) — e.g. --title: calc(var(--type-scale) * 76px). All content slides use the SAME title size and the SAME body size. The cover may use one larger title size; the closing slide reuses the content sizes. No per-slide font-size overrides, no inline font styles.
3. One grid: identical margins, text block position and illustration slot on every content slide. Use shared classes, never per-slide positioning.
4. The slide number: the same element, same corner, same size, same style on every slide (e.g. "3/7" or a numbered badge) — designed once in the stylesheet. Nothing else is attached to it: no tab, arrow or shape under or beside it unless the examples show one.
5. Colours: only the brand palette (plus white/black/transparency of them).
6. Text appears EXACTLY as given — same Hebrew words and order, nothing added, no emoji. You MAY split a slide's body between a body paragraph and a highlighted callout (e.g. its key sentence) when the examples do that — every word still appears once, in order. Recurring brand text that appears identically on every example (a website address, a handle) is part of the template and may be reproduced. <html lang="he" dir="rtl">. Put each slide's title in an element with class "title" and body in class "body"; wrap them in an element with class "text-box" that has a fixed max height — if text doesn't fit, we shrink --type-scale for all slides together, so design for the longest text.
7. Illustrations are OPTIONAL. If (and only if) the examples / visual language use imagery, a slide may have one illustration (square, no text, drawn separately in the brand style): place it with <img class="art" src="__SLIDE_IMAGE_N__"> in the same slot on every content slide, and give it a prompt in the json block. A slide without an illustration gets an empty string there and no token. Type-led examples → no illustrations at all.
7b. Decoration: only what the examples / visual language show. Do not invent icons, arrows, chevrons, tabs, badges or ornaments. Brand elements we paste afterwards (listed under PASTED ELEMENTS) must never be drawn or imitated anywhere — not even a simplified version.
8. Keep ≥64px margins; nothing touches or crosses a slide edge.
9. No JavaScript, no external resources other than the illustration tokens.

WHEN USAGE EXAMPLES ARE ATTACHED (images of her own finished carousel slides): they are THE TEMPLATE. Rebuild them one-to-one in HTML — the same structure per slide type (cover / content / closing), the same order of elements top to bottom (e.g. bold dark title → plain body text → tinted callout box), the same positions, proportions, sizes relative to the frame, alignment, spacing, backgrounds, number badge, callout style and weights. Measure them; don't reinterpret them, don't "improve" them, don't add anything they don't have. Only the words and the colours change. The typefaces still come from rule 1. The colours come from BRAND COLOURS (rule 5), never from the examples: keep each example's colour ROLES (which surface is dark, which is light, what is highlighted) and fill every role with the brand colour that fits it.

Return two fenced blocks: first \`\`\`json {"illustrations": ["<English prompt for slide 1's illustration, or empty>", ...]}\`\`\` (one entry per slide; a concrete visual idea with NO text, letters or numbers — or "" for no illustration), then \`\`\`html ...\`\`\`.`

function briefText(b: CarouselBrief): string {
  const fonts = b.fonts.length ? fontRoleLines(b.fonts) : '- (no brand font set — "Rubik" is the primary)'
  const palette = b.palette.length
    ? b.palette.map((p) => `- ${p.hex} — ${p.role}`).join("\n")
    : "- (no brand colours — derive a restrained palette from the visual language)"
  return [
    `SLIDES (${b.slides.length}):`,
    ...b.slides.map(
      (s, i) =>
        `${i + 1}. [${s.type}] title: ${JSON.stringify(s.title)}${s.body ? ` | body: ${JSON.stringify(s.body)}` : ""}`,
    ),
    "",
    "BRAND FONTS:",
    fonts,
    "",
    "BRAND COLOURS:",
    palette,
    "",
    "VISUAL LANGUAGE AND STANDING PREFERENCES:",
    b.styleLines.join("\n").slice(0, 4000),
    ...(b.reservedLines.length ? ["", "RESERVED ZONES (keep empty — brand elements are pasted there afterwards):", ...b.reservedLines] : []),
    ...(b.pastedElements?.length
      ? ["", "PASTED ELEMENTS (we add these ourselves — never draw them or anything resembling them):", ...b.pastedElements.map((n) => `- ${n}`)]
      : []),
    ...(b.examples?.length
      ? ["", `USAGE EXAMPLES: ${b.examples.length} images of her own finished slides are attached above. Rebuild their layout one-to-one, in the BRAND COLOURS above — not their colours.`]
      : []),
  ].join("\n")
}

function parse(
  text: string,
  count: number,
): {
  html: string
  illustrations: string[]
  cutouts: number[]
  attached: number[]
  needsImage: boolean
  /** Slides (0-based) whose PICTURE itself is to change (lib/picture-edit), with the edit. */
  pictureEdits: { slide: number; edit: string }[]
} {
  const json = /```json\s*([\s\S]*?)```/i.exec(text)
  const html = /```html\s*([\s\S]*?)```/i.exec(text)
  if (!html || !/class=["'][^"']*\bslide\b/.test(html[1])) throw new Error("composition_invalid")
  let illustrations: string[] = []
  let cutouts: number[] = []
  let attached: number[] = []
  let needsImage = false
  let pictureEdits: { slide: number; edit: string }[] = []
  try {
    const parsed = JSON.parse(json?.[1] ?? "{}") as {
      illustrations?: string[]
      cutouts?: unknown
      attached?: unknown
      needs_image?: unknown
      picture_edits?: unknown
    }
    illustrations = parsed.illustrations ?? []
    needsImage = parsed.needs_image === true
    cutouts = Array.isArray(parsed.cutouts) ? parsed.cutouts.map(Number) : []
    attached = Array.isArray(parsed.attached) ? parsed.attached.map(Number) : []
    pictureEdits = (Array.isArray(parsed.picture_edits) ? parsed.picture_edits : [])
      .map((e) => {
        const x = (e ?? {}) as { slide?: unknown; edit?: unknown }
        return { slide: Number(x.slide) - 1, edit: typeof x.edit === "string" ? x.edit.trim() : "" }
      })
      .filter((e) => Number.isInteger(e.slide) && e.slide >= 0 && e.slide < count && !!e.edit)
  } catch {
    illustrations = []
  }
  return {
    html: html[1].trim(),
    illustrations: Array.from({ length: count }, (_, i) => illustrations[i] ?? ""),
    // Slide numbers (1-based) → indices, deduped, in range.
    cutouts: Array.from(new Set(cutouts.filter((n) => Number.isInteger(n) && n >= 1 && n <= count).map((n) => n - 1))),
    // Per slide: which attached image (1-based) is placed as its illustration; 0 = none.
    attached: Array.from({ length: count }, (_, i) => (Number.isInteger(attached[i]) && attached[i] > 0 ? attached[i] : 0)),
    needsImage,
    // One edit per slide.
    pictureEdits: pictureEdits.filter((e, i, all) => all.findIndex((o) => o.slide === e.slide) === i),
  }
}

/**
 * Her usage examples as image blocks. In grayscale when her brand colours
 * set the palette — fetched and converted here, since a URL block would
 * hand the model the original colours. One that can't be read is skipped.
 */
async function exampleBlocks(ex: Pick<CarouselBrief, "examples" | "examplesGray">): Promise<Anthropic.ContentBlockParam[]> {
  const urls = ex.examples ?? []
  if (!ex.examplesGray) {
    return urls.map((url): Anthropic.ContentBlockParam => ({ type: "image", source: { type: "url", url } }))
  }
  const images = await Promise.all(
    urls.map((url) =>
      loadExampleForModels(url, true).catch((err) => {
        console.error("[carousel][example-gray]", url, err)
        return null
      }),
    ),
  )
  return images.flatMap((img): Anthropic.ContentBlockParam[] =>
    img ? [{ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }] : [],
  )
}

async function ask(
  apiKey: string,
  user: string,
  count: number,
  ex: Pick<CarouselBrief, "examples" | "examplesGray"> = {},
  refs: string[] = [],
  placeable = false,
  /** Blocks of their own before everything (a structure to copy). */
  lead: Anthropic.ContentBlockParam[] = [],
) {
  const client = new Anthropic({ apiKey })
  const content: Anthropic.ContentBlockParam[] = [
    ...lead,
    ...(await exampleBlocks(ex)),
    ...referenceBlocks(refs, { placeable }),
    { type: "text", text: user },
  ]
  const message = await client.messages
    .stream({ model: MODEL, max_tokens: 24000, system: SYSTEM, messages: [{ role: "user", content }] })
    .finalMessage()
  return parse(message.content.map((c) => (c.type === "text" ? c.text : "")).join(""), count)
}

/**
 * A change to a PICTURE on a slide is made to the picture itself (Hani,
 * 2026-11-05 — lib/picture-edit, gated by lib/feature-access): never faked
 * with CSS. Told to the layout model when the gate is on.
 */
const PICTURE_EDIT_NOTE = [
  'CHANGES TO A PICTURE ITSELF: if she asks to change a picture that is on a slide — her photo, her placed picture or an illustration — such as removing text, a caption, a logo or an object from it, cleaning it up, extending it, blending it into the design, or recolouring it to fit, do NOT do it in HTML/CSS. No cropping, object-position, clip-path, mask, overflow, scaling, overlay, filter or covering shape to hide or fake it. Instead put "picture_edits": [{"slide": N, "edit": "<one precise English instruction for an image-editing model, describing only the change to the picture>"}] in the json block, keep that slide\'s <img class="art"> showing the whole picture (object-fit: contain), and leave its "illustrations" entry empty. We edit the actual image and put the result back in the same place.',
  "Placing a picture as it is (no change to the picture itself) is NOT a picture edit.",
].join("\n")

/**
 * `refs`: look references for a from-zero brief (a picture from a link —
 * lib/ai-edit-references). `place`: pictures she attached to be PUT IN the
 * carousel as they are (Hani, 2026-11-05: "התמונה תכנס ביצירה הראשונה") —
 * each one lands on a slide through `attached`, and the route puts her exact
 * file there, never a redraw.
 */
/**
 * Her slide slots (Hani, 2026-11-06): which slide each of her pictures goes
 * on, said as an order. Null when she didn't choose (the old "cover" rule).
 */
export function placeSlidesNote(placeAt: number[] | undefined, k: number): string | null {
  if (!placeAt || placeAt.length !== k || placeAt.some((n) => !Number.isInteger(n) || n < 0)) return null
  const each = placeAt.map((n, j) => `attached image ${j + 1} on slide ${n + 1}`).join(", ")
  return `She chose exactly where each of her pictures goes: ${each}. Put each one on exactly that slide and no other — these are not suggestions; one picture per slide.`
}

/**
 * Her slide slots, enforced on the layout's answer: `attached` rebuilt from
 * her choice. Null when the layout has no picture slot on one of those
 * slides (the route then says so instead of dropping her picture).
 */
export function forceAttached(html: string, count: number, placeAt: number[]): number[] | null {
  const attached = new Array(count).fill(0)
  for (let j = 0; j < placeAt.length; j++) {
    const i = placeAt[j]
    if (i < 0 || i >= count) return null
    if (!html.includes(`__SLIDE_IMAGE_${i + 1}__`)) return null
    attached[i] = j + 1
  }
  return attached
}

export type CopiedStructure = {
  images: string[]
  analysis: string
  mode: StructureMode
  template?: boolean
  /** Her name / handle / avatar for the card (lib/card-identity); the avatar fills __AVATAR__. */
  identity?: CardIdentityForPrompt
}

/**
 * What the layout model gets for "תעשה לי כזה" (live bug, Hani 2026-11-07:
 * a tweet screenshot came back in her visual language with none of its
 * layout). Her usage examples are NOT attached — the system prompt makes
 * them THE TEMPLATE, which beat the reference every time; her language
 * reaches it as words (fonts, colours) only. The reference images go first,
 * labelled as the structure, never as "a look to match".
 */
export function structurePrompt(brief: CarouselBrief, structure: CopiedStructure) {
  const lead: Anthropic.ContentBlockParam[] = structure.images.flatMap((r, i): Anthropic.ContentBlockParam[] => {
    const m = r.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/)
    if (!m) return []
    return [
      { type: "text", text: structure.template ? "STRUCTURE REFERENCE (one design, for every slide):" : `STRUCTURE REFERENCE — slide ${i + 1}:` },
      { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } },
    ]
  })
  const text =
    briefText({ ...brief, examples: [] }) +
    structureNote(structure.analysis, structure.mode, brief.slides.length, !!structure.template, structure.identity)
  return { lead, text }
}

export function composeCarousel(
  apiKey: string,
  brief: CarouselBrief,
  refs: string[] = [],
  place: string[] = [],
  /** Hani only (lib/feature-access): a change to her picture is a real picture edit. */
  pictureEdits = false,
  /**
   * The slide (0-based) she put each of `place` on, in the AI panel's slide
   * slots (Hani, 2026-11-06) — exact, not a suggestion.
   */
  placeAt?: number[],
  /**
   * "תעשה לי כזה" (Hani, 2026-11-07): another carousel's structure to copy
   * (lib/carousel-structure) — its slides as images, read into words.
   */
  structure?: CopiedStructure,
) {
  if (structure) {
    const p = structurePrompt(brief, structure)
    return ask(apiKey, p.text, brief.slides.length, {}, [], false, p.lead)
  }
  if (!place.length) return ask(apiKey, briefText(brief), brief.slides.length, brief, refs)
  const k = place.length
  const placeNote = [
    "",
    `HER OWN PICTURE${k > 1 ? "S" : ""}: attached image${k > 1 ? `s 1–${k} are` : " 1 is"} her own picture${k > 1 ? "s" : ""} (photo, character, illustration, logo or product) to PUT INTO this carousel as ${k > 1 ? "they are" : "it is"}.${refs.length ? ` Attached image${refs.length > 1 ? `s ${k + 1}–${k + refs.length} are` : ` ${k + 1} is`} only a reference for the look — apply the look, never place ${refs.length > 1 ? "them" : "it"}.` : ""}`,
    placeSlidesNote(placeAt, k) ??
      `Place EVERY one of her pictures on exactly one slide — the cover unless the brief says otherwise; one picture per slide.`,
    `Put "attached": [one entry per slide: the attached image number placed on that slide, or 0] in the json block, leave that slide's "illustrations" entry empty, and show it with <img class="art" src="__SLIDE_IMAGE_N__"> (N = the slide number) styled object-fit: contain, so her picture is never cropped, stretched or distorted. We put her exact file there — never describe it as an illustration prompt. The layout makes room for it; it never covers the slide's text.`,
    ...(pictureEdits ? ["", PICTURE_EDIT_NOTE] : []),
  ].join("\n")
  return ask(apiKey, briefText(brief) + placeNote, brief.slides.length, brief, [...place, ...refs], true)
}

/**
 * Her instruction applied to the layout. Returns the revised HTML and, for
 * slides whose ILLUSTRATION she asked to change, a new prompt (empty string =
 * keep the current illustration); `attached` = slides that get one of the
 * images she attached, as her exact file; `cutouts` = slides whose
 * illustration loses its background.
 */
export function reviseCarousel(
  apiKey: string,
  stored: StoredCarousel,
  instruction: string,
  refs: string[] = [],
  /**
   * The carousel was designed in a visual language she has since replaced,
   * or she asked to apply hers: rebuild the whole look in the one in the
   * brief (which is always her current one), not just her change.
   */
  restyle = false,
  /** Hani only (lib/feature-access): a change to a picture is a real picture edit. */
  pictureEdits = false,
) {
  const own = (stored.ownArt ?? []).flatMap((o, i) => (o ? [i + 1] : []))
  return ask(
    apiKey,
    [
      briefText(stored.brief),
      "",
      "CURRENT CAROUSEL:",
      "```html",
      stored.html,
      "```",
      "",
      ...(stored.edits.length ? ["Earlier requests (already applied):", ...stored.edits.map((e) => `- ${e}`), ""] : []),
      ...(restyle
        ? [
            "RESTYLE — the brand fonts, colours, visual language and usage examples above are the creator's CURRENT visual language. The CURRENT CAROUSEL was designed in an earlier look that she has replaced (or drifted from it). Rebuild the whole carousel in the current language, as if it were designed from this brief today — with the usage examples as the template when they are attached: backgrounds, colours, type treatment, layout devices, decoration and the slide number all follow it. Nothing of the earlier look may remain — no colour, shape, ornament, tab, line or layout device the current language doesn't have. An earlier request that was about the old look no longer applies; one about content (words, her placed picture, its size) still does.",
            "Keep every slide's text exactly as it is — except where the request gives the script's words for a slide: then that slide's text becomes exactly those words.",
            own.length
              ? `Slide${own.length > 1 ? "s" : ""} ${own.join(", ")} show${own.length > 1 ? "" : "s"} the creator's own picture — keep it on that slide, restyle only around it, and never give it a new illustration prompt.`
              : "If an earlier request placed the creator's own picture on a slide, keep that picture there (restyle only around it) and never give it a new illustration prompt.",
            'Every other illustration was drawn in the earlier look: for each slide that should show one in the current language, give a NEW prompt in "illustrations"; if the current language uses no illustrations, drop its token and give "".',
            "",
          ]
        : []),
      "She wants this change now (Hebrew). Carry it out fully and precisely — this is the most important thing. Keep everything she didn't ask to change, and keep the carousel one consistent system:",
      JSON.stringify(instruction),
      "",
      'In the json block, "illustrations" has one entry per slide: a NEW prompt only for slides whose illustration she asked to change, otherwise an empty string.',
      'If she asks to remove an illustration\'s background (e.g. "להוריד רקע", "בלי רקע", "לגזור"), also put "cutouts": [slide numbers] in the json block. The illustration image itself is then cut out for you — the same picture, with a truly transparent background — so it sits directly on the slide\'s background. Removing a background is NOT a reason to redraw: leave its "illustrations" entry empty unless she also asked for a different picture. Never imitate a removed background in CSS: no mix-blend-mode, filter, opacity, mask, overlay or background colour on or around the illustration.',
      ...(refs.length
        ? [
            `She attached ${refs.length === 1 ? "an image" : `${refs.length} images`} (see "Attached image N" above). If she wants one placed in the carousel, put "attached": [one entry per slide: the attached image number to place on that slide, or 0] in the json block, leave that slide's "illustrations" entry empty, and make sure the slide shows it with <img class="art" src="__SLIDE_IMAGE_N__"> (N = the slide number) styled object-fit: contain, so her picture is never cropped, stretched or distorted. We put her exact file there — never describe it as a new illustration prompt. An attached image that only shows the look she wants is a reference: apply the look, and do not list it in "attached". To place it without its background, also list the slide in "cutouts".`,
          ]
        : []),
      ...(pictureEdits ? [PICTURE_EDIT_NOTE] : []),
      'If she asks to put in, swap in or use a SPECIFIC picture (her photo, her character, "this image", a picture from somewhere else) and that picture is not among the attached images, do NOT invent one: return the HTML unchanged and put "needs_image": true in the json block. Never add a person, character or object she did not ask for.',
      ...(restyle
        ? []
        : ["Change nothing she did not ask about — no new overlays, opacity, filters, blend modes or colour shifts on any slide or element."]),
      "Return the full revised HTML.",
    ].join("\n"),
    stored.brief.slides.length,
    stored.brief,
    refs,
    refs.length > 0,
  )
}

/**
 * Illustration prompt for the image model — art only, never text. `cutout`:
 * the subject alone on a transparent background (generate it with
 * background: "transparent"), for a slide where she removed the backdrop.
 */
export function illustrationPrompt(idea: string, slide: SlideData, styleLines: string[], cutout = false): string {
  return [
    "A square illustration for one slide of an Instagram carousel. It will be placed inside a designed layout next to the text, so it must contain NO text at all — no letters, words, numbers, captions, labels or signage.",
    ...(cutout
      ? ["The subject stands alone on a FULLY TRANSPARENT background — no backdrop, gradient, glow, floor, cast shadow, frame or box. Clean alpha edges."]
      : []),
    "",
    idea ? `Idea: ${idea}` : `Make the slide's message visible: ${JSON.stringify(slide.title)}`,
    "",
    "Style — follow the creator's visual language (ignore anything it says about typography or text; there is no text here):",
    ...styleLines,
    "",
    "Clean edges, generous breathing room, readable at small size.",
  ].join("\n")
}

/**
 * Her fonts, enforced. The prompt asks for brand fonts only, but a model will
 * still reach for a familiar face (it once set a whole carousel in Rubik with
 * her font sitting unused). So the families are pinned here, after the
 * composition's CSS: every piece of text gets her PRIMARY font; the secondary
 * one only reaches elements marked "accent" — it never takes the design over.
 * Rubik / Heebo remain only as glyph fallbacks. (--font-head / --font-body
 * are kept, both primary, for compositions written before the roles.)
 */
function fontEnforcement(fonts: BrandFont[]): string {
  if (!fonts.length) return ""
  const primary = fonts.find((f) => f.role !== "secondary") ?? fonts[0]
  const accent = fonts.find((f) => f.role === "secondary") ?? primary
  const p = `${JSON.stringify(primary.family)},"Rubik","Heebo",sans-serif`
  const a = `${JSON.stringify(accent.family)},${p}`
  return `<style>
:root{--font-primary:${p};--font-accent:${a};--font-head:${p};--font-body:${p}}
.slide,.slide *{font-family:var(--font-primary)!important}
.slide .accent,.slide .accent *{font-family:var(--font-accent)!important}
</style>`
}

/** Load the HTML once, fit the type scale across ALL slides, screenshot each. */
export async function renderCarousel(
  html: string,
  illustrationUrls: string[],
  fonts: BrandFont[],
): Promise<Buffer[]> {
  let page = html
  illustrationUrls.forEach((url, i) => {
    page = page.split(IMAGE_TOKEN(i)).join(url ?? "")
  })
  // A slot left without art (no idea for it) disappears instead of a broken image.
  page = page.replace(/__SLIDE_IMAGE_\d+__/g, "")
  // The illustration is a finished picture: a blend mode only muddies it (a
  // "multiply" once turned a cut-out request into a dark square). Its
  // background is removed in the file itself (cutoutImage), never in CSS.
  page = page.replace(
    /<\/head>/i,
    `<style>img[src=""]{display:none!important}.slide img.art{mix-blend-mode:normal!important}</style></head>`,
  )
  const head = fontHead(fonts) + fontEnforcement(fonts)
  // Appended at the END of <head> so it wins over the composition's own CSS.
  page = /<\/head>/i.test(page) ? page.replace(/<\/head>/i, `${head}</head>`) : `${head}${page}`

  const browser = await launch({ width: SLIDE_W, height: SLIDE_H })
  try {
    const tab = await browser.newPage()
    await tab.setViewport({ width: SLIDE_W, height: SLIDE_H })
    await tab.setContent(page, { waitUntil: "load", timeout: 60_000 })
    await tab.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined)
    // A string, not a function: bundlers wrap named inner functions in
    // helpers (e.g. __name) that don't exist inside the page.
    await tab.evaluate(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
      // One scale for every slide: shrink together until nothing overflows.
      const root = document.documentElement;
      const boxes = Array.from(document.querySelectorAll(".text-box"));
      // Overflow = the text really needs more room than the box allows: past
      // its max-height (a tight line-height spilling a few px of descenders
      // doesn't count) or wider than the box.
      const over = () => boxes.some((el) => {
        const cs = getComputedStyle(el);
        const maxH = parseFloat(cs.maxHeight);
        const limit = Number.isFinite(maxH) ? maxH : el.clientHeight;
        return el.scrollHeight > limit + 16 || el.scrollWidth > el.clientWidth + 2;
      });
      let scale = parseFloat(getComputedStyle(root).getPropertyValue("--type-scale")) || 1;
      root.style.setProperty("--type-scale", String(scale));
      // Never below 70% — past that it's a layout problem, not a fit problem.
      for (let i = 0; i < 8 && over(); i++) {
        scale = Math.round(scale * 0.95 * 1000) / 1000;
        root.style.setProperty("--type-scale", String(scale));
      }
    })()`)
    // One slide on screen at a time, pinned to the top-left of the viewport:
    // element screenshots of a tall RTL page land off by the scrollbar.
    const count = await tab.evaluate(`document.querySelectorAll(".slide").length`)
    const shots: Buffer[] = []
    for (let i = 0; i < Number(count); i++) {
      await tab.evaluate(`(() => {
        document.documentElement.style.overflow = "hidden";
        document.body.style.margin = "0";
        document.body.style.overflow = "hidden";
        document.querySelectorAll(".slide").forEach((el, j) => {
          el.style.display = j === ${i} ? "" : "none";
        });
        window.scrollTo(0, 0);
      })()`)
      shots.push(
        Buffer.from(await tab.screenshot({ type: "png", clip: { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H } })),
      )
    }
    return shots
  } finally {
    await browser.close().catch(() => undefined)
  }
}

// ---- storage: one composition per post ------------------------------------

const BUCKET = "user-media"
const compPath = (userId: string, postId: string) => `${userId}/carousel-compositions/${postId}.json`

export async function loadCarousel(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
): Promise<StoredCarousel | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(compPath(userId, postId))
  if (error || !data) return null
  try {
    return JSON.parse(await data.text()) as StoredCarousel
  } catch {
    return null
  }
}

export async function saveCarousel(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  value: StoredCarousel,
): Promise<void> {
  const p = compPath(userId, postId)
  const body = JSON.stringify(value)
  const { error } = await supabase.storage.from(BUCKET).upload(p, body, { contentType: "application/json", upsert: true })
  if (!error) return
  await supabase.storage.from(BUCKET).remove([p])
  await supabase.storage.from(BUCKET).upload(p, body, { contentType: "application/json" })
}

export async function uploadIllustration(
  supabase: SupabaseClient,
  userId: string,
  png: Buffer,
): Promise<string> {
  const p = `${userId}/carousel-art/${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from(BUCKET).upload(p, png, { contentType: "image/png" })
  if (error) throw new Error(error.message)
  return supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl
}

/** Where a picture sits on its slide: its box, and where the slide's text lies over it. */
export interface ArtSlot {
  width: number
  height: number
  /** The text box over the picture: "top" / "middle" / "bottom" of it, or null when they don't overlap. */
  textOver: "top" | "middle" | "bottom" | null
}

/**
 * Measure the picture slot of each slide, as the layout draws it, before her
 * picture goes in — so the picture can be adapted to that exact shape (and
 * kept calm where the title lies over it) instead of being cropped into it.
 * `aspects`: per slide, the width/height of the picture that will fill the
 * slot (a slot sized by its picture is measured at that ratio). Slides with
 * no aspect, or no picture slot, get null.
 */
export async function measureArtSlots(
  html: string,
  aspects: (number | null)[],
  fonts: BrandFont[],
): Promise<(ArtSlot | null)[]> {
  const sharpMod = (await import("sharp")).default
  let page = html
  for (let i = 0; i < aspects.length; i++) {
    const a = aspects[i]
    if (!a) continue
    const w = 64
    const h = Math.max(1, Math.round(w / a))
    const png = await sharpMod({ create: { width: w, height: h, channels: 3, background: "#808080" } }).png().toBuffer()
    page = page.split(IMAGE_TOKEN(i)).join(`data:image/png;base64,${png.toString("base64")}`)
  }
  page = page.replace(/__SLIDE_IMAGE_\d+__/g, "")
  const head = fontHead(fonts) + fontEnforcement(fonts)
  page = /<\/head>/i.test(page) ? page.replace(/<\/head>/i, `${head}</head>`) : `${head}${page}`
  const browser = await launch({ width: SLIDE_W, height: SLIDE_H })
  try {
    const tab = await browser.newPage()
    await tab.setViewport({ width: SLIDE_W, height: SLIDE_H })
    await tab.setContent(page, { waitUntil: "load", timeout: 60_000 })
    const found = (await tab.evaluate(`Array.from(document.querySelectorAll(".slide")).map((s) => {
      s.style.display = "";
      const img = s.querySelector("img.art");
      if (!img || !img.getAttribute("src")) return null;
      const a = img.getBoundingClientRect();
      if (a.width < 2 || a.height < 2) return null;
      const t = s.querySelector(".text-box");
      let over = null;
      if (t) {
        const b = t.getBoundingClientRect();
        const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
        const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
        if (bottom > top && right > left) {
          const mid = ((top + bottom) / 2 - a.top) / a.height;
          over = mid < 0.36 ? "top" : mid > 0.64 ? "bottom" : "middle";
        }
      }
      return { width: a.width, height: a.height, textOver: over };
    })`)) as (ArtSlot | null)[]
    return aspects.map((a, i) => (a ? (found[i] ?? null) : null))
  } finally {
    await browser.close().catch(() => undefined)
  }
}
