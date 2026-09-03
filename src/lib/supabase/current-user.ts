import type { SupabaseClient, User } from "@supabase/supabase-js"

/**
 * Who is signed in, answered from the session this browser already holds.
 *
 * Drop-in for `supabase.auth.getUser()` on the client — same return shape,
 * so a call site only swaps the callee.
 *
 * Why not `getUser()`: it asks the Auth server every time, and it holds the
 * auth client's Web Lock for the whole round trip (350-500ms on this
 * project). Every screen here asks "who am I" from several components at
 * once — the header, the page, the hook provider, the media panel — and they
 * all queue on that one lock, serially. Past 5s the library steals the lock
 * and the caller still waiting gets `AbortError: Lock broken by another
 * request with the 'steal' option`. That error escaped the page's load
 * effect, `setLoading(false)` never ran, and the skeletons stayed on screen
 * until a refresh. Seen live on 2026-09-03 on /ideas, with the lock warning
 * in the console.
 *
 * `getSession()` reads the stored session and returns without a network
 * call (it still refreshes an expired token, once). The client only ever
 * uses the result to scope its own queries — every table is behind RLS keyed
 * on the real token, so nothing here decides what the user is allowed to
 * see. Server code keeps verifying properly; see lib/auth-user.ts.
 */
export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<{ data: { user: User | null }; error: Error | null }> {
  const { data, error } = await supabase.auth.getSession()
  return { data: { user: data.session?.user ?? null }, error }
}
