// One-shot inspection for a specific user's identity state.
// Usage: node scripts/inspect-user-identity.mjs <user_id>
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

const TARGET = process.argv[2]
if (!TARGET) {
  console.error("Usage: node scripts/inspect-user-identity.mjs <user_id>")
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 200 })
const target = usersData?.users?.find((u) => u.id === TARGET)
console.log(`User: ${target?.email ?? "(not in auth)"}  id=${TARGET}`)
console.log("---")

const { data: userRow } = await supabase
  .from("users")
  .select("anthropic_api_key")
  .eq("id", TARGET)
  .single()
console.log(`anthropic_api_key: ${userRow?.anthropic_api_key ? "SET" : "MISSING"}`)
console.log("---")

const { data: media } = await supabase
  .from("user_media")
  .select("category, file_name, storage_path, created_at")
  .eq("user_id", TARGET)
  .order("created_at", { ascending: false })
console.log(`user_media rows: ${media?.length ?? 0}`)
for (const m of media ?? []) {
  console.log(`  [${m.category}] ${m.file_name}  path=${m.storage_path}  at=${m.created_at}`)
}
console.log("---")

const { data: core } = await supabase
  .from("core_identities")
  .select("*")
  .eq("user_id", TARGET)
  .maybeSingle()
console.log(`core_identities row: ${core ? "EXISTS" : "missing"}`)
if (core) {
  console.log(`  raw_file_text length: ${core.raw_file_text?.length ?? 0}`)
  console.log(`  niche: ${core.niche?.slice(0, 60) ?? "(empty)"}`)
  console.log(`  who_i_am: ${core.who_i_am?.slice(0, 60) ?? "(empty)"}`)
  console.log(`  who_i_serve: ${core.who_i_serve?.slice(0, 60) ?? "(empty)"}`)
}
console.log("---")

const { data: aud } = await supabase
  .from("audience_identities")
  .select("*")
  .eq("user_id", TARGET)
  .maybeSingle()
console.log(`audience_identities row: ${aud ? "EXISTS" : "missing"}`)
if (aud) {
  console.log(`  raw_file_text length: ${aud.raw_file_text?.length ?? 0}`)
  console.log(`  daily_pains: ${aud.daily_pains?.slice(0, 60) ?? "(empty)"}`)
  console.log(`  fears: ${aud.fears?.slice(0, 60) ?? "(empty)"}`)
  console.log(`  emotional_pains: ${aud.emotional_pains?.slice(0, 60) ?? "(empty)"}`)
}
