// One-shot diagnostic — find a user by email, dump auth metadata +
// onboarding-relevant DB rows + media files. Read-only.
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error("Usage: node scripts/diagnose-user.mjs <email>")
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
  console.log(JSON.stringify({ found: false, email }, null, 2))
  process.exit(0)
}

const [
  { data: core },
  { data: audience },
  { data: products },
  { data: userRow },
  { data: media },
] = await Promise.all([
  admin.from("core_identities").select("user_id, niche, who_i_am, raw_file_text").eq("user_id", user.id).maybeSingle(),
  admin.from("audience_identities").select("*").eq("user_id", user.id).maybeSingle(),
  admin.from("products").select("id, name").eq("user_id", user.id),
  admin.from("users").select("anthropic_api_key").eq("id", user.id).maybeSingle(),
  admin.from("user_media").select("category, file_name, storage_path, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
])

console.log(JSON.stringify({
  user_id: user.id,
  email: user.email,
  user_metadata: user.user_metadata,
  has_core_identity: !!core,
  core_niche: core?.niche ?? null,
  has_audience_identity: !!audience,
  audience_fields_filled: audience ? Object.entries(audience).filter(([k, v]) => k !== "user_id" && typeof v === "string" && v.trim().length > 0).map(([k]) => k) : [],
  products_count: products?.length ?? 0,
  has_anthropic_key: !!userRow?.anthropic_api_key,
  media_files: media ?? [],
}, null, 2))
