import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Who is making this request — verified LOCALLY, not over the network.
 *
 * `supabase.auth.getUser()` asks the Auth server to validate the token on
 * every single call. Measured against this project on 2026-07-29 that round
 * trip is **350-500ms**, while the database queries it guards run in ~1ms. It
 * was, by a wide margin, the slowest thing in the app.
 *
 * `getClaims()` verifies the JWT's signature and expiry against the project's
 * published JWKS instead. This project signs with ES256 (asymmetric), and the
 * key set is public at /auth/v1/.well-known/jwks.json, so verification needs
 * no server at all after the first key fetch.
 *
 * THE TRADE-OFF, stated plainly: `getUser()` also asks "is this session still
 * alive?", so a token revoked mid-life (signed out everywhere, user deleted)
 * stops working immediately. Local verification trusts the token until it
 * expires — up to the access-token lifetime, one hour by default. What does
 * NOT change is the database: every table is still behind RLS keyed on
 * `auth.uid()`, so a forged or tampered token gets nothing either way. This is
 * the trade Supabase itself recommends for asymmetric projects, and it's the
 * reason to keep access-token lifetime short.
 *
 * Falls back to `getUser()` when claims are unavailable, so a project without
 * asymmetric keys still authenticates correctly — just slowly.
 */
export type AuthedUser = { id: string; email: string | null }

export async function getAuthUser(
  supabase: SupabaseClient,
): Promise<AuthedUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims()
    if (!error && data?.claims?.sub) {
      const claims = data.claims as { sub: string; email?: string }
      return { id: claims.sub, email: claims.email ?? null }
    }
  } catch {
    // Fall through — a malformed/absent token is simply "not signed in",
    // and any unexpected failure should degrade to the authoritative check
    // rather than locking the user out.
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}
