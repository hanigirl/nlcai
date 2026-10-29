import { CLAUDE_KEY_INVALID_MESSAGE } from "@/lib/claude-credits"

/**
 * What an AI edit panel shows when a request fails — always Hebrew, always
 * saying what happened (Hani, 2026-10-29: "Failed to fetch" reached the
 * panel as is). A message that is already Hebrew came from our own routes
 * and is kept; raw browser / provider errors are translated.
 */
export function aiErrorMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : ""
  if (/[֐-׿]/.test(text)) return text
  if (/failed to fetch|networkerror|load failed|network request failed|err_network|connection/i.test(text)) {
    return "החיבור לשרת נקטע באמצע העבודה, אז העריכה לא הסתיימה. בדקו את החיבור לאינטרנט ונסו שוב."
  }
  if (/timeout|timed out|\b504\b|function_invocation_timeout|aborted/i.test(text)) {
    return "העריכה לקחה יותר זמן ממה שמותר, והיא נעצרה. נסו שוב, או בקשה קצרה יותר."
  }
  if (/\b401\b|invalid x-api-key|authentication/i.test(text)) return CLAUDE_KEY_INVALID_MESSAGE
  if (/\b429\b|\b529\b|rate.?limit|overloaded|quota/i.test(text)) {
    return "שירות ה-AI עמוס כרגע. חכו דקה ונסו שוב."
  }
  return "משהו השתבש בעריכה, והיא לא הסתיימה. נסו שוב."
}

/** The red error box the panels share (same tokens as the app's other error alerts). */
export const AI_ERROR_BOX =
  "rounded-xl border border-red-90 bg-red-95 px-3 py-2 text-small leading-relaxed text-button-destructive-default dark:border-red-90/25 dark:bg-red-95/10"
