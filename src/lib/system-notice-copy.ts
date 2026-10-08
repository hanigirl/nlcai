import { CLAUDE_BILLING_URL } from "@/lib/claude-credits"

/**
 * What each notice says. Client-safe (no secrets) — the server only stores a
 * code, so copy can change without touching rows already raised.
 */

export type NoticeCode = "serper_credits" | "gemini_daily_limit" | "gemini_key_invalid" | "claude_credits"

export type NoticeCopy = {
  title: string
  body: string
  cta: { label: string; href: string; external?: boolean }
}

export const NOTICE_COPY: Record<NoticeCode, NoticeCopy> = {
  serper_credits: {
    title: "נגמרו הקרדיטים ב-Serper — חיפוש הטרנדים לא עובד",
    body: "חשבון ה-Serper של האפליקציה נכשל, ולכן ההוקים ועמוד הרעיונות נכתבים בלי טרנדים מהרשת. זה חשבון של האפליקציה, ורק מנהלות רואות את ההודעה הזו. היא תיעלם לבד ברגע שהחיפוש יעבוד שוב.",
    cta: { label: "לטעינת קרדיטים", href: "https://serper.dev/billing", external: true },
  },
  gemini_daily_limit: {
    title: "הגעתם למגבלה היומית של Gemini",
    body: "מפתח ה-Gemini שלכם במסלול החינמי של Google מאפשר מעט בקשות ביום, והן נגמרו להיום. ייצור ההוקים יחזור לעבוד כשהמגבלה תתאפס, בסביבות 10:00 בבוקר.",
    cta: { label: "לצפייה במגבלות שלי", href: "https://aistudio.google.com/rate-limit", external: true },
  },
  gemini_key_invalid: {
    title: "מפתח ה-Gemini לא תקף",
    body: "Google דוחה את המפתח שמחובר, ולכן אי אפשר לייצר הוקים. צרו מפתח חדש ב-Google AI Studio וחברו אותו מחדש.",
    cta: { label: "לחיבור מחדש", href: "/settings?tab=connections&sub=gemini" },
  },
  claude_credits: {
    title: "נגמרו הקרדיטים ב-Claude",
    body: "Claude מתכנן את ההוקים ומנתח את המקורות שלכם. בלי קרדיטים זה לא יעבוד עד שתטענו קרדיטים חדשים.",
    cta: { label: "לטעינת קרדיטים", href: CLAUDE_BILLING_URL, external: true },
  },
}

export function isNoticeCode(code: string): code is NoticeCode {
  return code in NOTICE_COPY
}
