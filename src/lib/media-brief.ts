import type { DesignDirection } from "@/lib/visual-language/direction"

/**
 * "Think first, then generate" (Hani, 2026-11-05): before an AI media
 * generation she can give the AI her own direction for THIS piece — what she
 * already has in mind — instead of generating from her visual language and
 * fixing afterwards. The brief travels with the generate request and goes
 * into the model's design direction, so every downstream prompt sees it (the
 * image prompt, the story frames, the carousel layout + illustrations, the
 * b-roll background and its motion design).
 */

/** Long enough for a real paragraph; short enough not to drown the prompt. */
export const MAX_MEDIA_BRIEF = 600

/** What a generation started from the AI panel resolves to. */
export type MediaGenResult = { ok: true } | { ok: false; message: string }

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
