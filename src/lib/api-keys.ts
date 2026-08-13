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
    return `זה נראה כמו מפתח של ${PROVIDER_LABEL[signature.owner]}, לא של ${PROVIDER_LABEL[keyName]}. בדקו שהעתקתם את המפתח מהספק הנכון והדבקתם אותו בשדה הנכון.`
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
export const GEMINI_NEW_KEY_PREFIX = "\u2068AQ.\u2069"
export const GEMINI_LEGACY_KEY_PREFIX = "\u2068AIza\u2069"
// Same isolate, applied to the whole breadcrumb so the arrow keeps pointing
// the way it does in AI Studio instead of being flipped by the Hebrew flow.
export const AI_STUDIO_PATH = "\u2068aistudio.google.com \u2192 API keys\u2069"

// True for the legacy Google "standard" key format. Google began refusing
// unrestricted standard keys in June 2026 and retires the format entirely in
// September 2026, so a user still connected with one needs to be told before
// it stops working mid-flow.
export function isLegacyGeminiKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().startsWith("AIza")
}
