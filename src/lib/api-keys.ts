import type { SupabaseClient } from "@supabase/supabase-js"

export async function getUserApiKey(
  supabase: SupabaseClient,
  keyName: "heygen_api_key" | "anthropic_api_key"
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
    throw new Error(
      keyName === "heygen_api_key"
        ? "heygen_not_connected"
        : "anthropic_not_connected"
    )
  }

  return key
}
