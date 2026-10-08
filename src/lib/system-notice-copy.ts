import { CLAUDE_BILLING_URL } from "@/lib/claude-credits"

/**
 * What each notice says. Client-safe (no secrets) — the server only stores a
 * code, so copy can change without touching rows already raised.
 */

export type NoticeCode = "knowledge_exhausted" | "gemini_daily_limit" | "gemini_key_invalid" | "claude_credits"

export type NoticeCopy = {
  title: string
  body: string
  cta: { label: string; href: string; external?: boolean }
}

export const NOTICE_COPY: Record<NoticeCode, NoticeCopy> = {
  knowledge_exhausted: {
    title: "התמלולים שלך כמעט מוצו",
    body: "כמעט כל התובנות ממקורות הידע שלך כבר הפכו להוקים. כדי שההוקים ימשיכו להיות טריים, הוסיפי תמלול או מסמך חדש. עד אז נשלב תובנות שאהבת עם זוויות חדשות, ונשען יותר על המוצרים וכאבי הקהל.",
    cta: { label: "להוספת מקור", href: "/settings?tab=business&sub=sources" },
  },
  gemini_daily_limit: {
    title: "הגעתם למגבלה היומית של Gemini",
    body: "מפתח ה-Gemini שלכם במסלול החינמי של Google מאפשר מעט בקשות ביום, והן נגמרו להיום. עד שהמכסה תתאפס ({reset}), ההוקים נכתבים ב-Claude Sonnet (מהקרדיטים של Claude).",
    cta: { label: "לצפייה בשימוש", href: "https://aistudio.google.com/usage", external: true },
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
