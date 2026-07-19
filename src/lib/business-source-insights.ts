import { SupabaseClient } from "@supabase/supabase-js"

// Max source summaries and total chars we inject into a generation prompt.
// Bounds token cost so hooks/content generation stays fast no matter how many
// sources the user has accumulated (see plan §5c). Only `active` sources feed
// the AI — the user curates via a per-source toggle in Settings.
const MAX_SOURCES = 6
const MAX_CHARS = 2000

/**
 * Returns a preformatted Hebrew markdown block of the user's business knowledge
 * sources, ready to splice into a generation prompt — or "" when there are none
 * (so the feature is zero-impact when unused). Mirrors `fetchLearningInsights`.
 */
export async function fetchBusinessSourceInsights(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("business_sources")
    .select("title, summary")
    .eq("user_id", userId)
    .eq("status", "ready")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_SOURCES)

  const rows = (data as { title: string; summary: string | null }[] | null) ?? []
  const usable = rows.filter((r) => r.summary && r.summary.trim())
  if (usable.length === 0) return ""

  const lines: string[] = []
  let budget = MAX_CHARS
  for (const r of usable) {
    const line = `- ${r.title}: ${r.summary!.trim()}`
    if (budget - line.length < 0) break
    lines.push(line)
    budget -= line.length
  }
  if (lines.length === 0) return ""

  return `\n## מקורות ידע על העסק\n${lines.join("\n")}\n\nהשתמשו בפרטים, בסיפורים ובניסוחים מהמקורות האלה כדי לכתוב תוכן מבוסס ואותנטי.\n`
}
