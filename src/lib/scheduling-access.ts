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
export const SCHEDULE_ALL_A_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canUseScheduleAllA(email: string | null | undefined): boolean {
  return !!email && SCHEDULE_ALL_A_EMAILS.includes(email.toLowerCase())
}

/**
 * Scheduling changes Hani is still trying (2026-10-29): a post laid on the
 * board by "סידור אוטומטי" opens its edit modal, and editing a scheduled
 * format takes it off the calendar back to "מאושר". The rest of that day's
 * batch is open to everyone.
 */
export const PREVIEW_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canUsePreview(email: string | null | undefined): boolean {
  return !!email && PREVIEW_EMAILS.includes(email.toLowerCase())
}
