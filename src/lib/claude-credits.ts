/**
 * What a user sees when their Claude (Anthropic) key runs out of credits —
 * the `credits_exhausted` error code. One wording and one link everywhere,
 * so the message never falls back to the raw code (Hani, 2026-10-07).
 */
export const CLAUDE_CREDITS_MESSAGE = "הקרדיטים של Claude נגמרו: יש צורך לטעון קרדיטים חדשים"

/** Claude Console → Billing, where the credit balance and top-up live. */
export const CLAUDE_BILLING_URL = "https://platform.claude.com/settings/billing"

export const CLAUDE_BILLING_LABEL = "לטעינת קרדיטים ב-Claude Console ←"

/**
 * Her Claude key was rejected by Anthropic (401 invalid x-api-key): deleted,
 * revoked, or pasted wrong. Code `anthropic_key_invalid` — before this the
 * raw "401 {"type":"error",...}" reached the screen (Hani, 2026-10-25).
 */
export const CLAUDE_KEY_INVALID_MESSAGE =
  "מפתח ה-Claude שמחובר לא תקין או שבוטל. צרו מפתח חדש ב-Claude Console והדביקו אותו בהגדרות"

export const CLAUDE_KEY_SETTINGS_URL = "/settings?tab=connections&sub=claude"

export const CLAUDE_KEY_SETTINGS_LABEL = "לעדכון המפתח בהגדרות ←"

/** Anthropic's own wording for a rejected key — not any 401 (ours or OpenAI's). */
export function isInvalidClaudeKey(msg: string): boolean {
  return /invalid x-api-key|"authentication_error"/i.test(msg)
}

/**
 * A provider error she can act on, in plain Hebrew — or null when it isn't
 * one we know. Raw Anthropic JSON ("400 {"type":"error",…credit balance is
 * too low…}") reached the AI chat (bug report, Nataliya 2026-11-15), so every
 * route that echoes an error passes it through here first.
 */
export function knownProviderError(msg: string): string | null {
  if (/credit balance is too low|credits_exhausted/i.test(msg)) {
    return `${CLAUDE_CREDITS_MESSAGE}, ולכן לא שינינו כלום. טענו קרדיטים ב-Claude Console (platform.claude.com/settings/billing) ונסו שוב.`
  }
  if (isInvalidClaudeKey(msg)) return `${CLAUDE_KEY_INVALID_MESSAGE} (הגדרות ← חיבור חשבונות).`
  if (/rate.?limit|"rate_limit_error"|\b429\b/i.test(msg)) return "יותר מדי בקשות ל-Claude בבת אחת. נסו שוב בעוד דקה."
  if (/overloaded|\b529\b/i.test(msg)) return "Claude עמוס כרגע. נסו שוב בעוד כמה רגעים."
  return null
}
