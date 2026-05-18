// One-shot: reset a user back to /onboarding so they re-do the file upload
// flow. Wipes the (file-less) core_identity row and clears the
// onboarding_completed flag in user_metadata. The proxy gate will then
// route them to /onboarding on next visit.
//
// Read-only safety: refuses to run if the user has hooks, products, or
// audience_identity — those signal real usage, not a stuck onboarding.
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error("Usage: node scripts/reset-onboarding.mjs <email>")
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listErr) {
  console.error("listUsers failed:", listErr.message)
  process.exit(1)
}
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error("User not found:", email)
  process.exit(1)
}

// Safety check — refuse if there's real usage data.
const [{ data: audience }, { data: products }, { count: hooksCount }] = await Promise.all([
  admin.from("audience_identities").select("user_id").eq("user_id", user.id).maybeSingle(),
  admin.from("products").select("id").eq("user_id", user.id),
  admin.from("hooks").select("id", { count: "exact", head: true }).eq("user_id", user.id),
])
if (audience || (products?.length ?? 0) > 0 || (hooksCount ?? 0) > 0) {
  console.error("ABORT — user has real data (audience/products/hooks). Reset would destroy work.")
  console.error({ has_audience: !!audience, products: products?.length, hooks: hooksCount })
  process.exit(1)
}

// 1. Delete the core_identity row (otherwise proxy self-heals the flag back on).
const { error: delErr } = await admin
  .from("core_identities")
  .delete()
  .eq("user_id", user.id)
if (delErr) {
  console.error("delete core_identities failed:", delErr.message)
  process.exit(1)
}

// 2. Clear stored API keys — first reset only flipped the flag, the user
// then re-uploaded with the same wrong-provider key still in the field,
// and onboarding "succeeded" with an empty parse. Force them to re-enter
// every key so the new validation actually runs.
const { error: keysErr } = await admin
  .from("users")
  .update({ anthropic_api_key: null, apify_api_key: null, heygen_api_key: null })
  .eq("id", user.id)
if (keysErr) {
  console.error("clear api keys failed:", keysErr.message)
  process.exit(1)
}

// 3. Flip onboarding_completed = false in user_metadata. updateUserById
// merges user_metadata, so we explicitly set the flag to false rather than
// trying to remove the key.
const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
  user_metadata: { ...user.user_metadata, onboarding_completed: false },
})
if (updErr) {
  console.error("updateUserById failed:", updErr.message)
  process.exit(1)
}

// 4. Kill all active sessions. Without this, the user's existing JWT in
// the browser cookie still carries onboarding_completed:true (JWTs are
// not re-issued on metadata change until refresh), so the middleware
// trusts the stale flag and lets them through to home — which then
// crashes because the data they need is gone. Forcing a re-login is
// the cleanest way to pick up the new metadata.
const { error: sessErr } = await admin.auth.admin.signOut(user.id, "global")
if (sessErr) {
  // Non-fatal — if signOut isn't available, instruct the user to clear cookies.
  console.warn("signOut failed (user must clear cookies manually):", sessErr.message)
}

console.log(JSON.stringify({
  ok: true,
  user_id: user.id,
  email: user.email,
  message: "Reset complete. Next visit will route to /onboarding.",
}, null, 2))
