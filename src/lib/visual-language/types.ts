/**
 * Visual language — shared shapes (client + server).
 *
 * The user's three inputs (brand colours, graphic elements, design examples)
 * are analysed into ONE design brief that every AI image generator follows.
 * When she has none, a brief is derived from her niche instead, so stories
 * stop defaulting to the dark-neon-3D look regardless of who she is.
 */

export const MAX_BRAND_COLORS = 3
export const MAX_BRAND_ELEMENTS = 8
export const MAX_BRAND_EXAMPLES = 6

/** The media formats a visual language is adapted to. */
export type VisualFormat = "carousel" | "story" | "image_post" | "b_roll"

/** What kind of design each example is — the analysis decides. */
export type ExampleKind =
  | "carousel"
  | "story"
  | "feed_post"
  | "cover"
  | "website"
  | "banner"
  | "poster"
  | "other"

export const EXAMPLE_KIND_LABELS: Record<ExampleKind, string> = {
  carousel: "קרוסלה",
  story: "סטורי",
  feed_post: "פוסט",
  cover: "קאבר",
  website: "אתר",
  banner: "באנר",
  poster: "פוסטר",
  other: "אחר",
}

/** What the analysis concluded about her inputs. */
export interface VisualLanguage {
  /**
   * "ok" — a clear, unified language was found and generators follow it.
   * "inconsistent" — the inputs don't share one language; generators fall
   * back to the niche brief and Settings shows `issues_he`.
   */
  status: "ok" | "inconsistent"
  /** Short Hebrew description of the language, shown back to her. */
  summary_he: string
  /** Why it's inconsistent (Hebrew), empty when status is "ok". */
  issues_he: string[]
  /** English design brief handed verbatim to the image model. */
  style_spec: string
  /** The palette as the analysis understood it, in priority order. */
  palette: { hex: string; role: string }[]
  /** One line per element: how the image model may use it. */
  elements: { id: string; name: string; usage: string }[]
  /**
   * Per-format additions to style_spec (carousel slide structure, story
   * stacking…), learned from examples of that format when she gave some.
   * Optional: analyses saved before formats existed don't have it.
   */
  formats?: Partial<Record<VisualFormat, string>>
  /** What each example was recognised as, keyed by user_media id. */
  example_kinds?: { id: string; kind: ExampleKind }[]
  /** Colours for the carousel picker's mini-mock tile. */
  preview?: { bg: string; accent: string; title: string; body: string }
  /** Inputs the brief was made from — compared to detect stale analysis. */
  inputs_signature: string
  /** Links that could not be read and were skipped (shown as a note). */
  unreadable_links?: string[]
  analyzed_at: string
}

/** Fallback brief derived from the niche, cached until the niche changes. */
export interface NicheVisualLanguage {
  niche: string
  summary_he: string
  style_spec: string
  generated_at: string
}

export interface VisualLanguageInputs {
  colors: string[]
  elements: { id: string; description: string }[]
  examples: { id: string }[]
}

/**
 * Stable fingerprint of the inputs. Same function on both sides, so the
 * settings panel can tell her "you changed things since the last analysis"
 * without a round trip.
 */
export function visualLanguageSignature(inputs: VisualLanguageInputs): string {
  return JSON.stringify({
    c: inputs.colors.map((c) => c.toLowerCase()),
    e: [...inputs.elements]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => [e.id, e.description.trim()]),
    x: inputs.examples.map((x) => x.id).sort(),
  })
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}
