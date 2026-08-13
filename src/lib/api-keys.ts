import type { SupabaseClient } from "@supabase/supabase-js"

export type KeyName = "heygen_api_key" | "anthropic_api_key" | "apify_api_key" | "openai_api_key" | "gemini_api_key"

const NOT_CONNECTED_CODE: Record<KeyName, string> = {
  heygen_api_key: "heygen_not_connected",
  anthropic_api_key: "anthropic_not_connected",
  apify_api_key: "apify_not_connected",
  openai_api_key: "openai_not_connected",
  gemini_api_key: "gemini_not_connected",
}

const PROVIDER_LABEL: Record<KeyName, string> = {
  heygen_api_key: "HeyGen",
  anthropic_api_key: "Claude (Anthropic)",
  apify_api_key: "Apify",
  openai_api_key: "OpenAI",
  gemini_api_key: "Gemini",
}

// Prefixes that unambiguously belong to ONE provider.
//
// These exist only to catch a key pasted into the wrong field — never as an
// allowlist of what a valid key is allowed to look like. Providers change
// their key formats without warning: during 2026 Google moved Gemini keys
// from "AIza" (standard keys) to "AQ." (auth keys), and our old
// `!startsWith("AIza") -> reject` rule turned every freshly-issued key into a
// wall the user could not get past, with an error message that told her to go
// fetch exactly the key she already had.
//
// So: a value we positively recognise as ANOTHER provider's key is rejected
// instantly and for free. Anything we don't recognise is passed through to the
// live check, which asks the provider itself instead of guessing.
//
// Order matters — "sk-ant-" must be tested before the broader "sk-".
const PROVIDER_SIGNATURES: Array<{ owner: KeyName; matches: (v: string) => boolean }> = [
  { owner: "anthropic_api_key", matches: (v) => v.startsWith("sk-ant-") },
  { owner: "apify_api_key", matches: (v) => v.startsWith("apify_api_") },
  // Gemini: "AIza" = legacy standard key, "AQ." = the auth key AI Studio
  // issues today. Both are accepted; neither is required.
  { owner: "gemini_api_key", matches: (v) => v.startsWith("AIza") || v.startsWith("AQ.") },
  { owner: "openai_api_key", matches: (v) => v.startsWith("sk-") },
]

// Only where the provider documents a floor. HeyGen and Apify token lengths
// vary, so we leave those to the live check.
const MIN_LENGTH: Partial<Record<KeyName, number>> = {
  anthropic_api_key: 30,
  openai_api_key: 30,
  gemini_api_key: 30,
}

// Wraps a Latin run in a bidi isolate (FSI…PDI) so neutral characters next to
// it — commas, periods, parentheses — stay on the side the reader expects when
// the run sits inside a Hebrew sentence.
function isolate(text: string): string {
  return `\u2068${text}\u2069`
}

// Cheap synchronous gate so we catch obvious paste-into-wrong-field mistakes
// before spending an API call. Real example: user pasted an apify_api_ token
// into the Anthropic field and only discovered it when the whole app started
// 401'ing.
//
// Returns a Hebrew error string, or null to mean "nothing obviously wrong —
// let the live check decide".
export function validateApiKeyFormat(keyName: KeyName, value: string): string | null {
  const v = value.trim()
  if (!v) return "המפתח ריק"

  const signature = PROVIDER_SIGNATURES.find((s) => s.matches(v))
  if (signature && signature.owner !== keyName) {
    // Same bidi trap the Gemini prefixes hit: a Latin provider name inside a
    // Hebrew sentence drags the following comma/period to the wrong side, so
    // "Claude (Anthropic)," renders as ",(Claude (Anthropic". Isolate each
    // label at the interpolation site — the labels themselves stay clean for
    // any other caller.
    return `זה נראה כמו מפתח של ${isolate(PROVIDER_LABEL[signature.owner])}, לא של ${isolate(PROVIDER_LABEL[keyName])}. בדקו שהעתקתם את המפתח מהספק הנכון והדבקתם אותו בשדה הנכון.`
  }

  const min = MIN_LENGTH[keyName]
  if (min && v.length < min) return "המפתח קצר מדי — נראה שהוא לא הועתק במלואו. העתיקו אותו שוב מההתחלה ועד הסוף."

  return null
}

export async function getUserApiKey(
  supabase: SupabaseClient,
  keyName: KeyName
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Unauthorized")
  }

  const { data, error } = await supabase
    .from("users")
    .select(keyName)
    .eq("id", user.id)
    .single()

  if (error) {
    throw new Error(`Failed to fetch API key: ${error.message}`)
  }

  const key = (data as Record<string, string | null> | null)?.[keyName]
  if (!key) {
    throw new Error(NOT_CONNECTED_CODE[keyName])
  }

  return key
}

// A Latin token that ends in "." sitting inside a Hebrew sentence is the
// classic bidi trap: the period is a neutral character, so it gets pushed to
// the far side of the run and the user reads ".AQ" instead of "AQ.". Wrapping
// the token in an isolate (FSI…PDI) keeps the dot attached to the token.
// These constants are for plain strings; in JSX use <bdi>AQ.</bdi>.
export const GEMINI_NEW_KEY_PREFIX = isolate("AQ.")
export const GEMINI_LEGACY_KEY_PREFIX = isolate("AIza")

// Same isolate, applied to whole breadcrumbs so the arrows keep pointing the
// way they do in each provider's own console instead of being flipped by the
// Hebrew flow, and so the sentence's final period stays at the end.
//
// Every console path a user-facing message can send someone to lives here.
// They were previously inlined per provider, which is how the Gemini one got
// fixed while the other four kept rendering ".console.anthropic.com" and
// "API keys ← platform.openai.com".
export const AI_STUDIO_PATH = isolate("aistudio.google.com \u2192 API keys")
export const AI_STUDIO_HOST = isolate("aistudio.google.com")
export const ANTHROPIC_CONSOLE_HOST = isolate("console.anthropic.com")
export const ANTHROPIC_BILLING_PATH = isolate("console.anthropic.com \u2192 Billing")
export const APIFY_CONSOLE_HOST = isolate("console.apify.com")
export const OPENAI_KEYS_PATH = isolate("platform.openai.com \u2192 API keys")
export const OPENAI_BILLING_PATH = isolate("platform.openai.com \u2192 Billing")
export const HEYGEN_API_PATH = isolate("app.heygen.com \u2192 Settings \u2192 API")

// True for the legacy Google "standard" key format. Google began refusing
// unrestricted standard keys in June 2026 and retires the format entirely in
// September 2026, so a user still connected with one needs to be told before
// it stops working mid-flow.
export function isLegacyGeminiKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().startsWith("AIza")
}
