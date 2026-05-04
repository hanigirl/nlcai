// Emergency repair: re-parse a user's stored identity file from Supabase Storage
// and write the resulting identity row + raw_file_text. Use when parse-identity
// failed silently and the user is blocked.
//
// Usage:
//   node scripts/repair-user-identity.mjs <user_id> <core|audience>
//
// Looks up the matching user_media row (style_file for core, audience_file for
// audience), downloads the file, parses it (mammoth for docx, word-extractor
// for doc, raw text for txt/md/rtf), runs Claude with the project's prompt,
// upserts the identity row, and saves raw_file_text so future re-parses work
// from the diagnose tool.
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import mammoth from "mammoth"
import WordExtractor from "word-extractor"
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
  console.error("Missing SUPABASE env vars in .env.local")
  process.exit(1)
}

const TARGET = process.argv[2]
const TYPE = process.argv[3]
if (!TARGET || (TYPE !== "core" && TYPE !== "audience")) {
  console.error("Usage: node scripts/repair-user-identity.mjs <user_id> <core|audience>")
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

// 1. Pull the user's API key + the matching media file.
const { data: userRow, error: userErr } = await supabase
  .from("users")
  .select("anthropic_api_key")
  .eq("id", TARGET)
  .single()
if (userErr || !userRow?.anthropic_api_key) {
  console.error("No anthropic_api_key for user.", userErr?.message ?? "")
  process.exit(1)
}

const category = TYPE === "core" ? "style_file" : "audience_file"
const { data: media } = await supabase
  .from("user_media")
  .select("file_name, storage_path, created_at")
  .eq("user_id", TARGET)
  .eq("category", category)
  .order("created_at", { ascending: false })
  .limit(1)

if (!media?.length) {
  console.error(`No ${category} in user_media for ${TARGET}`)
  process.exit(1)
}

const file = media[0]
console.log(`Found file: ${file.file_name} (${file.storage_path})`)

// 2. Download from storage.
const { data: blob, error: dlErr } = await supabase.storage
  .from("user-media")
  .download(file.storage_path)
if (dlErr || !blob) {
  console.error("Storage download failed:", dlErr?.message)
  process.exit(1)
}
const buffer = Buffer.from(await blob.arrayBuffer())
console.log(`Downloaded ${buffer.byteLength} bytes`)

// 3. Extract text.
const name = file.file_name.toLowerCase()
let text = ""
if (name.endsWith(".docx")) {
  const result = await mammoth.extractRawText({ buffer })
  text = result.value?.trim() ?? ""
} else if (name.endsWith(".doc")) {
  const extractor = new WordExtractor()
  const extracted = await extractor.extract(buffer)
  text = extracted.getBody()?.trim() ?? ""
} else if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".rtf")) {
  text = buffer.toString("utf8").trim()
} else {
  console.error(`Unsupported extension for ${name} — only docx/doc/txt/md/rtf re-parsable here. PDF needs the live API path.`)
  process.exit(1)
}

if (!text) {
  console.error("Extracted text is empty")
  process.exit(1)
}
console.log(`Extracted ${text.length} chars of text`)

// 4. Run Claude with the project's prompt.
// Inlined here — these mirror src/lib/agents/identity-parser.ts. If the prompts
// drift, the script needs updating; that's the tradeoff for not pulling in the
// TS module.
const AUDIENCE_PROMPT = `את סוכנת שמפרסרת מידע על קהל יעד מתוך טקסט חופשי.

כללי חילוץ:
1. הטקסט לא מסודר בכותרות. אנשים כותבים בזרם חופשי — פסקאות, רשימות, סיפור אישי, ציטוטים מראיונות.
2. **הסיקי מהקשר, אל תחפשי התאמות מילוליות.** אם בטקסט נאמר "מסתכלות במראה ושונאות מה שהן רואות" — זה גם dailyPains וגם emotionalPains וגם מקור ל-emotionalDesires (שאלוהבו את עצמן). חלקי לפי המשמעות, לא לפי המילים.
3. **כל ציטוט בגוף ראשון** ("אני מרגישה ש...", "כבר שנים אני...") הוא זהב לשדה identityStatements או crossAudienceQuotes.
4. שדה ריק ("") רק אם אין בטקסט שום רמז. אם יש אפילו רמז עקיף — חלצי.
5. תמציתי: 1-2 משפטים לשדה (חוץ מציטוטים — שם תני 2-4 ציטוטים מקוריים).
6. כתבי בלשון רבים נשי כשמתייחסים לקהל ("הן מרגישות", "להן יש"), אף פעם לא יחיד.
7. החזירי JSON בלבד, בלי markdown, בלי הסברים.

החזירי JSON בפורמט:
{
  "location": "",
  "employment": "",
  "education": "",
  "income": "",
  "behavioral": "",
  "awarenessLevel": "",
  "dailyPains": "",
  "emotionalPains": "",
  "unresolvedConsequences": "",
  "fears": "",
  "failedSolutions": "",
  "limitingBeliefs": "",
  "myths": "",
  "dailyDesires": "",
  "emotionalDesires": "",
  "smallWins": "",
  "idealSolution": "",
  "bottomLine": "",
  "crossAudienceQuotes": "",
  "idealSolutionWords": "",
  "identityStatements": ""
}`

const CORE_PROMPT = `את סוכנת שמפרסרת מידע על זהות יוצרת תוכן מתוך טקסט חופשי. החזירי JSON בלבד בפורמט:
{
  "niche": "",
  "productName": "",
  "whoIAm": "",
  "whoIServe": "",
  "howISound": "",
  "slangExamples": "",
  "whatINeverDo": ""
}`

const systemPrompt = TYPE === "core" ? CORE_PROMPT : AUDIENCE_PROMPT

const client = new Anthropic({ apiKey: userRow.anthropic_api_key })
console.log("Calling Claude...")
const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: `${systemPrompt}\n\n--- הטקסט ---\n${text}` }],
    },
  ],
})

const raw = message.content.find((b) => b.type === "text")?.text ?? ""

// Extract the FIRST complete {...} object using brace counting.
// Claude sometimes returns multiple objects (e.g., when the doc describes more
// than one audience). The greedy regex match would span across both and fail
// to parse. We only persist one identity per user, so taking the first is the
// right call here.
function extractFirstJsonObject(s) {
  const start = s.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (c === "\\") { escape = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

const jsonStr = extractFirstJsonObject(raw)
if (!jsonStr) {
  console.error("Claude returned no JSON. Raw response:")
  console.error(raw)
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(jsonStr)
} catch (err) {
  console.error("JSON parse failed:", err.message)
  console.error("Raw match:", jsonStr)
  process.exit(1)
}

// Detect when Claude returned more than one object so we can warn the user.
const remainder = raw.slice(raw.indexOf(jsonStr) + jsonStr.length).trim()
if (remainder.startsWith(",") || remainder.startsWith("{") || remainder.startsWith("[")) {
  console.warn("⚠️  Claude returned multiple objects — saving only the first.")
}

const filled = Object.entries(parsed).filter(
  ([, v]) => typeof v === "string" && v.trim().length > 0
)
console.log(`Claude returned ${filled.length} filled fields`)
if (filled.length === 0) {
  console.error("All fields empty — refusing to save. Raw:")
  console.error(raw)
  process.exit(1)
}

// 5. Upsert into the identity table.
const pickFilled = (...vals) => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v
  }
  return ""
}

if (TYPE === "audience") {
  const row = {
    user_id: TARGET,
    location: pickFilled(parsed.location),
    employment: pickFilled(parsed.employment),
    education: pickFilled(parsed.education),
    income: pickFilled(parsed.income),
    behavioral: pickFilled(parsed.behavioral),
    awareness_level: pickFilled(parsed.awarenessLevel),
    daily_pains: pickFilled(parsed.dailyPains),
    emotional_pains: pickFilled(parsed.emotionalPains),
    unresolved_consequences: pickFilled(parsed.unresolvedConsequences),
    fears: pickFilled(parsed.fears),
    failed_solutions: pickFilled(parsed.failedSolutions),
    limiting_beliefs: pickFilled(parsed.limitingBeliefs),
    myths: pickFilled(parsed.myths),
    daily_desires: pickFilled(parsed.dailyDesires),
    emotional_desires: pickFilled(parsed.emotionalDesires),
    small_wins: pickFilled(parsed.smallWins),
    ideal_solution: pickFilled(parsed.idealSolution),
    bottom_line: pickFilled(parsed.bottomLine),
    cross_audience_quotes: pickFilled(parsed.crossAudienceQuotes),
    ideal_solution_words: pickFilled(parsed.idealSolutionWords),
    identity_statements: pickFilled(parsed.identityStatements),
    raw_file_text: text,
  }
  const { error } = await supabase
    .from("audience_identities")
    .upsert(row, { onConflict: "user_id" })
  if (error) {
    console.error("Upsert failed:", error.message)
    process.exit(1)
  }
  // Verify by re-reading.
  const { data: verify } = await supabase
    .from("audience_identities")
    .select("daily_pains, fears, raw_file_text")
    .eq("user_id", TARGET)
    .single()
  console.log("✅ Saved audience_identities. Verify:")
  console.log(`  raw_file_text length: ${verify?.raw_file_text?.length ?? 0}`)
  console.log(`  daily_pains: ${verify?.daily_pains?.slice(0, 80) ?? "(empty)"}`)
  console.log(`  fears: ${verify?.fears?.slice(0, 80) ?? "(empty)"}`)
} else {
  const { data: existing } = await supabase
    .from("core_identities")
    .select("*")
    .eq("user_id", TARGET)
    .maybeSingle()
  const cur = existing ?? {}
  const row = {
    user_id: TARGET,
    niche: pickFilled(parsed.niche, cur.niche),
    product_name: pickFilled(parsed.productName, cur.product_name),
    who_i_am: pickFilled(parsed.whoIAm, cur.who_i_am),
    who_i_serve: pickFilled(parsed.whoIServe, cur.who_i_serve),
    how_i_sound: pickFilled(parsed.howISound, cur.how_i_sound),
    slang_examples: pickFilled(parsed.slangExamples, cur.slang_examples),
    what_i_never_do: pickFilled(parsed.whatINeverDo, cur.what_i_never_do),
    raw_file_text: text,
  }
  const { error } = await supabase
    .from("core_identities")
    .upsert(row, { onConflict: "user_id" })
  if (error) {
    console.error("Upsert failed:", error.message)
    process.exit(1)
  }
  const { data: verify } = await supabase
    .from("core_identities")
    .select("niche, who_i_am, who_i_serve, raw_file_text")
    .eq("user_id", TARGET)
    .single()
  console.log("✅ Saved core_identities. Verify:")
  console.log(`  raw_file_text length: ${verify?.raw_file_text?.length ?? 0}`)
  console.log(`  niche: ${verify?.niche?.slice(0, 80) ?? "(empty)"}`)
  console.log(`  who_i_am: ${verify?.who_i_am?.slice(0, 80) ?? "(empty)"}`)
  console.log(`  who_i_serve: ${verify?.who_i_serve?.slice(0, 80) ?? "(empty)"}`)
}
