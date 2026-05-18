// One-shot: pull a user's stored Anthropic key from the users table and
// make a minimal Anthropic call to verify it works + has credits. Read-only
// against our DB; the only side effect is ~1 token of Anthropic usage on
// their account.
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error("Usage: node scripts/check-anthropic-credits.mjs <email>")
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listErr) { console.error("listUsers failed:", listErr.message); process.exit(1) }
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) { console.error("User not found:", email); process.exit(1) }

const { data: row } = await admin
  .from("users")
  .select("anthropic_api_key")
  .eq("id", user.id)
  .maybeSingle()

const key = row?.anthropic_api_key
if (!key) {
  console.log(JSON.stringify({ ok: false, reason: "no_key_stored" }, null, 2))
  process.exit(0)
}

const client = new Anthropic({ apiKey: key, maxRetries: 0 })
try {
  // Smallest possible call. If credits are missing we get a 402 with
  // credit_balance_too_low. Auth issues return 401. Any success means
  // credits + key are both fine.
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 5,
    messages: [{ role: "user", content: "hi" }],
  })
  console.log(JSON.stringify({
    ok: true,
    key_prefix: `${key.slice(0, 12)}…`,
    model: res.model,
    usage: res.usage,
    message: "Key works AND has credits.",
  }, null, 2))
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  const status = err?.status ?? null
  const errType = err?.error?.error?.type ?? null
  console.log(JSON.stringify({
    ok: false,
    key_prefix: `${key.slice(0, 12)}…`,
    status,
    error_type: errType,
    message: msg,
  }, null, 2))
}
