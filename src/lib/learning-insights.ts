import { SupabaseClient } from "@supabase/supabase-js"

export async function fetchLearningInsights(
  supabase: SupabaseClient,
  userId: string,
  contentType?: "hook" | "core_post"
): Promise<string> {
  let query = supabase
    .from("learning_logs")
    .select("insight")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10)

  if (contentType) {
    query = query.eq("content_type", contentType)
  }

  const { data } = await query
  if (!data || data.length === 0) return ""

  const insights = (data as { insight: string }[]).map((row) => `- ${row.insight}`).join("\n")
  return `\n## העדפות סגנון שלמדנו מעריכות קודמות של המשתמש\n${insights}\n\nשים לב להעדפות האלה וכתוב בהתאם.\n`
}
