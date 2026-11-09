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

/**
 * YouTube + LinkedIn as real networks (connect in Settings, a post goes to
 * every connected network that fits, the network tabs in the calendar preview,
 * the connected-networks marker). Hani only while she tries it (2026-11-05).
 * Everyone else — Nataliya included — keeps Instagram-only scheduling exactly
 * as before; the server enforces it too (connect/accounts routes, the bridge).
 */
/** Days between formats of one core post (2026-11-05) — Hani only, for now. */
export const FORMAT_GAP_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canUseFormatGap(email: string | null | undefined): boolean {
  return !!email && FORMAT_GAP_EMAILS.includes(email.toLowerCase())
}

export const MULTINETWORK_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canUseMultinetwork(email: string | null | undefined): boolean {
  return !!email && MULTINETWORK_EMAILS.includes(email.toLowerCase())
}

/**
 * The new format cards + tabbed panel on the canvas (סקריפט / מדיה / תזמון,
 * Notion task 4114d905). Hani and Nataliya only while they try it
 * (2026-11-07). Everyone else keeps the canvas exactly as before.
 */
export const FORMAT_CARDS_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canUseFormatCards(email: string | null | undefined): boolean {
  return !!email && FORMAT_CARDS_EMAILS.includes(email.toLowerCase())
}

/**
 * The post description apart from the script (תיאור הפוסט in the תזמון tab
 * and the calendar, 045) — Hani only while she tries it (2026-11-09).
 * Everyone else keeps the calendar's caption = script exactly as before.
 */
export const DESCRIPTION_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function canUseDescription(email: string | null | undefined): boolean {
  return !!email && DESCRIPTION_EMAILS.includes(email.toLowerCase())
}
