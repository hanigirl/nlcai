import { SupabaseClient } from "@supabase/supabase-js"
import type { InsightKind, SourceInsight } from "@/lib/knowledge-source-processing"

// Bounds on what we inject into a generation prompt, so hooks/content
// generation stays fast no matter how many sources the user has. Only
// `active` sources feed the AI — the user curates via a per-source toggle in
// Settings.
const MAX_SOURCES = 6
/** Per-source summary, trimmed — orientation only, the insights carry the substance. */
const MAX_SUMMARY_CHARS = 300
/** Total budget for sampled insights across all sources. */
const MAX_INSIGHT_CHARS = 5000

const KIND_LABEL: Record<InsightKind, string> = {
  story: "סיפור",
  quote: "ציטוט",
  number: "נתון",
  pain: "כאב",
  opinion: "עמדה",
  tip: "טיפ",
}

type Row = { title: string; summary: string | null; insights: SourceInsight[] | null }

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Returns a preformatted Hebrew markdown block of the user's business knowledge
 * sources, ready to splice into a generation prompt — or "" when there are none
 * (so the feature is zero-impact when unused). Mirrors `fetchLearningInsights`.
 *
 * A long webinar yields far more insights than fit a prompt, so each call
 * takes a RANDOM sample, round-robin across sources (one webinar can't crowd
 * out the rest). Successive hook batches therefore draw on different moments
 * of the same material instead of re-reading the same opening paragraph.
 */
export async function fetchBusinessSourceInsights(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("business_sources")
    .select("title, summary, insights")
    .eq("user_id", userId)
    .eq("status", "ready")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_SOURCES)

  const rows = ((data as Row[] | null) ?? []).filter(
    (r) => (r.summary && r.summary.trim()) || (r.insights && r.insights.length > 0),
  )
  if (rows.length === 0) return ""

  const summaries = rows
    .filter((r) => r.summary && r.summary.trim())
    .map((r) => `- ${r.title}: ${r.summary!.trim().slice(0, MAX_SUMMARY_CHARS)}`)

  // Round-robin over per-source shuffled queues.
  const queues = rows.map((r) => ({ title: r.title, items: shuffle(r.insights ?? []) }))
  const picked: string[] = []
  let budget = MAX_INSIGHT_CHARS
  let progressed = true
  while (progressed && budget > 0) {
    progressed = false
    for (const q of queues) {
      const next = q.items.shift()
      if (!next) continue
      progressed = true
      const line = `- [${KIND_LABEL[next.kind] ?? next.kind}] ${next.text} (מתוך: ${q.title})`
      if (line.length > budget) continue
      picked.push(line)
      budget -= line.length
    }
  }

  const parts = [`\n## מקורות ידע על העסק`]
  if (summaries.length > 0) parts.push(`על מה המקורות:\n${summaries.join("\n")}`)
  if (picked.length > 0) {
    parts.push(
      `חומר גלם מתוך המקורות (סיפורים, ציטוטים, נתונים, כאבים, עמדות וטיפים שנאמרו בפועל):\n${picked.join("\n")}`,
    )
  }
  parts.push(
    `השתמשו בפרטים, בסיפורים ובניסוחים האלה כדי לכתוב תוכן מבוסס ואותנטי — הם מה שבעלת העסק באמת אמרה.\n`,
  )
  return parts.join("\n\n")
}

/**
 * Knowledge material for a hook ROUND, with ids, minus what's been used.
 *
 * Each insight gets a stable id `k:<business_source_id>:<index>` that the
 * planner cites back (source_ref) and the hook stores, so an insight that
 * became a hook isn't offered again — the transcripts stop wearing out by
 * repetition. When few unused ones are left, insights behind hooks she
 * LIKED come back, explicitly for a new angle (crossed with another pain or
 * product), never the same hook again.
 */
export async function fetchKnowledgeMaterial(
  supabase: SupabaseClient,
  userId: string,
  { usedRefs, likedRefs }: { usedRefs: Set<string>; likedRefs: Set<string> },
): Promise<{ block: string; unusedCount: number; hasSources: boolean }> {
  const { data } = await supabase
    .from("business_sources")
    .select("id, title, summary, insights")
    .eq("user_id", userId)
    .eq("status", "ready")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_SOURCES)

  const rows = ((data as (Row & { id: string })[] | null) ?? []).filter((r) => r.insights && r.insights.length > 0)
  if (rows.length === 0) return { block: "", unusedCount: 0, hasSources: false }

  type Item = { ref: string; title: string; insight: SourceInsight }
  const all: Item[][] = rows.map((r) =>
    (r.insights ?? []).map((insight, i) => ({ ref: `k:${r.id}:${i}`, title: r.title, insight })),
  )
  const unused = all.map((items) => shuffle(items.filter((it) => !usedRefs.has(it.ref))))
  const unusedCount = unused.reduce((a, q) => a + q.length, 0)

  const line = (it: Item) =>
    `- [${it.ref}] [${KIND_LABEL[it.insight.kind] ?? it.insight.kind}] ${it.insight.text} (מתוך: ${it.title})`

  // Round-robin across sources so one long webinar can't crowd out the rest.
  const picked: string[] = []
  let budget = MAX_INSIGHT_CHARS
  let progressed = true
  while (progressed && budget > 0) {
    progressed = false
    for (const q of unused) {
      const next = q.shift()
      if (!next) continue
      progressed = true
      const l = line(next)
      if (l.length > budget) continue
      picked.push(l)
      budget -= l.length
    }
  }

  const parts = [`\n## מקורות ידע על העסק`]
  const summaries = rows
    .filter((r) => r.summary && r.summary.trim())
    .map((r) => `- ${r.title}: ${r.summary!.trim().slice(0, MAX_SUMMARY_CHARS)}`)
  if (summaries.length > 0) parts.push(`על מה המקורות:\n${summaries.join("\n")}`)
  if (picked.length > 0) {
    parts.push(
      `חומר גלם מתוך המקורות — עוד לא נוצל להוקים (סיפורים, ציטוטים, נתונים, כאבים, עמדות וטיפים שנאמרו בפועל). המזהה בסוגריים המרובעים הוא ה-source_ref:\n${picked.join("\n")}`,
    )
  }
  if (unusedCount < 6) {
    const liked = all.flat().filter((it) => likedRefs.has(it.ref)).slice(0, 8)
    if (liked.length > 0) {
      parts.push(
        `תובנות שכבר הפכו להוק שהמשתמש אהב. מותר לחזור אליהן **רק** בזווית חדשה לגמרי — בשילוב כאב קהל אחר או מוצר אחר — ולא לחזור על ההוק הקודם:\n${liked.map(line).join("\n")}`,
      )
    }
  }
  return { block: parts.join("\n\n") + "\n", unusedCount, hasSources: true }
}
