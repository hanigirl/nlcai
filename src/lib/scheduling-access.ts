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
