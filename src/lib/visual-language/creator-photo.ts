import type { VisualFormat, VisualLanguage } from "@/lib/visual-language/types"

/**
 * Bug (Nataliya, 2026-11-09): "ג'נרוט עם AI הוא לא משתמש בתיקיית תמונות הוא
 * ממציא פרצופים". Her analysed language reads "a full-bleed lifestyle
 * photograph of a woman… the subject's face visible" — and the image model,
 * given no photo of her, drew a stranger. Two rules fix it:
 *
 * 1. NO_INVENTED_PEOPLE rides on every AI direction (lib/visual-language/
 *    direction): no model ever draws a person who isn't in a picture of hers.
 * 2. When her language is built on a photo of a person (this check) and she
 *    connected a Drive folder, the new media panel's "השפה הויזואלית שלך"
 *    takes a photo of hers from that folder, with the script's text in front
 *    of it — her picture is the background (lib/feature-access iron rule 1).
 */

export const NO_INVENTED_PEOPLE =
  "PEOPLE — never invent a person. No human face, figure or body anywhere in the image (no photo, render or illustration of anyone), even where the language above describes a person, a woman, a man or the creator herself: a made-up face reads as hers. Where the language calls for a photo of a person, use the same kind of scene, light and mood with no one in it (objects, a place, texture) or the language's graphic devices instead. The only people allowed are those in a picture attached as the creator's own picture to place."

// A person in the photo the language is built on.
const PERSON =
  /\b(wom[ae]n|m[ae]n|girl|boy|person|people|lady|face|faces|portrait|selfie|subject's face|herself|himself|the creator in|headshot|model posing)\b/i

// "no people", "without a person", "never show faces or people" — a language
// that rules people out is not a photo-of-her language.
const NOUN = String.raw`(?:wom[ae]n|m[ae]n|girls?|boys?|persons?|people|lady|faces?|portraits?|selfies?|humans?|figures?)`
const NEGATED = new RegExp(
  String.raw`\b(?:no|without|never|not|avoid(?:ing)?)\s+(?:any\s+|a\s+|an\s+|show(?:ing)?\s+|human\s+)*${NOUN}(?:\s*(?:,|or|and|nor)\s*(?:any\s+|human\s+)*${NOUN})*\b`,
  "gi",
)

/** Does her language (overall, or for this format) show a person in a photo? */
export function languageShowsPerson(
  vl: Pick<VisualLanguage, "status" | "style_spec" | "formats"> | null | undefined,
  format: VisualFormat,
): boolean {
  if (!vl || vl.status !== "ok") return false
  const text = [vl.style_spec ?? "", vl.formats?.[format] ?? ""].join("\n").replace(NEGATED, " ")
  return PERSON.test(text)
}
