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
  const layers = await Promise.all(
    active.map(async (el) => {
      const box = elementBox(el, W, H)
      const input = await sharp(el.png)
        .resize({ width: box.width, height: box.height, fit: "fill" })
        .png()
        .toBuffer()
      return { input, left: box.left, top: box.top }
    }),
  )
  const out = await base.composite(layers).png().toBuffer()
  return out.toString("base64")
}
