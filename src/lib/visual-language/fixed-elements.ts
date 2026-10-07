import sharp from "sharp"
import type { ElementPlacement, ElementSlides } from "@/lib/visual-language/types"

/**
 * Fixed-position brand elements — pasted by code, not drawn by the model.
 *
 * Asked to "put my badge bottom-left", gpt-image redraws it on every slide
 * and it drifts: a little up here, a little right there. Hani, 2026-10-07:
 * it must sit in the same place, pixel perfect, on every slide. So the
 * prompt leaves that zone empty and this module composites her REAL file at
 * coordinates computed from the placement — identical on every slide.
 */

export interface FixedElement {
  name: string
  /** Her original file as PNG (keeps transparency). */
  png: Buffer
  aspect: number // height / width
  placement: ElementPlacement
  /**
   * Her own opposite-tone version (light artwork for dark slides, or the
   * reverse), uploaded in Settings. Preferred over the automatic one.
   */
  alt?: Buffer
  /** Alpha-weighted relative luminance of the artwork, 0 (black) – 1 (white). */
  luminance: number
  /** Contains a photo — automatic tone-flipping would wreck it. */
  photographic: boolean
}

/**
 * Below this WCAG-style contrast ratio between the element and the slide
 * under it, the element is swapped for its opposite-tone version.
 * 2.2 keeps a dark-indigo mark on a mid-blue cover (≈1.5) from vanishing
 * while leaving dark-on-white (≈10+) alone.
 */
const MIN_CONTRAST = 2.2

// Opaque pixel colours (5 bits/channel) above which artwork is treated as
// photographic. Flat logos/arrows/text land in the tens; a small portrait
// badge lands in the hundreds.
const PHOTO_COLOR_COUNT = 300

function linear(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Tone + photo detection for an element (run once when it's loaded). */
export async function measureElement(
  png: Buffer,
): Promise<{ luminance: number; photographic: boolean }> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const colors = new Set<number>()
  let lum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    if (a < 0.5) continue
    colors.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3))
    lum += a * relLuminance(data[i], data[i + 1], data[i + 2])
    weight += a
  }
  return {
    luminance: weight ? lum / weight : 0.5,
    photographic: colors.size > PHOTO_COLOR_COUNT,
  }
}

/**
 * Automatic opposite-tone version for flat artwork: pixels on the wrong side
 * are pushed to the other end of the lightness scale (dark → light, or light
 * → dark) while hue, saturation and transparency stay — dark-indigo arrows become pale lavender, black text
 * becomes white. Never used on photographic elements.
 */
export async function autoToneFlip(png: Buffer, toLight: boolean): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.from(data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const [h, sat, l] = rgbToHsl(out[i], out[i + 1], out[i + 2])
    // Push wrong-side pixels well across (dark 0.2 → 0.86, 0.35 → 0.81)
    // while keeping their relative order, so a gradient stays a gradient.
    // A plain mirror (1 - l) left mid-tones mid, still lost on mid-blue.
    const l2 = toLight ? (l < 0.6 ? 0.92 - l * 0.3 : l) : l > 0.4 ? 0.08 + (1 - l) * 0.3 : l
    const [r, g, b] = hslToRgb(h, sat, Math.min(0.97, Math.max(0.03, l2)))
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)]
}

/** Which part of a piece a single image is. */
export type ImageRole = "cover" | "content" | "closing" | "single"

export function appliesToRole(slides: ElementSlides, role: ImageRole): boolean {
  switch (slides) {
    case "all":
      return true
    case "cover":
      return role === "cover" || role === "single"
    case "content":
      return role === "content"
    case "closing":
      return role === "closing"
    case "not_cover":
      return role === "content" || role === "closing"
  }
}

/** Pixel box of an element on a W×H canvas. Margins are % of the width. */
export function elementBox(
  el: FixedElement,
  canvasW: number,
  canvasH: number,
): { left: number; top: number; width: number; height: number } {
  const p = el.placement
  const width = Math.round((p.width_pct / 100) * canvasW)
  const height = Math.round(width * el.aspect)
  const mx = Math.round((p.margin_x_pct / 100) * canvasW)
  const my = Math.round((p.margin_y_pct / 100) * canvasW)
  const left = p.anchor.endsWith("left")
    ? mx
    : p.anchor.endsWith("right")
      ? canvasW - mx - width
      : Math.round((canvasW - width) / 2)
  const top = p.anchor.startsWith("top") ? my : canvasH - my - height
  return { left, top, width, height }
}

/**
 * Prompt lines asking the model to keep each fixed element's zone empty.
 * Expressed in percentages of the frame so they hold whatever size the
 * model paints at; the zone is padded a little beyond the element itself.
 */
export function reservedZoneLines(
  fixed: FixedElement[],
  role: ImageRole,
  canvasW: number,
  canvasH: number,
): string[] {
  const active = fixed.filter((el) => appliesToRole(el.placement.slides, role))
  if (!active.length) return []
  return [
    "RESERVED AREAS — leave these completely EMPTY (only the plain background continues there: no text, no shapes, no imagery, and do NOT draw these elements yourself). The creator's real brand elements are placed into them afterwards, at exactly the same spot on every slide:",
    ...active.map((el) => {
      const b = elementBox(el, canvasW, canvasH)
      const pad = 0.02
      const x0 = Math.max(0, b.left / canvasW - pad)
      const x1 = Math.min(1, (b.left + b.width) / canvasW + pad)
      const y0 = Math.max(0, b.top / canvasH - pad)
      const y1 = Math.min(1, (b.top + b.height) / canvasH + pad)
      const pct = (v: number) => `${Math.round(v * 100)}%`
      return `- ${el.name} (${el.placement.anchor}): the box from ${pct(x0)} to ${pct(x1)} of the width (measured from the LEFT edge) and from ${pct(y0)} to ${pct(y1)} of the height (measured from the TOP).`
    }),
  ]
}

/** Paste the fixed elements that belong on this image. Returns PNG base64. */
export async function applyFixedElements(
  pngBase64: string,
  fixed: FixedElement[],
  role: ImageRole,
): Promise<string> {
  const active = fixed.filter((el) => appliesToRole(el.placement.slides, role))
  if (!active.length) return pngBase64
  const base = sharp(Buffer.from(pngBase64, "base64"))
  const { width: W = 0, height: H = 0 } = await base.metadata()
  const baseBuf = Buffer.from(pngBase64, "base64")
  const layers = await Promise.all(
    active.map(async (el) => {
      const box = elementBox(el, W, H)
      const art = await pickVariant(el, baseBuf, box)
      const input = await sharp(art)
        .resize({ width: box.width, height: box.height, fit: "fill" })
        .png()
        .toBuffer()
      return { input, left: box.left, top: box.top }
    }),
  )
  const out = await base.composite(layers).png().toBuffer()
  return out.toString("base64")
}

/**
 * The version of an element that stays visible on this slide: the original
 * when it contrasts with the background under it; otherwise her uploaded
 * opposite-tone version, else an automatic one (flat artwork only).
 */
async function pickVariant(
  el: FixedElement,
  slide: Buffer,
  box: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const { channels } = await sharp(slide)
    .extract({
      left: Math.max(0, box.left),
      top: Math.max(0, box.top),
      width: box.width,
      height: box.height,
    })
    .stats()
  const bg = relLuminance(channels[0].mean, channels[1].mean, channels[2].mean)
  if (contrast(bg, el.luminance) >= MIN_CONTRAST) return el.png
  if (el.alt) return el.alt
  if (el.photographic) {
    console.warn(`[fixed-elements] "${el.name}" is low-contrast here and has no uploaded alternate version`)
    return el.png
  }
  // Go light on a dark background, dark on a light one.
  return autoToneFlip(el.png, bg < 0.4)
}

