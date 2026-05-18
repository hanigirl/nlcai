import type { SupabaseClient } from "@supabase/supabase-js"

export type KeyName = "heygen_api_key" | "anthropic_api_key" | "apify_api_key"

const NOT_CONNECTED_CODE: Record<KeyName, string> = {
  heygen_api_key: "heygen_not_connected",
  anthropic_api_key: "anthropic_not_connected",
  apify_api_key: "apify_not_connected",
}

// Cheap synchronous gate so we catch obvious paste-into-wrong-field
// mistakes before spending an API call. Real example: user pasted an
// apify_api_... token into the Anthropic field and only discovered it
// when the whole app started 401'ing.
export function validateApiKeyFormat(keyName: KeyName, value: string): string | null {
  const v = value.trim()
  if (!v) return "המפתח ריק"
  if (keyName === "anthropic_api_key") {
    if (!v.startsWith("sk-ant-")) {
      return "מפתח Anthropic תקין מתחיל ב-sk-ant-. ודאי שלא הדבקת מפתח של ספק אחר (Apify/HeyGen) בשדה הזה."
    }
    if (v.length < 30) return "המפתח קצר מדי. ודאי שהעתקת אותו במלואו."
  } else if (keyName === "apify_api_key") {
    if (!v.startsWith("apify_api_")) {
      return "מפתח Apify תקין מתחיל ב-apify_api_. ודאי שלא הדבקת מפתח של ספק אחר בשדה הזה."
    }
  }
  // HeyGen has no documented prefix; we leave it to the live check.
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
