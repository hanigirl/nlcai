"use client"

import { toast } from "sonner"

/**
 * The Gemini-quota frames /api/homepage-hooks streams, turned into toasts.
 *
 * Shared because three screens read that stream with their own loops — the
 * hooks warehouse (hook-generation-provider) and the home page — and the
 * home page ignored these frames: Claude quietly wrote a whole round and
 * nothing on screen said so (Hani, 2026-10-08).
 */

export const GEMINI_USAGE_URL = "https://aistudio.google.com/usage"

/** One toast per notice code, shared with SystemNoticeToasts, so the
 *  end-of-round toast and the page-load one replace each other. */
export function noticeToastId(code: string): string {
  return `notice:${code}`
}

/** Dismiss server-side — by row id, or the user's open notice of a code. */
export function dismissNotice(target: { id: string } | { code: string }): void {
  void fetch("/api/notices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
  }).catch(() => {})
}

const usageAction = {
  label: "לצפייה בשימוש",
  onClick: () => window.open(GEMINI_USAGE_URL, "_blank", "noopener,noreferrer"),
}

/**
 * "היום ב-03:00" / "מחר ב-03:00", in the viewer's local time, from the reset
 * time Google reported. Never a guessed hour — the earlier hard-coded
 * "around 10:00" was simply wrong for Israel (Google said 03:00).
 */
export function formatResetTime(iso?: string | null): string {
  if (!iso) return "כשהמכסה היומית תתאפס"
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "כשהמכסה היומית תתאפס"
  const time = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
  const today = new Date()
  const sameDay = at.toDateString() === today.toDateString()
  return `${sameDay ? "היום" : "מחר"} ב-${time}`
}

type Frame = {
  gemini_quota_claude_fallback?: number
  gemini_quota_warning?: boolean
  daily?: boolean
  reset_at?: string | null
}

/** Shows the toast for a quota frame. Returns true if the frame was one. */
export function handleGeminiQuotaFrame(frame: Frame): boolean {
  if (typeof frame.gemini_quota_claude_fallback === "number") {
    const n = frame.gemini_quota_claude_fallback
    const reset = frame.daily ? formatResetTime(frame.reset_at) : "בעוד דקה"
    // Sticky until she closes it: she may be looking at weaker hooks right
    // now and needs to know why. Closing also dismisses the home notice.
    toast.message("המכסה של Gemini להוקים נגמרה", {
      id: frame.daily ? noticeToastId("gemini_daily_limit") : "gemini-quota",
      description: `${n === 1 ? "הוק אחד נוצר" : `${n} הוקים נוצרו`} ב-Claude Sonnet במקום Gemini (מהקרדיטים של Claude), ולכן הם עשויים להיות שונים מהרגיל. המכסה של Gemini תתאפס ${reset}.`,
      duration: Infinity,
      closeButton: true,
      action: usageAction,
      onDismiss: frame.daily ? () => dismissNotice({ code: "gemini_daily_limit" }) : undefined,
    })
    return true
  }
  if (frame.gemini_quota_warning) {
    toast.error(
      frame.daily
        ? `מפתח ה-Gemini שלכם הגיע למגבלה היומית של Google במסלול החינמי, ולכן חלק מההוקים לא נוצרו. המכסה תתאפס ${formatResetTime(frame.reset_at)}.`
        : "חלק מההוקים לא נוצרו: Google מגבילה מפתח Gemini במסלול החינמי למעט מאוד בקשות בדקה. נסו שוב בעוד דקה.",
      {
        id: frame.daily ? noticeToastId("gemini_daily_limit") : "gemini-quota",
        duration: Infinity,
        closeButton: true,
        action: usageAction,
        onDismiss: frame.daily ? () => dismissNotice({ code: "gemini_daily_limit" }) : undefined,
      },
    )
    return true
  }
  return false
}
