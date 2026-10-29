/**
 * The scheduling release (approval before scheduling, the approved-only
 * rail, the format preview, the weekly routine on the calendar and the
 * Instagram bridge) is live for these accounts only, while it's tried for
 * real before everyone gets it (Hani, 2026-10-22; Nataliya added 2026-10-26).
 * Everyone else sees the
 * app exactly as before.
 */
export const SCHEDULING_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canUseScheduling(email: string | null | undefined): boolean {
  return !!email && SCHEDULING_EMAILS.includes(email.toLowerCase())
}

/**
 * "סידור אוטומטי ← תזמון כל הפוסטים" as one row in the panel header, no
 * schedule settings on the board (task 4084d905, direction A). Hani only,
 * while she tries it (2026-10-29).
 */
export const SCHEDULE_ALL_A_EMAILS = ["hanigirl@gmail.com"]

export function canUseScheduleAllA(email: string | null | undefined): boolean {
  return !!email && SCHEDULE_ALL_A_EMAILS.includes(email.toLowerCase())
}

/**
 * Today's batch (format copy AI edit, Drive media fixes, brand-colour cover,
 * save-to-visual-language chip, dislike opens AI edit, the long-wait note,
 * AI edit panels above the bar, calendar auto-arranged card opens its edit).
 * Live for Hani only while she tries it (2026-10-29); everyone else gets the
 * app as before.
 */
export const PREVIEW_EMAILS = ["hanigirl@gmail.com"]

export function canUsePreview(email: string | null | undefined): boolean {
  return !!email && PREVIEW_EMAILS.includes(email.toLowerCase())
}
