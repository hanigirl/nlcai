import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SlideData } from "@/lib/carousel-templates"
import { fontHead, type BrandFont } from "@/lib/broll-animation/compose"
import { launch } from "@/lib/broll-animation/render"

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
}

export interface StoredCarousel {
  html: string
  brief: CarouselBrief
  /** Public URL of each slide's illustration, by slide index. */
  illustrations: string[]
  edits: string[]
}

const SYSTEM = `You are a senior editorial designer building Instagram carousels for Hebrew-speaking creators, in HTML/CSS.

You output ONE HTML document containing every slide of the carousel as <section class="slide" data-slide="N"> elements (N = 1..count, in order), each exactly ${SLIDE_W}px × ${SLIDE_H}px, position relative, overflow hidden. The page is screenshotted slide by slide.

THE CAROUSEL IS ONE SYSTEM — slides are swiped one after another, so consistency is the whole job:
1. Fonts: ONLY the brand fonts. Write font-family as var(--font-head) for headings (.title) and var(--font-body) for everything else — never a font name. We define those variables to her brand fonts (they're loaded for you). No font-weight soup: at most two weights.
2. One type scale, defined ONCE in :root as CSS variables, and every font-size written as calc(var(--type-scale) * <px>) — e.g. --title: calc(var(--type-scale) * 76px). All content slides use the SAME title size and the SAME body size. The cover may use one larger title size; the closing slide reuses the content sizes. No per-slide font-size overrides, no inline font styles.
3. One grid: identical margins, text block position and illustration slot on every content slide. Use shared classes, never per-slide positioning.
4. The slide number: the same element, same corner, same size, same style on every slide (e.g. "3/7" or a numbered badge) — designed once in the stylesheet.
5. Colours: only the brand palette (plus white/black/transparency of them).
6. Text appears EXACTLY as given — same Hebrew words and order, nothing added, no emoji. <html lang="he" dir="rtl">. Put each slide's title in an element with class "title" and body in class "body"; wrap them in an element with class "text-box" that has a fixed max height — if text doesn't fit, we shrink --type-scale for all slides together, so design for the longest text.
7. Illustrations: each slide has one illustration image (square, no text, drawn separately in the brand style). Place it with <img class="art" src="__SLIDE_IMAGE_N__"> in the same slot on every content slide (object-fit: cover or contain, your call). The cover may give it more room. Never put text over a busy part of an illustration.
8. Keep ≥64px margins; nothing touches or crosses a slide edge.
9. No JavaScript, no external resources other than the illustration tokens.

Return two fenced blocks: first \`\`\`json {"illustrations": ["<English prompt for slide 1's illustration>", ...]}\`\`\` (one per slide — a concrete visual idea for that slide's message, in the visual language; NO text, letters or numbers in it), then \`\`\`html ...\`\`\`.`

function briefText(b: CarouselBrief): string {
  const fonts = b.fonts.length
    ? b.fonts.map((f) => `- "${f.family}"`).join("\n")
    : '- (no brand font set — use "Rubik" for headings and "Heebo" for body)'
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
  ].join("\n")
}

function parse(text: string, count: number): { html: string; illustrations: string[] } {
  const json = /```json\s*([\s\S]*?)```/i.exec(text)
  const html = /```html\s*([\s\S]*?)```/i.exec(text)
  if (!html || !/class=["'][^"']*\bslide\b/.test(html[1])) throw new Error("composition_invalid")
  let illustrations: string[] = []
  try {
    illustrations = (JSON.parse(json?.[1] ?? "{}") as { illustrations?: string[] }).illustrations ?? []
  } catch {
    illustrations = []
  }
  return { html: html[1].trim(), illustrations: Array.from({ length: count }, (_, i) => illustrations[i] ?? "") }
}

async function ask(apiKey: string, user: string, count: number) {
  const client = new Anthropic({ apiKey })
  const message = await client.messages
    .stream({ model: MODEL, max_tokens: 20000, system: SYSTEM, messages: [{ role: "user", content: user }] })
    .finalMessage()
  return parse(message.content.map((c) => (c.type === "text" ? c.text : "")).join(""), count)
}

export function composeCarousel(apiKey: string, brief: CarouselBrief) {
  return ask(apiKey, briefText(brief), brief.slides.length)
}

/**
 * Her instruction applied to the layout. Returns the revised HTML and, for
 * slides whose ILLUSTRATION she asked to change, a new prompt (empty string =
 * keep the current illustration).
 */
export function reviseCarousel(apiKey: string, stored: StoredCarousel, instruction: string) {
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
      "She wants this change now (Hebrew). Carry it out fully and precisely — this is the most important thing. Keep everything she didn't ask to change, and keep the carousel one consistent system:",
      JSON.stringify(instruction),
      "",
      'In the json block, "illustrations" has one entry per slide: a NEW prompt only for slides whose illustration she asked to change, otherwise an empty string.',
      "Return the full revised HTML.",
    ].join("\n"),
    stored.brief.slides.length,
  )
}

/** Illustration prompt for the image model — art only, never text. */
export function illustrationPrompt(idea: string, slide: SlideData, styleLines: string[]): string {
  return [
    "A square illustration for one slide of an Instagram carousel. It will be placed inside a designed layout next to the text, so it must contain NO text at all — no letters, words, numbers, captions, labels or signage.",
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
 * composition's CSS: headings get her first brand font, everything else her
 * second (or the first again). Rubik / Heebo remain only as glyph fallbacks.
 */
function fontEnforcement(fonts: BrandFont[]): string {
  if (!fonts.length) return ""
  const head = JSON.stringify(fonts[0].family)
  const body = JSON.stringify((fonts[1] ?? fonts[0]).family)
  return `<style>
:root{--font-head:${head},"Rubik",sans-serif;--font-body:${body},"Heebo","Rubik",sans-serif}
.slide,.slide .body,.slide p,.slide li,.slide span:not(.title *){font-family:var(--font-body)!important}
.slide .title,.slide .title *,.slide h1,.slide h2,.slide h3{font-family:var(--font-head)!important}
.slide .num{font-family:var(--font-body)!important}
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
    page = page.split(IMAGE_TOKEN(i)).join(url)
  })
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
