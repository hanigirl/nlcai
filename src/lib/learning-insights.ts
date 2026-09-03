import Anthropic from "@anthropic-ai/sdk"
import { SupabaseClient } from "@supabase/supabase-js"

export type LearningContentType = "hook" | "core_post"
export type LearningSource = "manual_edit" | "chat_instruction"
export type LearningOutcome = "accepted" | "rejected"

/** Rows pulled into a generation prompt. Was 30 — see MAX_DEDUP_ROWS. */
const MAX_PROMPT_ROWS = 60
/**
 * Rows shown to the dedup check. Deliberately larger than MAX_PROMPT_ROWS:
 * when both were 30, an insight that had aged out of the window came back as
 * "new" on the next edit, so the table slowly filled with re-learned dupes.
 */
const MAX_DEDUP_ROWS = 200
/** Per-section cap so one noisy signal type can't crowd out the other. */
const MAX_PER_SECTION = 25

interface InsightRow {
  insight: string
  outcome: LearningOutcome | null
}

/**
 * Returns a preformatted Hebrew markdown block of what we've learned about the
 * user's preferences, ready to splice into a generation prompt — or "" when
 * there's nothing learned yet.
 *
 * Two sections, because they steer the model differently: things the user
 * wants (derived from their edits and from revisions they kept) and things
 * that didn't work (derived from revisions they explicitly reverted).
 */
export async function fetchLearningInsights(
  supabase: SupabaseClient,
  userId: string,
  contentType?: LearningContentType
): Promise<string> {
  const run = async (columns: string) => {
    let query = supabase
      .from("learning_logs")
      .select(columns)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_PROMPT_ROWS)

    if (contentType) {
      query = query.eq("content_type", contentType)
    }
    return query
  }

  // eslint-disable-next-line prefer-const
  let { data, error } = await run("insight, outcome")
  // Pre-migration-025 schema has no `outcome`; fall back so insight injection
  // keeps working rather than degrading to "no preferences learned".
  if (error) {
    ;({ data } = await run("insight"))
  }

  const rows = ((data ?? []) as unknown as InsightRow[]).filter((r) => r?.insight)
  if (rows.length === 0) return ""

  const bullet = (r: InsightRow) => `- ${r.insight}`
  // Manual edits (outcome null) are implicit preferences, so they group with
  // the accepted ones; only an explicit revert is a negative signal.
  const preferences = rows.filter((r) => r.outcome !== "rejected").slice(0, MAX_PER_SECTION).map(bullet)
  const rejections = rows.filter((r) => r.outcome === "rejected").slice(0, MAX_PER_SECTION).map(bullet)

  let block = ""
  if (preferences.length > 0) {
    // Framed as binding, and placed high in the generation prompt rather than
    // appended at the end. It used to sit after the writing rules, where a
    // learned "don't strip the detail when you shorten" was read as a footnote
    // to six separate instructions demanding brevity — and lost every time.
    block += `\n## מה שכבר למדנו על הסגנון של המשתמש (מחייב — נגזר מתיקונים שהוא עצמו עשה)\n${preferences.join("\n")}\n\nההעדפות האלה נלמדו מהתיקונים של המשתמש עצמו, ולכן הן גוברות על הנחיות סגנון כלליות. אם אחת מהן מתנגשת עם כלל אחר בפרומפט — היא מנצחת.\n`
  }
  if (rejections.length > 0) {
    block += `\n## מה כבר ניסינו והמשתמש דחה (אל תחזור על זה)\n${rejections.join("\n")}\n`
  }
  return block
}

interface RecordInsightInput {
  userId: string
  contentType: LearningContentType
  originalText: string
  editedText: string
  source?: LearningSource
  outcome?: LearningOutcome | null
  /** The user's verbatim request, when the change came from the chat flow. */
  instruction?: string | null
}

interface RecordInsightResult {
  insight: string | null
  duplicate: boolean
}

function buildInsightPrompt({
  originalText,
  editedText,
  source,
  outcome,
  instruction,
  existingList,
}: {
  originalText: string
  editedText: string
  source: LearningSource
  outcome: LearningOutcome | null
  instruction: string | null
  existingList: string
}): string {
  // A reverted revision is the one place we learn what NOT to do, so it gets
  // its own framing — asking for "the user's preference" on text they threw
  // away produces an insight that pushes the model toward the rejected style.
  const task =
    source === "chat_instruction" && outcome === "rejected"
      ? `המשתמש ביקש שינוי, ה-AI הציע גרסה, והמשתמש **ביטל** אותה.
נסח תובנה אחת קצרה בעברית (משפט אחד) על מה בגרסה שהוצעה לא עבד ויש להימנע ממנו בעתיד.
נסח אותה כהוראת הימנעות ("להימנע מ...", "לא ל...").`
      : source === "chat_instruction"
        ? `המשתמש ביקש שינוי, ה-AI הציע גרסה, והמשתמש **אישר** אותה.
גזור תובנה אחת קצרה בעברית (משפט אחד) על ההעדפה או הסגנון שלו, בעיקר מתוך מה שביקש במילים שלו.`
        : `נתח מה המשתמש שינה ולמה, וגזור תובנה אחת קצרה בעברית (משפט אחד) על ההעדפה או הסגנון שלו.`

  // Without this, extraction skews almost entirely structural — "moved the CTA",
  // "dropped the bio opener". An audit of the stored insights found the register
  // signal missing almost completely, even though restoring everyday wording and
  // re-expanding examples is the most common correction the user makes.
  const voiceLens = `
## למה לשים לב במיוחד
מעבר לשינויי מבנה (מה זז, מה נמחק), בדוק גם את **רובד הניסוח**, שהוא לרוב החשוב יותר:
- האם המשתמש החזיר מילים יומיומיות או סלנג שה-AI החליף בניסוח מלוטש? אם כן — התובנה צריכה לנקוב במילים עצמן.
- האם הוא הרחיב דוגמה או סיפור שה-AI כיווץ? זה סימן שהדוגמאות אצלו הן עיקר ולא קישוט.
- האם הוא פירק משפט "אסוף" לניסוח מדובר יותר?
עדיף תובנה על ניסוח וקול מאשר תובנה על סדר הפסקאות, כשהשתנו שניהם.`

  const instructionSection = instruction
    ? `\n## מה המשתמש ביקש (במילים שלו):\n${instruction}\n`
    : ""

  const labels =
    source === "chat_instruction"
      ? { before: "הגרסה שהייתה לפני השינוי", after: "הגרסה שה-AI הציע" }
      : { before: "הטקסט המקורי (שה-AI יצר)", after: "הטקסט אחרי עריכת המשתמש" }

  return `אתה מנתח משוב שמשתמש נתן על טקסט שנוצר על ידי AI.
${instructionSection}
## ${labels.before}:
${originalText}

## ${labels.after}:
${editedText}

## תובנות קיימות שכבר נשמרו על המשתמש הזה:
${existingList}

## משימה:
${task}
${voiceLens}

לפני שאתה מחזיר את התובנה, בדוק האם היא כבר קיימת ברשימה למעלה — לא חיפוש מילולי אלא בדיקה מהותית. למשל "מעדיף הוקים קצרים" ו"מקצר את ה-hook" הן אותה תובנה.

## פלט (חובה אחד מהשניים):
- אם התובנה היא חדשה ולא מופיעה ברשימה → החזר את התובנה עצמה, משפט אחד בעברית, בלי גרשיים, בלי מספור.
- אם התובנה כבר קיימת ברשימה (מהותית) → החזר בדיוק את המילה: DUPLICATE

אסור בשום מקרה: ניתוח של העריכות, כותרות (#), רשימות, הסברים על תהליך החשיבה, או ציטוט של הטקסטים. שורה אחת בלבד. תשובה שהיא יותר ממשפט אחד היא תשובה שגויה.`
}

/**
 * Distills the model's raw reply down to the single-sentence insight we asked
 * for — or null when there isn't one worth storing.
 *
 * Exists because Haiku ignores the one-sentence instruction often enough to
 * matter: an audit of production data found 55 of 64 stored "insights" were
 * full markdown edit-analyses (some truncated mid-word by max_tokens), and one
 * had DUPLICATE appended after the sentence — which the strict `!== "DUPLICATE"`
 * check then stored verbatim. All of that was being spliced into every
 * generation prompt.
 *
 * Exported for the one-off cleanup script that re-derives the polluted rows.
 */
export function sanitizeInsight(raw: string): { insight: string | null; duplicate: boolean } {
  const text = raw
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
  if (!text) return { insight: null, duplicate: false }

  // Anywhere, not just exact-match — the model sometimes appends or prefixes
  // its duplicate verdict to a restated insight.
  if (/\bDUPLICATE\b/.test(text)) return { insight: null, duplicate: true }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)

  // Single clean line — the well-behaved case.
  let candidate = lines.length === 1 ? lines[0] : null

  // Multi-line analysis: salvage the line following a "התובנה" heading if
  // there is one; otherwise there's no reliable way to pick the insight out
  // of the prose, and storing the whole analysis is worse than storing nothing.
  if (!candidate) {
    const idx = lines.findIndex((l) => /^(\*\*|#{1,4}\s*)?התובנה/.test(l))
    if (idx !== -1 && idx + 1 < lines.length) candidate = lines[idx + 1]
  }
  if (!candidate) return { insight: null, duplicate: false }

  candidate = candidate
    .replace(/^#{1,4}\s*/, "")
    .replace(/^[-*\d.]+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^"|"$/g, "")
    .trim()

  // Length gates: too short to mean anything, or long enough that it's prose
  // (and possibly truncated mid-sentence by max_tokens) rather than a sentence.
  if (candidate.length < 10 || candidate.length > 300) return { insight: null, duplicate: false }
  if (/^#|\*\*/.test(candidate)) return { insight: null, duplicate: false }

  return { insight: candidate, duplicate: false }
}

/**
 * Derives a one-sentence insight from a piece of user feedback and stores it,
 * unless an equivalent insight is already on file.
 *
 * Shared by the manual-edit endpoint and the chat refine flow so both kinds of
 * signal land in the same table with the same dedup semantics.
 */
export async function recordLearningInsight(
  supabase: SupabaseClient,
  apiKey: string,
  {
    userId,
    contentType,
    originalText,
    editedText,
    source = "manual_edit",
    outcome = null,
    instruction = null,
  }: RecordInsightInput
): Promise<RecordInsightResult> {
  // Nothing changed — no signal to learn from.
  if (originalText.trim() === editedText.trim()) {
    return { insight: null, duplicate: false }
  }

  const { data: existingLogs } = await supabase
    .from("learning_logs")
    .select("insight")
    .eq("user_id", userId)
    .eq("content_type", contentType)
    .order("created_at", { ascending: false })
    .limit(MAX_DEDUP_ROWS)

  const existingInsights = ((existingLogs as { insight: string }[] | null) ?? [])
    .map((l) => l.insight)
    .filter(Boolean)
  const existingList = existingInsights.length
    ? existingInsights.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "(אין תובנות קודמות)"

  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: buildInsightPrompt({
          originalText,
          editedText,
          source,
          outcome,
          instruction,
          existingList,
        }),
      },
    ],
  })

  const textBlock = message.content.find((b) => b.type === "text")
  const { insight, duplicate } = sanitizeInsight(textBlock?.text ?? "")

  if (!insight) {
    return { insight: null, duplicate }
  }

  const base = {
    user_id: userId,
    content_type: contentType,
    original_text: originalText,
    edited_text: editedText,
    insight,
  }

  const { error } = await supabase
    .from("learning_logs")
    .insert({ ...base, source, outcome, instruction })

  // Migration 025 adds source/outcome/instruction. It's applied by hand, so a
  // deploy can land ahead of it — in that case keep capturing the insight
  // (losing only the signal metadata) instead of silently dropping every
  // learning event on the floor.
  if (error?.code === "PGRST204" || /column .* does not exist/i.test(error?.message ?? "")) {
    console.warn(
      "[learning] learning_logs is missing the 025 signal columns — run supabase/migrations/025_learning_logs_signals.sql",
    )
    await supabase.from("learning_logs").insert(base)
  } else if (error) {
    throw new Error(error.message)
  }

  return { insight, duplicate: false }
}
