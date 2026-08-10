// Hard owner gate. The /calendar (timing) surface is intentionally limited
// to the owner cohort — the rest of the app is open to all users. Used by
// the sidebar (hide the tab), the /calendar route (redirect non-owners),
// and the ScheduleInCalendarBar CTA on /project (hide non-owner entry
// points).
//
// Why a short list, not open access: this is a private surface during
// active iteration. Currently includes Hani (product), Nataliya (mentor
// reviewing the feature), and Yahav. If it should later open up, delete
// this module and remove the isOwner checks at its call sites.
const OWNER_EMAILS = new Set([
  "hanigirl@gmail.com",
  "nataliya@nataliyarey.com",
  "yahavrubin1@gmail.com",
  "etel1108@gmail.com",
  "avishagnextlevel@gmail.com", // Avishag
  "ynmarketlink@gmail.com", // Tamar
])

// Kept as a named export for backwards compat with any direct import; refers
// to the primary owner (Hani). New checks should call `isOwner` instead.
export const OWNER_EMAIL = "hanigirl@gmail.com"

// Single-reviewer preview gate, separate from the owner cohort above.
//
// The "no credits" media card and the optional OpenAI field in onboarding ship
// to production behind this so Nataliya can review them on the live site while
// every other student keeps the previous behaviour (Hani, 2026-08-02). This is
// a UI-visibility gate only — nothing server-side changes, and a student who
// already has an OpenAI key keeps generating media exactly as before.
//
// To open the feature to everyone: delete this function and its call sites
// (the /api/connections/openai route and the onboarding step-1 field).
const MEDIA_CREDITS_PREVIEW_EMAILS = new Set(["nataliya@nataliyarey.com"])

export function canPreviewMediaCredits(
  email: string | null | undefined,
): boolean {
  if (!email) return false
  return MEDIA_CREDITS_PREVIEW_EMAILS.has(email.toLowerCase().trim())
}

// Which hook engine a user gets. Inside the cohort: Gemini writes the hook in
// one call, with no Claude judge and no Hebrew polish. Outside it: the original
// Sonnet writer → Opus judge → Sonnet polish chain, unchanged.
//
// Unlike canPreviewMediaCredits above, this is NOT only a UI gate — it picks a
// different model, a different API key, and a different quality profile on the
// server. Both paths are therefore kept alive in the hook routes, and the flag
// is read from the authenticated user's email, never from the request body.
//
// Piloting with Nataliya before students are asked to go get a Gemini key of
// their own (Hani, 2026-08-10).
//
// To open it to everyone: make this return true and delete the Claude branch in
// /api/hooks and /api/homepage-hooks.
const GEMINI_HOOKS_EMAILS = new Set([
  "nataliya@nataliyarey.com",
  "hanigirl@gmail.com",
])

export function usesGeminiHooks(email: string | null | undefined): boolean {
  if (!email) return false
  return GEMINI_HOOKS_EMAILS.has(email.toLowerCase().trim())
}

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
