import type { VisualFormat } from "@/lib/visual-language/types"

/**
 * The visual memory of the AI-edit chat — client-safe half (Hani, 2026-11-05).
 *
 * Every message in "עריכה עם AI" on media is checked against two things
 * before the edit runs (lib/style-memory → triageVisualMemory):
 *
 *   1. Her SETTINGS — brand colours, fonts and brand elements live in
 *      Settings → שפה ויזואלית and nowhere else. A lasting request for a
 *      colour / font / element the settings don't have is not saved: the
 *      chat says to put it in the visual-language settings, with a link.
 *   2. Her saved PREFERENCES — how things move, enter and change, layout
 *      habits, a decoration the AI draws. A new lasting one is saved ("שמרתי
 *      את הנתונים."); one that goes against an earlier preference is not
 *      saved on its own — the chat asks: across the board, or just this edit?
 *
 * The saved preferences are listed per format in Settings → מדיה →
 * העדפות ויזואליות, where she can edit or delete any of them.
 */

/** Which format a preference applies to; "all" = every format. */
export type RuleScope = VisualFormat | "all"

/** The tabs under העדפות ויזואליות, in order. */
export const RULE_SCOPES: { id: RuleScope; label: string }[] = [
  { id: "all", label: "כל הפורמטים" },
  { id: "carousel", label: "קרוסלה" },
  { id: "story", label: "סטורי" },
  { id: "image_post", label: "תמונה" },
  { id: "b_roll", label: "בי-רול" },
]

export function isRuleScope(v: unknown): v is RuleScope {
  return RULE_SCOPES.some((s) => s.id === v)
}

/** One saved preference as the settings tab shows it. */
export interface VisualPreference {
  id: string
  /** Hebrew, the way she reads and edits it. */
  summary_he: string
  scope: RuleScope
  at: string
}

export type SettingsTopic = "colors" | "fonts" | "elements"

/** What the chat answers about memory for one message. */
export type MemoryOutcome =
  /** Nothing lasting in it (a one-off edit). `explicit`: she asked to save anyway. */
  | { kind: "none"; explicit?: boolean }
  /** Saved as a new preference ("שמרתי את הנתונים."). */
  | { kind: "saved"; id: string; summary: string; scope: RuleScope; replaced?: boolean }
  /** Taken back with "ביטול". */
  | { kind: "undone"; summary: string }
  /** A colour / font / brand element the settings don't have — goes there. */
  | { kind: "settings"; topics: SettingsTopic[]; summary: string }
  /** Goes against an earlier preference — waiting for her answer. */
  | {
      kind: "conflict"
      previous: { id: string; summary: string }[]
      proposal: { rule: string; summary_he: string; scope: RuleScope }
    }
  /** She answered "רק בעריכה הזו": the earlier preference stays. */
  | { kind: "kept"; previous: string[] }
  /** The check itself failed (no Claude key, an error) — the edit still runs. */
  | { kind: "error"; message: string }

export interface TriageResult {
  /** Does the message ask to change the media on screen now? */
  edit: boolean
  /** The change to make now, without the "remember" part. */
  editInstruction: string
  memory: MemoryOutcome
}

/** Settings → מדיה → שפה ויזואלית (colours, fonts, brand elements). */
export const VISUAL_SETTINGS_HREF = "/settings?tab=media&sub=visual"
/** Settings → מדיה → העדפות ויזואליות. */
export const VISUAL_PREFERENCES_HREF = "/settings?tab=media&sub=preferences"

export const SETTINGS_TOPIC_LABEL: Record<SettingsTopic, string> = {
  colors: "צבעים",
  fonts: "פונטים",
  elements: "אלמנטים של המותג",
}

/** The headline the chat says for an outcome (also the bubble when no edit ran). */
export function memoryHeadline(m: MemoryOutcome): string | null {
  switch (m.kind) {
    case "saved":
      return m.replaced ? "עדכנתי את ההעדפה." : "שמרתי את הנתונים."
    case "settings":
      return "יש להכניס את זה בהגדרות השפה הוויזואלית שלכם."
    case "conflict":
      return "זה סותר העדפה ששמרתם קודם."
    case "kept":
      return "בסדר, רק בעריכה הזו. ההעדפה הקודמת נשארת."
    case "undone":
      return "ביטלתי. זה לא נשמר."
    case "none":
      return m.explicit ? "לא מצאתי כאן העדפה ויזואלית לשמור. זה נראה כמו שינוי חד־פעמי בתוכן." : null
    case "error":
      return "לא הצלחנו לבדוק את ההעדפות הוויזואליות הפעם. העריכה עצמה ממשיכה."
  }
}

async function postJson<T>(body: unknown, method = "POST"): Promise<T> {
  let res: Response
  try {
    res = await fetch("/api/visual-language/style-memory", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("שגיאת רשת. נסו שוב.")
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string }
  if (!res.ok) throw new Error(data.message ?? data.error ?? `status ${res.status}`)
  return data
}

/** Check one chat message against her settings and saved preferences. */
export function triageMessage(input: {
  instruction: string
  format: VisualFormat
  /** She tapped "לשמור לשפה הוויזואלית שלי" — save it unless it belongs in settings. */
  explicit?: boolean
  /** Her request before this one, for "save this" / "remember that". */
  previousInstruction?: string
  references?: string[]
}): Promise<TriageResult> {
  return postJson<TriageResult>({ action: "triage", ...input })
}

/** "באופן רוחבי": the new preference replaces the ones it contradicts. */
export function applyAcrossTheBoard(
  previous: { id: string }[],
  proposal: { rule: string; summary_he: string; scope: RuleScope },
): Promise<{ id: string; summary: string; scope: RuleScope }> {
  return postJson({ action: "replace", replaceIds: previous.map((p) => p.id), proposal })
}

/** Delete one preference (the chat's "ביטול", or the settings tab). */
export function deletePreference(id: string): Promise<{ removed: boolean }> {
  return postJson({ id }, "DELETE")
}

/** Edit one preference's text (settings tab); the English rule is re-written from it. */
export function updatePreference(id: string, summaryHe: string): Promise<{ preference: VisualPreference }> {
  return postJson({ id, summary_he: summaryHe }, "PATCH")
}
