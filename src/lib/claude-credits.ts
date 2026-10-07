/**
 * What a user sees when their Claude (Anthropic) key runs out of credits —
 * the `credits_exhausted` error code. One wording and one link everywhere,
 * so the message never falls back to the raw code (Hani, 2026-10-07).
 */
export const CLAUDE_CREDITS_MESSAGE = "הקרדיטים של Claude נגמרו: יש צורך לטעון קרדיטים חדשים"

/** Claude Console → Billing, where the credit balance and top-up live. */
export const CLAUDE_BILLING_URL = "https://platform.claude.com/settings/billing"

export const CLAUDE_BILLING_LABEL = "לטעינת קרדיטים ב-Claude Console ←"
