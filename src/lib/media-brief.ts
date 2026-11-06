import type { DesignDirection } from "@/lib/visual-language/direction"
import type { ModelImage } from "@/lib/visual-language/image-input"

/**
 * "Think first, then generate" (Hani, 2026-11-05): before an AI media
 * generation she can give the AI her own direction for THIS piece — what she
 * already has in mind — instead of generating from her visual language and
 * fixing afterwards. The brief travels with the generate request and goes
 * into the model's design direction, so every downstream prompt sees it (the
 * image prompt, the story frames, the carousel layout + illustrations, the
 * b-roll background and its motion design).
 *
 * With "חדש לגמרי" (style "blank", 2026-11-05) the brief is the whole
 * direction: the visual language, colours, fonts and elements are left out.
 */

/** Long enough for a real paragraph; short enough not to drown the prompt. */
export const MAX_MEDIA_BRIEF = 600

/**
 * "חדש לגמרי" (style "blank") is designed from the brief alone — without one
 * there is nothing to design from, so the routes refuse it with this.
 */
export const BLANK_NEEDS_BRIEF = {
  error: "blank_needs_brief",
  message: "כדי להתחיל מדף חלק, ספרו קודם איך תרצו להתחיל.",
} as const

/** What a generation started from the AI panel resolves to. */
export type MediaGenResult =
  | {
      ok: true
      /** Said instead of the usual "ready" line (e.g. a video slot that didn't make it). */
      message?: string
    }
  | { ok: false; message: string }

/** The brief from a request body — trimmed and capped, or undefined. */
export function normalizeMediaBrief(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const brief = raw.trim().slice(0, MAX_MEDIA_BRIEF)
  return brief || undefined
}

/**
 * Her direction on top of the visual language: it wins where they conflict,
 * the language fills in the rest, and the required text never changes.
 */
export function withMediaBrief(direction: DesignDirection, brief: string | undefined): DesignDirection {
  if (!brief) return direction
  return {
    ...direction,
    lines: [
      ...direction.lines,
      "",
      "THE CREATOR'S OWN DIRECTION FOR THIS PIECE (hard rule — where it conflicts with the visual language above, follow it; keep everything else from the visual language). It never changes, adds or removes the required text: the exact lines stay as given. If this image carries no text, apply only what it says about the look. Written in Hebrew:",
      `"""${brief}"""`,
    ],
  }
}

/**
 * References she attached with the brief (lib/ai-edit-references — parsed by
 * the route with parseReferences). The image model gets them as reference
 * images after any of hers; every prompt that reads the direction lines is
 * told what they are: a visual reference for the look, never content.
 * Claude steps (b-roll motion, carousel layout) get them as referenceBlocks.
 */
export function withMediaReferences(direction: DesignDirection, refs: string[]): DesignDirection {
  if (!refs.length) return direction
  const images = refs.flatMap((r): ModelImage[] => {
    const m = r.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/)
    return m ? [{ mediaType: m[1] as ModelImage["mediaType"], base64: m[2] }] : []
  })
  return {
    ...direction,
    references: [...direction.references, ...images],
    lines: [
      ...direction.lines,
      "",
      `THE CREATOR'S REFERENCE IMAGE${refs.length > 1 ? "S" : ""} (${refs.length}, attached${direction.references.length ? " after her brand elements" : ""}): she chose ${refs.length > 1 ? "them" : "it"} to show the look she wants for this piece. Use ${refs.length > 1 ? "them" : "it"} as visual reference only — palette, mood, composition, imagery and type character. NEVER copy any text, words, numbers, logos, faces or people from ${refs.length > 1 ? "them" : "it"} into this piece; the only text is the exact text given for this post.`,
    ],
  }
}

/**
 * "התמונה תכנס ביצירה הראשונה אם שמתי אותה כרפרנס" (Hani, 2026-11-05): an
 * image she attached in the AI panel's first question is HER picture, and the
 * first generation puts that very picture in — the same "use, don't redraw"
 * as the AI edit (api/media/ai-edit). A picture pulled from a link stays a
 * look reference (withMediaReferences).
 *
 * Appended after the references already numbered in the direction lines, and
 * named by number, so the model knows which inputs are hers to reproduce.
 * Callers generate with `strict` (lib/openai-image) and check the result
 * (lib/placed-check) — never a silent stand-in.
 */
export function withPlacedImages(direction: DesignDirection, placed: ModelImage[]): DesignDirection {
  if (!placed.length) return direction
  const first = direction.references.length + 1
  const last = first + placed.length - 1
  const which = placed.length === 1 ? `Reference image ${first} is` : `Reference images ${first}–${last} are`
  return {
    ...direction,
    references: [...direction.references, ...placed],
    lines: [
      ...direction.lines,
      "",
      `${which} THE CREATOR'S OWN PICTURE${placed.length > 1 ? "S" : ""} TO PLACE IN THIS DESIGN (hard rule): put ${placed.length > 1 ? "each one" : "it"} into the design as a clearly visible element, reproduced exactly as it is — the same photo, character, illustration, logo or product: same shape, colours, details, face and proportions. Never redraw, restyle, recolour, re-imagine or replace it with a look-alike, and never crop away its subject. Lay the design out around it (it may be framed, masked to a shape or given a shadow in the visual language). It never covers the required text.`,
    ],
  }
}

/** The first generation couldn't put her picture in: nothing is saved, and the panel says so. */
export const PLACE_FAILED_GEN = {
  error: "place_failed",
  message:
    "לא הצלחתי להכניס את התמונה ששלחתם, אז לא שמרתי כלום ולא שמתי במקומה תמונה אחרת. נסו שוב, ואפשר לכתוב איפה בדיוק לשים אותה.",
} as const
