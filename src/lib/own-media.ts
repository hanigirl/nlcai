import { isDriveUrl } from "@/lib/drive-media"

/**
 * Media she brought herself — from Google Drive, or pulled into our storage
 * from there — as opposed to media the AI made.
 *
 * The rule for her own media (Hani, 2026-10-29): the AI may ADD on top of it
 * or TAKE AWAY from it — the caption, extra AI slides, the order of frames —
 * but never touch what she filmed or photographed. Media the AI made keeps
 * the full "repaint it" AI edit.
 *
 * Told apart by where the file lives, which every ingest path already fixes:
 *   - a Drive link                              → hers
 *   - user-media/<uid>/video/…, …/image/…       → hers (from-drive, uploads,
 *                                                 and our captioned renders of
 *                                                 her files: burned-*, captioned-*)
 *   - user-media/<uid>/story/…, …/image_post/…,
 *     …/image-candidates/…, …/b_roll/…          → made here by the AI
 *   - user-media/<uid>/carousel/…               → either; the carousel is
 *                                                 judged by its stored meta /
 *                                                 Drive links instead.
 */
export function isOwnMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (isDriveUrl(url)) return true
  return /\/user-media\/[^/]+\/(video|image)\//.test(url)
}

/** Our caption burned into her file: the video burn, or the still render. */
export function isCaptionedRenderUrl(url: string | null | undefined): boolean {
  return !!url && /\/user-media\/[^/]+\/(video\/burned-[^/]+\.mp4|image\/captioned-[^/]+\.png)/.test(url)
}

export function isVideoMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (isDriveUrl(url)) return true
  return /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url)
}

/* ------------------------------ captions -------------------------------- */

export type OwnCaptionPosition = "top" | "center" | "bottom"

/** The few things the caption renderer can change about the look. */
export interface CaptionStyle {
  /** Background behind the words: a #hex colour, or "none" for no box. */
  pill?: string
  /** Colour of the words, #hex. */
  text?: string
  /** Size relative to the default, 0.6–1.5. */
  scale?: number
}

export interface CaptionSpec {
  headline?: string
  body?: string
  position?: OwnCaptionPosition
  style?: CaptionStyle
}

/**
 * Stored next to every captioned render (`<render path>.json`): the file it
 * was drawn over and what was drawn. With it a caption can be rewritten,
 * moved or taken off without stacking a second one on top.
 */
export interface CaptionRecord {
  v: 1
  /** The file as she brought it, before any words. */
  sourceUrl: string
  caption: CaptionSpec
}

const HEX = /^#[0-9a-f]{6}$/i

/** Keep only values the renderer understands. */
export function cleanCaptionStyle(style: unknown): CaptionStyle | undefined {
  if (!style || typeof style !== "object") return undefined
  const s = style as Record<string, unknown>
  const out: CaptionStyle = {}
  if (typeof s.pill === "string" && (s.pill === "none" || HEX.test(s.pill))) out.pill = s.pill
  if (typeof s.text === "string" && HEX.test(s.text)) out.text = s.text
  if (typeof s.scale === "number" && Number.isFinite(s.scale)) out.scale = Math.min(1.5, Math.max(0.6, s.scale))
  return Object.keys(out).length ? out : undefined
}

export function cleanCaptionSpec(spec: unknown): CaptionSpec | null {
  if (!spec || typeof spec !== "object") return null
  const s = spec as Record<string, unknown>
  const headline = typeof s.headline === "string" ? s.headline.trim() : ""
  const body = typeof s.body === "string" ? s.body.trim() : ""
  const position =
    s.position === "top" || s.position === "center" || s.position === "bottom" ? s.position : undefined
  return {
    headline: headline || undefined,
    body: body || undefined,
    position,
    style: cleanCaptionStyle(s.style),
  }
}

/* ----------------------------- the plan --------------------------------- */

/**
 * What the AI may do to her own media. Every op is carried out by code that
 * already exists (the caption burn, the still caption render, the set save);
 * only `add_slide` makes new pixels, and those are a NEW frame, never hers.
 * Frame numbers are 1-based, as she says them.
 */
export type OwnEditOp =
  | { op: "set_caption"; frames: number[]; headline?: string; body?: string; position?: OwnCaptionPosition; style?: CaptionStyle }
  | { op: "remove_caption"; frames: number[] }
  | { op: "add_slide"; after: number; headline?: string; body?: string; role?: "closing" | "content" | "cover" }
  | { op: "remove_slide"; frames: number[] }
  | { op: "duplicate_slide"; frame: number }
  | { op: "reorder"; order: number[] }

export interface OwnEditPlan {
  /** One short Hebrew line for the panel: what was done, or why not. */
  reply: string
  ops: OwnEditOp[]
  /** She asked for something that would change her own pixels. */
  refused?: boolean
}

/** What the plan route knows about one frame, handed back to the executor. */
export interface OwnFrameInfo {
  url: string
  kind: "image" | "video"
  /** Made by the AI (an added slide) — not hers. */
  aiMade: boolean
  /**
   * ours     — our caption, and we know the original under it
   * ours-legacy — our caption, but the original wasn't kept (older renders)
   * none     — bare, no words on it
   * baked    — her own design already has its words in it
   * unknown  — couldn't tell (video, or the check failed)
   */
  caption: "ours" | "ours-legacy" | "none" | "baked" | "unknown"
  record?: CaptionRecord
}

export type OwnEditFormat = "story" | "carousel" | "image_post" | "b_roll"

/** Formats that are a SET (frames can be added, removed, reordered). */
export function isSetFormat(format: OwnEditFormat): boolean {
  return format === "story" || format === "carousel"
}
