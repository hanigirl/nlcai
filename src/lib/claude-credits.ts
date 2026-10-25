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
