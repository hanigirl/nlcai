/**
 * "חיתוך" — she picks the part of her own picture that shows in a 4:5 image
 * post / carousel slide, mostly for a 9:16 upload (Hani, 2026-11-11). The
 * picture she uploaded stays as it is; the cut is a new 4:5 file beside it,
 * and a sidecar `<cut>.crop.json` remembers the original and where she put
 * the frame — so she can always cut again from the whole picture. A caption
 * on it is redrawn over the cut (its record then points at the cut, so a
 * later caption edit keeps her framing).
 *
 * `.crop.json`, not `.json`: the caption record's name — a cut is a bare
 * picture, never a captioned render.
 */

export interface PictureCrop {
  /** The frame's centre, as a share of the original's width / height (0..1). */
  cx: number
  cy: number
  /** 1 = the largest 4:5 frame that fits; up to MAX_ZOOM. */
  zoom: number
}

export interface CropRecord {
  v: 1
  kind: "crop"
  /** The picture she uploaded (or its Drive link). */
  sourceUrl: string
  crop: PictureCrop
}

export const CROP_ASPECT = 4 / 5
export const MAX_ZOOM = 4
export const CROP_OUT = { width: 1080, height: 1350 }

/**
 * A story frame is cut 9:16 (Hani, 2026-11-14, Notion "סטורי: Crop") — the
 * same editor and record, only the frame's shape and the output size change.
 */
export type CropShape = "4:5" | "9:16"
export const CROP_SHAPES: Record<CropShape, { aspect: number; out: { width: number; height: number } }> = {
  "4:5": { aspect: CROP_ASPECT, out: CROP_OUT },
  "9:16": { aspect: 9 / 16, out: { width: 1080, height: 1920 } },
}
export function cleanShape(v: unknown): CropShape {
  return v === "9:16" ? "9:16" : "4:5"
}

/** The frame in the original's pixels, kept inside it. */
export function cropRect(
  width: number,
  height: number,
  crop: PictureCrop,
  aspect: number = CROP_ASPECT,
): { left: number; top: number; width: number; height: number } {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom || 1))
  let w = width / height > aspect ? height * aspect : width
  let h = w / aspect
  w /= zoom
  h /= zoom
  const cx = Math.min(width - w / 2, Math.max(w / 2, (crop.cx ?? 0.5) * width))
  const cy = Math.min(height - h / 2, Math.max(h / 2, (crop.cy ?? 0.5) * height))
  return { left: Math.round(cx - w / 2), top: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) }
}

export function cleanCrop(v: unknown): PictureCrop | null {
  const c = v as Partial<PictureCrop> | null
  if (!c || ![c.cx, c.cy, c.zoom].every((n) => typeof n === "number" && Number.isFinite(n))) return null
  return {
    cx: Math.min(1, Math.max(0, c.cx!)),
    cy: Math.min(1, Math.max(0, c.cy!)),
    zoom: Math.min(MAX_ZOOM, Math.max(1, c.zoom!)),
  }
}

/** The centred frame — what the app showed before she cut. */
export const CENTRED: PictureCrop = { cx: 0.5, cy: 0.5, zoom: 1 }
