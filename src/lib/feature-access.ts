/**
 * "התמונה תכנס ביצירה הראשונה אם שמתי אותה כרפרנס" (Hani, 2026-11-05): an
 * image attached in the AI panel's first question is put INTO the first
 * generation as it is (lib/media-brief withPlacedImages, lib/placed-check).
 * Hani only while she tries it. Everyone else gets exactly what they had:
 * every attached image is a look reference — no strict mode, no check.
 * Enforced on the server (the four generate routes), not only in the panel.
 */
export const REF_PLACE_EMAILS = ["hanigirl@gmail.com"]

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
