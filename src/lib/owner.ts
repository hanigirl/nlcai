// Hard owner gate. The /calendar (timing) surface is intentionally limited
// to the owner cohort — the rest of the app is open to all users. Used by
// the sidebar (hide the tab), the /calendar route (redirect non-owners),
// and the ScheduleInCalendarBar CTA on /project (hide non-owner entry
// points).
//
// Why a short list, not open access: this is a private surface during
// active iteration. Currently includes Hani (product) + Nataliya (mentor
// reviewing the feature). If it should later open up, delete this module
// and remove the isOwner checks at its call sites.
const OWNER_EMAILS = new Set([
  "hanigirl@gmail.com",
  "nataliya@nataliyarey.com",
])

// Kept as a named export for backwards compat with any direct import; refers
// to the primary owner (Hani). New checks should call `isOwner` instead.
export const OWNER_EMAIL = "hanigirl@gmail.com"

export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false
  // QA preview hatch — any logged-in user can opt into the non-owner view
  // by setting `localStorage["nlcai:preview-as-non-owner"] = "1"` in their
  // own browser. Useful for verifying the gate without juggling accounts.
  // No data risk: the gates this powers only HIDE UI; server-side access
  // is unchanged and the flag lives in the visitor's own browser.
  if (
    typeof window !== "undefined" &&
    window.localStorage?.getItem("nlcai:preview-as-non-owner") === "1"
  ) {
    return false
  }
  return OWNER_EMAILS.has(email.toLowerCase().trim())
}
