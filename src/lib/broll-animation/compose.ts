import Anthropic from "@anthropic-ai/sdk"

/**
 * B-roll text animation, written by Claude Opus (Hani, 2026-10-22).
 *
 * The static caption plate is gone. The hook and "קראו בתיאור" are now an
 * animation Opus composes freely — HTML + CSS / Web Animations / GSAP — in the
 * creator's own fonts and brand colours, over the generated background. Hani
 * asked for it to be "as close as generating it in the Claude app with Opus",
 * so the brief constrains only what the renderer needs to turn it into an MP4
 * (fixed canvas, time-seekable, no randomness) and the text that must appear
 * verbatim. Everything about the look and the motion is Opus's call.
 *
 * The same composition is what "עריכה עם AI" edits: we keep the HTML next to
 * the clip and hand it back to Opus with her instruction.
 */

export const BROLL_MODEL = "claude-opus-5-5"

export const COMPOSITION_WIDTH = 1080
export const COMPOSITION_HEIGHT = 1920
export const COMPOSITION_SECONDS = 7

/** Replaced with the background image URL at render time. */
export const BACKGROUND_TOKEN = "__BROLL_BACKGROUND__"

/** GSAP is allowed; pinned so a composition renders the same next year. */
const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"

export type FontRole = "primary" | "secondary"

/**
 * One of her fonts. `role` comes from Settings → Media → Fonts (Hani,
 * 2026-10-22): the primary carries the design; the secondary is an accent and
 * must never take it over.
 */
export type BrandFont = (
  | { kind: "file"; family: string; url: string }
  | { kind: "google"; family: string }
) & { role?: FontRole }

/** Prompt lines describing her fonts by role. */
export function fontRoleLines(fonts: BrandFont[]): string {
  return fonts
    .map((f) =>
      f.role === "secondary"
        ? `- "${f.family}" — SECONDARY: sparing accents only (a short teaser line, one highlighted word). Never headlines, never body paragraphs.`
        : `- "${f.family}" — PRIMARY: headlines, body, numbers — essentially all text.`,
    )
    .join("\n")
}

export interface CompositionBrief {
  hook: string
  /** Extra script lines under the hook, if any. */
  rest?: string
  /** "קראו בתיאור" — null when the script already sends viewers there. */
  cta: string | null
  /** Hex colours, priority order. */
  palette: { hex: string; role: string }[]
  fonts: BrandFont[]
  /** The visual-language brief the background was generated from. */
  styleSpec: string
  /**
   * What this clip is for, when it isn't a b-roll — e.g. a frame added to
   * her story (lib/own-media-animated): its safe zone, reserved brand areas.
   */
  notes?: string[]
  /**
   * The creator's own words about the look (Hebrew ok), e.g. "בלי הרקע
   * הבומבסטי הלבן, טקסט לבן פשוט". A hard instruction that wins over the
   * visual-language defaults; later lines win over earlier ones.
   */
  design?: string
}

/** Her design wording as a hard instruction block, or nothing. */
export function designOverrideLines(design: string | undefined): string[] {
  const d = design?.trim()
  if (!d) return []
  return [
    "THE CREATOR'S OWN DESIGN INSTRUCTION — HARD RULE, it wins over the visual language, the brand defaults and your own taste (background colour or no background, text colour, text size, motion style, plain vs. bombastic). Where lines conflict, the LATER line wins:",
    d,
  ]
}

/** The <head> fragment that loads her fonts. Injected by us, not written by Opus. */
export function fontHead(fonts: BrandFont[]): string {
  const google = fonts.filter((f) => f.kind === "google").map((f) => f.family)
  // Hebrew-capable fallbacks, always present.
  const families = [...google, "Rubik", "Heebo"]
  const googleLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800;900`)
    .join("&")}&display=block">`
  const faces = fonts
    .filter((f): f is Extract<BrandFont, { kind: "file" }> => f.kind === "file")
    .map(
      (f) =>
        `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(f.url)});font-display:block;}`,
    )
    .join("")
  return `${googleLink}${faces ? `<style>${faces}</style>` : ""}`
}

const SYSTEM = `You are a world-class motion designer who writes animations as code. You make short vertical social videos (Instagram Reels b-roll) for Hebrew-speaking creators.

You output ONE complete, self-contained HTML document. A headless browser renders it frame by frame into a ${COMPOSITION_SECONDS}-second, ${COMPOSITION_WIDTH}×${COMPOSITION_HEIGHT} MP4. Be bold and creative with typography and motion — kinetic type, per-word or per-letter reveals, masks, clip-paths, SVG, gradients, blend modes, shapes, light sweeps, whatever serves the hook. Design like a top agency, not like a template.

HARD RULES (the renderer depends on them):
1. Canvas: html/body exactly ${COMPOSITION_WIDTH}px × ${COMPOSITION_HEIGHT}px, margin 0, overflow hidden. No responsive units tied to the viewport for layout of the frame itself — use px.
2. The background image: use the URL token ${BACKGROUND_TOKEN} exactly as written (e.g. <img src="${BACKGROUND_TOKEN}"> or background-image:url('${BACKGROUND_TOKEN}')). It fills the frame (object-fit: cover). You may animate it (slow push-in, drift, parallax, colour treatment), never hide it entirely — unless THE CREATOR'S OWN DESIGN INSTRUCTION asks for a plain / solid / different background or no picture: then cover it with exactly what she asked for (keep the token in the document).
3. Motion must be TIME-SEEKABLE. Use only: CSS @keyframes / transitions started on load, the Web Animations API, or GSAP 3 loaded from <script src="${GSAP_URL}"></script> with every tween on the global timeline (gsap.to/from/timeline — no custom tickers). Everything starts at t=0 when the page loads. FORBIDDEN: setTimeout, setInterval, requestAnimationFrame loops, Date, performance.now, Math.random, fetch, video/audio elements, other external scripts.
4. The text must appear EXACTLY as given — same Hebrew words and order, no additions, no translation, no emoji. Hebrew is right-to-left: put dir="rtl" and lang="he" on <html>. If you split text into words/letters for animation, keep the visual reading order correct (RTL) and never split inside a Hebrew word into letters that would break final-letter forms or kerning badly — prefer per-word splitting.
5. Instagram covers the top ~220px and bottom ~380px with UI. Keep all text inside the safe area between them, with ≥80px side margins. Every element — decorative lines, underlines, shapes — stays fully inside the frame at every moment; nothing stray or cut off at an edge.
6. By t=${COMPOSITION_SECONDS - 1.5}s everything must have arrived and be fully legible, and it must HOLD — the last frame is used as the cover and gets screenshotted. No exit animations.
7. Legibility first: strong contrast between text and whatever is behind it at every moment (shadows, scrims, shapes or colour — your call).
8. Fonts: they are loaded for you in <head> (you'll see a marker to keep). Use the brand fonts by family name, by their role (the primary carries the text; a secondary font is only a small accent); Rubik / Heebo are Hebrew fallbacks. Do not add other font links.
9. If the brief has THE CREATOR'S OWN DESIGN INSTRUCTION, follow it exactly — it overrides the visual language and every stylistic default here (colours, sizes, background, how loud or quiet the motion is). Only rules 1, 3, 4, 5 and 6 above stay above it.

Return only the HTML document inside a single \`\`\`html code fence. Keep it tight (well under 300 lines).`

const FONT_MARKER = "<!--BRAND_FONTS-->"

function briefText(b: CompositionBrief): string {
  const fonts = b.fonts.length
    ? fontRoleLines(b.fonts)
    : "- (no brand font set — choose between Rubik and Heebo)"
  const palette = b.palette.length
    ? b.palette.map((p) => `- ${p.hex} — ${p.role}`).join("\n")
    : "- (no brand colours — derive a palette from the background and the visual language)"
  return [
    "TEXT (verbatim):",
    `- Hook (the hero, the first thing read): ${JSON.stringify(b.hook)}`,
    ...(b.rest ? [`- Supporting line (smaller, optional to animate subtly): ${JSON.stringify(b.rest)}`] : []),
    ...(b.cta
      ? [`- Call to action, arrives after the hook has been read (around 2–3s): ${JSON.stringify(b.cta)}`]
      : ["- No call-to-action line (the script already has one)."]),
    "",
    "BRAND FONTS:",
    fonts,
    "",
    "BRAND COLOURS:",
    palette,
    "",
    "VISUAL LANGUAGE (the background was generated from this — match its character):",
    b.styleSpec.slice(0, 2500),
    ...(b.notes?.length ? ["", "THIS CLIP:", ...b.notes] : []),
    ...(b.design?.trim() ? ["", ...designOverrideLines(b.design)] : []),
    "",
    `Put the marker ${FONT_MARKER} inside <head>; we replace it with the font loading.`,
  ].join("\n")
}

function extractHtml(text: string): string {
  const fenced = /```html\s*([\s\S]*?)```/i.exec(text)
  const html = (fenced ? fenced[1] : text).trim()
  if (!/<html[\s>]/i.test(html) || !html.includes(BACKGROUND_TOKEN)) {
    throw new Error("composition_invalid")
  }
  return html
}

/** Guard rails the prompt asks for, enforced — a broken frame clock ruins the render. */
function assertSeekable(html: string): void {
  if (/\b(setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now|new Date|performance\.now|fetch)\s*\(/.test(html)) {
    throw new Error("composition_not_seekable")
  }
}

async function ask(apiKey: string, user: string): Promise<string> {
  const client = new Anthropic({ apiKey })
  // Streamed: an Opus composition can run long, and the SDK refuses long
  // non-streaming requests.
  const message = await client.messages
    .stream({
      model: BROLL_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    })
    .finalMessage()
  const text = message.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("")
  const html = extractHtml(text)
  assertSeekable(html)
  return html
}

/** A fresh composition for this hook. `variation` nudges a re-press to a new idea. */
export async function composeBRoll(
  apiKey: string,
  brief: CompositionBrief,
  variation: number,
): Promise<string> {
  return ask(
    apiKey,
    [
      briefText(brief),
      "",
      variation > 0
        ? `This is attempt #${variation + 1} for the same post — take a clearly different typographic and motion idea from an obvious first take.`
        : "",
    ].join("\n"),
  )
}

/** Her instruction applied to the existing composition. */
export async function reviseBRoll(
  apiKey: string,
  brief: CompositionBrief,
  current: string,
  instruction: string,
): Promise<string> {
  return ask(
    apiKey,
    [
      briefText(brief),
      "",
      "CURRENT COMPOSITION:",
      "```html",
      current,
      "```",
      "",
      "The creator wants this change (in Hebrew — follow it precisely, keep everything she didn't ask to change):",
      JSON.stringify(instruction),
      "",
      "Return the full revised HTML document.",
    ].join("\n"),
  )
}

/** The stored template → a page the renderer can load. */
export function finalizeHtml(template: string, backgroundUrl: string, fonts: BrandFont[]): string {
  const head = fontHead(fonts)
  let html = template.split(BACKGROUND_TOKEN).join(backgroundUrl)
  html = html.includes(FONT_MARKER)
    ? html.replace(FONT_MARKER, head)
    : html.replace(/<head[^>]*>/i, (m) => `${m}${head}`)
  return html
}
