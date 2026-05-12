// Hard owner gate. The /calendar (timing) surface is intentionally limited
// to Hani only — the rest of the app is open to all users. Used by the
// sidebar (hide the tab), the /calendar route (redirect non-owners), and
// the ScheduleInCalendarBar CTA on /project (hide non-owner entry points).
//
// Why a single email, not a list: this is a private surface during active
// iteration, not a beta cohort. If it should later open up, delete this
// module and remove the isOwner checks at its call sites.
export const OWNER_EMAIL = "hanigirl@gmail.com"

export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().trim() === OWNER_EMAIL
}
