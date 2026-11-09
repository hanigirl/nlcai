import { canOwnMediaText } from "@/lib/feature-access"
import type { DesignDirection } from "@/lib/visual-language/direction"

/**
 * Bug (Nataliya, 2026-11-09): "ג'נרוט עם AI הוא לא משתמש בתיקיית תמונות הוא
 * ממציא פרצופים". Her analysed language reads "a full-bleed lifestyle
 * photograph of a woman… the subject's face visible", and the image model,
 * with no photo of her, drew a stranger on every slide.
 *
 * Hani's rule: "השפה הויזואלית שלך" never puts a person in the design on its
 * own. A person may appear only when someone asks for one explicitly (a
 * separate decision; these accounts have no AI chat). So on this path the
 * image model is told to draw no one, in every format. Nothing is fetched or
 * attached: no photo, no Drive.
 *
 * Gated (Hani + Nataliya, canOwnMediaText) and only for her own language
 * (source "brand"); regular users' generation is unchanged.
 */

export const NO_PERSON_LINE =
  "PEOPLE — show NO person at all: no human face, figure, body, hands or silhouette (no photo, render or illustration of anyone), even where the visual language above describes a person, a woman, a man or the creator herself — a made-up face would read as hers. Keep the same kind of scene, light, palette and mood with no one in it (objects, a place, texture), or use the language's graphic devices instead."

/** Her language, with "no person" added — on the gated visual-language path only. */
export function withNoInventedPeople(
  direction: DesignDirection,
  email: string | null | undefined,
): DesignDirection {
  if (!canOwnMediaText(email) || direction.source !== "brand") return direction
  return { ...direction, lines: [...direction.lines, "", NO_PERSON_LINE] }
}
