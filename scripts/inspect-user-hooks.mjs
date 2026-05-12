// One-shot diagnostic. Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
// from .env.local and dumps what user_id 4804bc58... has in the hooks table,
// so we can see whether the leak is in the DB or the frontend.
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dirname, "../.env.local"), "utf8")
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Missing SUPABASE env vars")
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const TARGET_USER_ID = "4804bc58-9d30-4fcc-94c6-238096cff8ed"
const HANI_EMAIL = "hanigirl@gmail.com"

// Resolve Hani's user.id via auth admin
const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 200 })
const hani = usersData?.users?.find((u) => u.email?.toLowerCase() === HANI_EMAIL)
const target = usersData?.users?.find((u) => u.id === TARGET_USER_ID)
console.log("Hani user_id:", hani?.id ?? "(not found)")
console.log("Target user:", target?.email ?? "(not found)", "id:", TARGET_USER_ID)
console.log("---")

// What the homepage query returns for this user (the exact same shape used in src/app/page.tsx)
const { data: homepageHooks, error: e1 } = await supabase
  .from("hooks")
  .select("id, user_id, hook_text, is_used, created_at")
  .eq("user_id", TARGET_USER_ID)
  .eq("is_used", false)
  .order("created_at", { ascending: false })
  .limit(4)

if (e1) {
  console.error("hooks query failed:", e1)
} else {
  console.log(`HOMEPAGE QUERY for ${TARGET_USER_ID} (limit 4, is_used=false, newest first):`)
  console.log(`  rows returned: ${homepageHooks.length}`)
  for (const h of homepageHooks) {
    console.log(`  [${h.created_at}] ${h.hook_text.slice(0, 80)}`)
  }
}
console.log("---")

// All hooks for this user — full count
const { count: allCount } = await supabase
  .from("hooks")
  .select("id", { count: "exact", head: true })
  .eq("user_id", TARGET_USER_ID)
console.log(`Total hooks where user_id=${TARGET_USER_ID}: ${allCount ?? 0}`)

// Sanity: how many hooks does Hani have?
if (hani?.id) {
  const { count: haniCount } = await supabase
    .from("hooks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", hani.id)
  console.log(`Total hooks where user_id=${hani.id} (Hani): ${haniCount ?? 0}`)
}
