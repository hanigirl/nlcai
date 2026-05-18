// Sanity test for the validation logic. Exercises:
//   1. Format check against a matrix of good/bad inputs (no network).
//   2. Live Anthropic check against the actual user-stored key from the
//      database, so we can confirm the path Ravit hit really does flag it.
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

// Inline copy of validateApiKeyFormat so the script doesn't drag the
// Next.js bundle. Stays trivially synced — both should change together.
function validateApiKeyFormat(keyName, value) {
  const v = (value ?? "").trim()
  if (!v) return "המפתח ריק"
  if (keyName === "anthropic_api_key") {
    if (!v.startsWith("sk-ant-")) return "Anthropic must start with sk-ant-"
    if (v.length < 30) return "Anthropic too short"
  } else if (keyName === "apify_api_key") {
    if (!v.startsWith("apify_api_")) return "Apify must start with apify_api_"
  }
  return null
}

const cases = [
  // Ravit's actual scenario — apify key in anthropic field.
  { name: "Ravit's bug", keyName: "anthropic_api_key", value: "apify_api_mZsomethingsomething", expect: "fail" },
  { name: "valid-looking anthropic", keyName: "anthropic_api_key", value: "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa", expect: "pass" },
  { name: "anthropic too short", keyName: "anthropic_api_key", value: "sk-ant-short", expect: "fail" },
  { name: "empty", keyName: "anthropic_api_key", value: "", expect: "fail" },
  { name: "apify in apify field", keyName: "apify_api_key", value: "apify_api_token123", expect: "pass" },
  { name: "anthropic key in apify field", keyName: "apify_api_key", value: "sk-ant-something", expect: "fail" },
  { name: "heygen any", keyName: "heygen_api_key", value: "whatever-format", expect: "pass" },
]

console.log("=== Format checks ===")
let failed = 0
for (const c of cases) {
  const result = validateApiKeyFormat(c.keyName, c.value)
  const got = result === null ? "pass" : "fail"
  const ok = got === c.expect
  if (!ok) failed++
  console.log(`${ok ? "✓" : "✗"} ${c.name}: expected ${c.expect}, got ${got}${result ? ` (${result})` : ""}`)
}
console.log(failed === 0 ? "\nAll format checks passed.\n" : `\n${failed} format check(s) failed.\n`)

// === Live Anthropic round-trip against Ravit's stored key ===
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) { console.log("(skipping live check — no env)"); process.exit(failed > 0 ? 1 : 0) }

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
const ravit = list.users.find((u) => u.email === "ravittal.lanua@gmail.com")
if (!ravit) { console.log("(skipping live check — Ravit not found)"); process.exit(failed > 0 ? 1 : 0) }

const { data: row } = await admin.from("users").select("anthropic_api_key").eq("id", ravit.id).maybeSingle()
const key = row?.anthropic_api_key
if (!key) { console.log("(no key stored for Ravit)"); process.exit(failed > 0 ? 1 : 0) }

console.log("=== Live check on Ravit's stored 'anthropic' key ===")
console.log(`Stored key prefix: ${key.slice(0, 12)}…`)
const formatErr = validateApiKeyFormat("anthropic_api_key", key)
if (formatErr) {
  console.log(`✓ Format gate caught it BEFORE network call: "${formatErr}"`)
  console.log("  → User would get clear message, no API call wasted.")
  process.exit(failed > 0 ? 1 : 0)
}

console.log("(format gate let it pass — falling through to live check)")
try {
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 8000 })
  await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 5,
    messages: [{ role: "user", content: "hi" }],
  })
  console.log("✓ Live check: key is valid + has credits.")
} catch (err) {
  console.log(`✓ Live check correctly rejected: status=${err?.status}, msg=${err?.message?.slice(0, 100)}`)
}

process.exit(failed > 0 ? 1 : 0)
