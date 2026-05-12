// Beta user allowlist. Every new feature shipped after 2026-05-12 is gated
// behind this check so it only goes live for Hani + Nataliya while older
// users keep the previous behavior. To roll a feature out more broadly,
// remove the isBetaUser check at its call site (don't expand this list —
// the list is the "preview ring", not a permanent feature flag).
//
// Server-side: pass user.email from supabase.auth.getUser() to isBetaUser.
// Client-side: read email via the same supabase client; consider a small
// useUserEmail hook if the same component needs the check more than once.
export const BETA_EMAILS = [
  "hanigirl@gmail.com",
  "nataliya@nataliyarey.com",
] as const

export function isBetaUser(email: string | null | undefined): boolean {
  if (!email) return false
  return (BETA_EMAILS as readonly string[]).includes(email.toLowerCase().trim())
}
