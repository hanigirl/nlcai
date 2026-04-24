import type { SupabaseClient } from "@supabase/supabase-js"

type KeyName = "heygen_api_key" | "anthropic_api_key" | "apify_api_key"

const NOT_CONNECTED_CODE: Record<KeyName, string> = {
  heygen_api_key: "heygen_not_connected",
  anthropic_api_key: "anthropic_not_connected",
  apify_api_key: "apify_not_connected",
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
