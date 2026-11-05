import path from "path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildCompositionBrief } from "@/lib/broll-animation/brief"
import { BACKGROUND_TOKEN, composeBRoll, finalizeHtml, type CompositionBrief } from "@/lib/broll-animation/compose"
import { renderOverlayFrames } from "@/lib/broll-animation/render"
import { resolveDesignDirection } from "@/lib/visual-language/direction"
import type { CaptionSpec } from "@/lib/own-media"

/**
 * The caption on HER OWN video, animated (Hani, 2026-11-06): the AI edit of a
 * clip she brought used to burn one still plate — white Rubik on a black
 * pill, faded in — whatever her brand. Now the words are written as a motion
 * design by the same Opus engine as the AI b-roll: her fonts and colours (her
 * visual language, else her niche's), word-by-word entrances, emphasis on
 * the key words, a plate or shadow for legibility, inside the platform's
 * safe zone. It is rendered as a TRANSPARENT layer and laid over her
 * untouched footage — her video itself is never repainted.
 *
 * Her own words in the chat (CaptionSpec.design, position, colours, size)
 * override every default.
 */

/** How long the entrance runs; the last frame then holds to the end of her clip. */
export const OVERLAY_SECONDS = 3

/** A 1×1 transparent PNG — the "background" of a layer that sits over her footage. */
// Fully transparent (alpha 0). The placeholder used before carried alpha
// 127 and, stretched over the frame, tinted her whole video blue — caught on
// the first live test (2026-11-06).
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=="

/** Where her clip goes: a story / reel (9:16), or a carousel video slide (4:5, the middle 1350px of this 1920px page). */
export type OwnVideoFormat = "story" | "b_roll" | "carousel"

function notes(format: OwnVideoFormat): string[] {
  return [
    "- THE BACKGROUND IS THE CREATOR'S OWN VIDEO. It is composited UNDER this page afterwards, untouched. The background token here is a fully transparent image: keep it in the document, but paint NOTHING over the whole frame — no full-frame fills, gradients, scrims, vignettes, colour washes or blend modes. The page must stay transparent everywhere except the text and what belongs to it (its plate / pill / highlight / shadow / small accents).",
    "- You cannot see the footage, so assume it is busy and changes: every line needs its own contrast — a solid or semi-solid plate / pill behind it in the brand colours, or a strong shadow — never text straight on the video.",
    "- It reads like a premium caption, not a poster: the words take about a third of the frame at most, and the footage stays the hero.",
    "- Motion: per-word (or per-line) entrances with a clear rhythm, one emphasis on the most important word or phrase (her accent colour, a highlight, a scale pop). EVERYTHING has arrived and is still by 2.5s — only the first 3 seconds are rendered and the last frame then holds for the rest of her clip (we fade it out at the very end).",
    "- Keep the text clear of where a face or the speaker's head usually is in a talking video (the upper and middle part of the frame, around the centre): prefer the lower third of the safe area, unless her own instruction places it elsewhere.",
    format === "carousel"
      ? "- CAROUSEL SLIDE (4:5): only the middle 1350px of this 1920px-tall page is kept — the top 285px and bottom 285px are cut away. Keep ALL text between 345px from the top and 345px from the bottom, ≥80px from the sides."
      : format === "story"
      ? "- INSTAGRAM STORY safe zone: keep all text between 270px from the top and 460px from the bottom, ≥80px from the sides."
      : "- INSTAGRAM REELS safe zone: keep all text between 220px from the top and 420px from the bottom, ≥80px from the sides (the right side also holds the like / comment buttons — keep text off the right 160px below the middle).",
  ]
}

/** Her structured caption choices (from the plan) as a design instruction. */
function specLines(spec: CaptionSpec): string[] {
  const out: string[] = []
  if (spec.position) {
    out.push(
      `Place the caption block in the ${spec.position === "center" ? "middle" : spec.position} of the safe area.`,
    )
  }
  if (spec.style?.text) out.push(`Text colour ${spec.style.text}.`)
  if (spec.style?.pill === "none") out.push("No plate / pill behind the text — use a strong shadow for contrast instead.")
  else if (spec.style?.pill) out.push(`Plate / pill colour behind the text: ${spec.style.pill}.`)
  if (spec.style?.scale && spec.style.scale !== 1) {
    out.push(spec.style.scale > 1 ? "Make the text noticeably bigger than usual." : "Make the text noticeably smaller than usual.")
  }
  return out
}

/**
 * The animated caption layer as PNG frames in `dir` (f0000.png…). Returns the
 * frame count. Throws when the composition can't be made — the caller then
 * falls back to the still plate.
 */
export async function renderOwnVideoCaption(
  supabase: SupabaseClient,
  userId: string,
  anthropicKey: string,
  format: OwnVideoFormat,
  spec: CaptionSpec,
  dir: string,
): Promise<number> {
  const hook = (spec.headline || spec.body || "").trim()
  if (!hook) throw new Error("caption_empty")
  const rest = spec.headline && spec.body ? spec.body : undefined
  // Her visual language, else her niche's — no reference images (nothing is drawn but text).
  const direction = await resolveDesignDirection(supabase, userId, { format, allowReferences: false })
  const base = await buildCompositionBrief(supabase, userId, { hook, rest }, direction.lines, undefined)
  const design = [...specLines(spec), spec.design?.trim()].filter(Boolean).join("\n")
  const brief: CompositionBrief = {
    ...base,
    cta: null,
    notes: notes(format),
    ...(design ? { design } : {}),
  }
  const template = await composeBRoll(anthropicKey, brief, 0)
  if (!template.includes(BACKGROUND_TOKEN)) throw new Error("composition_invalid")
  const frames = await renderOverlayFrames(finalizeHtml(template, TRANSPARENT_PNG, brief.fonts), OVERLAY_SECONDS, dir)
  // Her footage stays the hero: a layer that paints over much of the frame
  // (a wash, a full-screen gradient) is not a caption. Then the still plate
  // is used instead (the caller falls back on any throw).
  const covered = await overlayCoverage(path.join(dir, `f${String(frames - 1).padStart(4, "0")}.png`))
  if (covered > MAX_COVERAGE) throw new Error(`overlay_covers_footage:${covered.toFixed(2)}`)
  return frames
}

/** At most this share of the frame may be covered by the caption layer. */
export const MAX_COVERAGE = 0.35

/**
 * Share of the frame the layer visibly touches (alpha over ~8%) — so a faint
 * full-frame tint counts as covering her footage, not only solid shapes.
 */
export async function overlayCoverage(pngPath: string): Promise<number> {
  const sharp = (await import("sharp")).default
  const { data, info } = await sharp(pngPath).ensureAlpha().extractChannel(3).resize(108, 192, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true })
  let on = 0
  for (let i = 0; i < data.length; i++) if (data[i] > 20) on++
  return on / (info.width * info.height)
}
