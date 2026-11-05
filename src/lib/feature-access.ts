/**
 * "התמונה תכנס ביצירה הראשונה אם שמתי אותה כרפרנס" (Hani, 2026-11-05): an
 * image attached in the AI panel's first question is put INTO the first
 * generation as it is (lib/media-brief withPlacedImages, lib/placed-check).
 * Hani only while she tries it. Everyone else gets exactly what they had:
 * every attached image is a look reference — no strict mode, no check.
 * Enforced on the server (the four generate routes), not only in the panel.
 */
export const REF_PLACE_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canPlaceRefs(email: string | null | undefined): boolean {
  return !!email && REF_PLACE_EMAILS.includes(email.toLowerCase())
}

/**
 * The generate routes' split: her pictures to place, and look references.
 * Off the gate, pictures sent to place are looks like the rest — as before.
 */
export function gatePlacement(
  email: string | null | undefined,
  place: string[],
  looks: string[],
): { place: string[]; looks: string[] } {
  return canPlaceRefs(email) ? { place, looks } : { place: [], looks: [...place, ...looks] }
}

/**
 * "שתשתלב בעיצוב שהוא עשה" (Hani, 2026-11-05): in a b-roll AI edit, a picture
 * she attaches is blended into the existing background (api/b-roll/edit),
 * not pasted as is. Hani only while she tries it; everyone else keeps her
 * photo over a blurred fill. Enforced on the server.
 */
export const BROLL_BLEND_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canBlendBRoll(email: string | null | undefined): boolean {
  return !!email && BROLL_BLEND_EMAILS.includes(email.toLowerCase())
}

/**
 * "כשאני מבקשת שמשהו ישתלב הוא כבר יעשה את זה כמו שצריך" (Hani, 2026-11-05):
 * when a carousel AI edit asks to change a PICTURE on a slide itself — remove
 * the text from it, clean it, extend it, blend it in, recolour it to fit —
 * the picture goes through the image model (lib/picture-edit) and the result
 * is placed back on the slide, instead of a CSS crop that hides the problem.
 * Hani only while she tries it; enforced on the server (api/media/ai-edit,
 * api/carousel/generate-ai). Everyone else keeps main's behaviour.
 */
export const PICTURE_EDIT_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canEditPictures(email: string | null | undefined): boolean {
  return !!email && PICTURE_EDIT_EMAILS.includes(email.toLowerCase())
}
