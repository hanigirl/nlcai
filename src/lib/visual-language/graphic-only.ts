import { canOwnMediaText } from "@/lib/feature-access"
import type { DesignDirection } from "@/lib/visual-language/direction"

/**
 * Bug (Nataliya, 2026-11-09): "ג'נרוט עם AI הוא לא משתמש בתיקיית תמונות הוא
 * ממציא פרצופים". Her analysed language reads "a full-bleed lifestyle
 * photograph of a woman… the subject's face visible", and the image model,
 * with no photo of her, drew a stranger on every slide.
 *
 * Hani's rule: "השפה הויזואלית שלך" never makes a photo — with or without a
 * person. It makes only the graphic elements of her language (backgrounds,
 * shapes, colours, typography, icons, decorative elements), laid out like her
 * examples, in her brand colours and fonts. A picture comes only when she asks
 * for one and brings the reference herself (not built yet). Nothing is
 * fetched or attached here: no photo, no Drive.
 *
 * Gated (Hani + Nataliya, canOwnMediaText) and only for her own language
 * (source "brand"); regular users' generation is unchanged.
 */

export const GRAPHIC_ONLY_LINE =
  "GRAPHIC ONLY — NO PHOTOGRAPHS (this overrides anything above, including the attached examples): the piece contains no photo and no photographic or photorealistic image of anything — no people, faces, figures or hands, no places, rooms, objects, food, nature or scenes, no photo textures. Build it ONLY from the graphic elements of the creator's visual language: backgrounds (solid or gradient in her brand colours), shapes, colour blocks, typography, icons and decorative elements, laid out the way her examples are composed, in her brand colours and fonts. Wherever the language describes a photograph (a full-bleed photo, an overlay on a photo, a subject in frame), replace it with a background in her brand colours plus her graphic devices."

/** Her language, graphics only — on the gated visual-language path. */
export function withGraphicOnly(direction: DesignDirection, email: string | null | undefined): DesignDirection {
  if (!canOwnMediaText(email) || direction.source !== "brand") return direction
  return { ...direction, lines: [...direction.lines, "", GRAPHIC_ONLY_LINE] }
}
