// Admin re-parse of a user's audience_identity from their stored
// raw_file_text. Only fills empty fields (never overwrites existing
// content). Used to recover users whose initial parse landed with
// only demographic fields because the AI call failed mid-pipeline.
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { readFile } from "node:fs/promises"

// Inline the audience prompt from the .ts source — Node can't directly
// import the TypeScript file, and copying it would drift over time.
async function loadAudiencePrompt() {
  const src = await readFile(new URL("../src/lib/agents/identity-parser.ts", import.meta.url), "utf8")
  const m = src.match(/export const AUDIENCE_IDENTITY_PARSE_PROMPT = `([\s\S]*?)`/)
  if (!m) throw new Error("Could not extract AUDIENCE_IDENTITY_PARSE_PROMPT")
  return m[1]
}
const AUDIENCE_IDENTITY_PARSE_PROMPT = await loadAudiencePrompt()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) { console.error("Missing env"); process.exit(1) }

const email = process.argv[2]
if (!email) { console.error("Usage: node scripts/reparse-audience.mjs <email>"); process.exit(1) }

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) { console.error("User not found"); process.exit(1) }

const [{ data: row }, { data: userRow }] = await Promise.all([
  admin.from("audience_identities").select("*").eq("user_id", user.id).maybeSingle(),
  admin.from("users").select("anthropic_api_key").eq("id", user.id).maybeSingle(),
])

const rawText = row?.raw_file_text
if (!rawText) { console.error("No raw_file_text — user needs to re-upload the audience file."); process.exit(1) }

const apiKey = userRow?.anthropic_api_key
if (!apiKey) { console.error("No anthropic_api_key for this user."); process.exit(1) }
if (!apiKey.startsWith("sk-ant-")) { console.error("Stored key isn't an Anthropic key. Have the user re-enter it first."); process.exit(1) }

console.log("Calling Anthropic to re-parse audience file…")
const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 50000 })
let parsed = {}
try {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: `${AUDIENCE_IDENTITY_PARSE_PROMPT}\n\n--- הטקסט ---\n${rawText}` }],
  })
  const text = message.content.find((b) => b.type === "text")?.text ?? ""
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) { console.error("No JSON object in response. First 400 chars:", text.slice(0, 400)); process.exit(1) }
  parsed = JSON.parse(m[0])
} catch (err) {
  console.error("Anthropic call failed:", err?.status, err?.message)
  process.exit(1)
}

const fieldMap = {
  location: "location", employment: "employment", education: "education",
  income: "income", behavioral: "behavioral", awareness_level: "awarenessLevel",
  daily_pains: "dailyPains", emotional_pains: "emotionalPains",
  unresolved_consequences: "unresolvedConsequences", fears: "fears",
  failed_solutions: "failedSolutions", limiting_beliefs: "limitingBeliefs",
  myths: "myths", daily_desires: "dailyDesires", emotional_desires: "emotionalDesires",
  small_wins: "smallWins", ideal_solution: "idealSolution", bottom_line: "bottomLine",
  cross_audience_quotes: "crossAudienceQuotes", ideal_solution_words: "idealSolutionWords",
  identity_statements: "identityStatements",
}
const updates = {}
for (const [dbCol, parsedKey] of Object.entries(fieldMap)) {
  if (!row?.[dbCol] && typeof parsed[parsedKey] === "string" && parsed[parsedKey].trim()) {
    updates[dbCol] = parsed[parsedKey]
  }
}

if (Object.keys(updates).length === 0) {
  console.log("Nothing to update — re-parse returned no new content.")
  console.log("Parsed keys:", Object.keys(parsed))
  process.exit(0)
}

const { error } = await admin.from("audience_identities").update(updates).eq("user_id", user.id)
if (error) { console.error("Update failed:", error.message); process.exit(1) }

console.log(`Updated ${Object.keys(updates).length} fields:`, Object.keys(updates))
console.log("Sample filled values:")
for (const k of Object.keys(updates).slice(0, 3)) {
  console.log(`  ${k}: ${updates[k].slice(0, 80)}…`)
}
