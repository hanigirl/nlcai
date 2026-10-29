"use client"

/**
 * REVIEW HARNESS — design review of "עריכה עם AI לקופי של כל פורמט" only.
 * Delete this file (and its one mount in project/page.tsx) when a direction
 * is picked; the picked direction keeps use-format-copy-ai + its UI file.
 *
 * /project?copyedit=a|b[&state=idle|open|generating|proposal|error]
 *
 * Lands straight on the format cards with sample copy: no idea → hook → post
 * flow, no model call (a local responder answers), no DB row (savedPostId
 * stays null, so every autosave on the page no-ops).
 */

import { useCallback, useEffect, useMemo, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { COPY_REFINE_ERROR_COPY, type CopyFormat } from "@/lib/format-copy-refine"
import {
  COPY_AI_REVIEW_STATES,
  type CopyAiReviewState,
  type CopyAiVariant,
  type CopyRefineResponder,
} from "./use-format-copy-ai"

export interface CopyEditReview {
  variant: CopyAiVariant
  state: CopyAiReviewState | null
}

/** Reads ?copyedit=a|b&state=… — null when the param is absent (production). */
export function useCopyEditReview(): CopyEditReview | null {
  const params = useSearchParams()
  const v = params.get("copyedit")
  const s = params.get("state") as CopyAiReviewState | null
  return useMemo(() => {
    if (v !== "a" && v !== "b") return null
    return { variant: v, state: s && COPY_AI_REVIEW_STATES.includes(s) ? s : null }
  }, [v, s])
}

/** The format every state link opens on, and the request it sends. */
export const REVIEW_FOCUS_FORMAT: CopyFormat = "carousel"
export const REVIEW_INSTRUCTION = "תקצרו לי את זה ל-4 שקופיות"

export const REVIEW_HOOK = "שלוש שאלות ששאלתי את עצמי לפני שהעליתי מחיר"

export const REVIEW_CORE_POST = `${REVIEW_HOOK}

שנה שלמה פחדתי לגעת במחיר. כל פגישת מכירה הרגישה כמו התנצלות.

ואז ישבתי עם עצמי ושאלתי שלוש שאלות.

מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים איתי? זה מה שהם קונים.
מי מהם היה משלם יותר בלי לחשוב פעמיים? בדרך כלל אלה שהכי קל לעבוד איתם.
מה הכי גרוע שיקרה אם מישהו יגיד לא? גיליתי שכמעט אף אחד לא אמר.

רוצות את שלוש השאלות בקובץ אחד? כתבו "מחיר" בתגובות.`

export const REVIEW_FORMAT_POSTS: Record<CopyFormat, string> = {
  carousel: `שקופית 1
${REVIEW_HOOK}

שקופית 2
שנה שלמה פחדתי לגעת במחיר. כל פגישת מכירה הרגישה כמו התנצלות.

שקופית 3
שאלה 1: מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים איתי? זה מה שהם קונים.

שקופית 4
שאלה 2: מי מהם היה משלם יותר בלי לחשוב פעמיים? בדרך כלל אלה שהכי קל לעבוד איתם.

שקופית 5
שאלה 3: מה הכי גרוע שיקרה אם מישהו יגיד לא? גיליתי שכמעט אף אחד לא אמר.

שקופית 6
רוצות את שלוש השאלות בקובץ אחד? כתבו "מחיר" בתגובות ואשלח לכן.`,
  story: `${REVIEW_HOOK}

שנה פחדתי לגעת במחיר.
ואז שאלתי את עצמי מה באמת משתנה אצל הלקוחות שלי.
התשובה שינתה לי את כל פגישות המכירה.

רוצות את השאלות? שלחו לי "מחיר" בהודעה.`,
  talking_head: `${REVIEW_HOOK}.

שנה שלמה פחדתי לגעת במחיר. כל פגישת מכירה הרגישה לי כמו התנצלות.
אז עצרתי ושאלתי את עצמי שלוש שאלות.
אחת, מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים איתי? כי זה מה שהם קונים.
שתיים, מי מהם היה משלם יותר בלי לחשוב פעמיים? בדרך כלל אלה שהכי כיף לעבוד איתם.
ושלוש, מה הכי גרוע שיקרה אם מישהו יגיד לא?
גיליתי שכמעט אף אחד לא אמר.
רוצות את השאלות בקובץ? כתבו לי "מחיר" בתגובות.`,
  image_post: `${REVIEW_HOOK}

שנה שלמה פחדתי לגעת במחיר.
ואז שאלתי את עצמי: מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים? מי מהם היה משלם יותר בלי לחשוב? ומה הכי גרוע שיקרה אם מישהו יגיד לא?

כמעט אף אחד לא אמר.

כתבו "מחיר" בתגובות ואשלח לכן את השאלות.`,
  b_roll: REVIEW_HOOK,
}

/** What the local responder writes back — the same revision a real run aims for. */
const REVIEW_REVISIONS: Record<CopyFormat, { reply: string; revisedText: string }> = {
  carousel: {
    reply: "איחדתי את שלוש השאלות לשקופית אחת וקיצרתי את הפתיחה. עכשיו יש 4 שקופיות.",
    revisedText: `שקופית 1
${REVIEW_HOOK}

שקופית 2
שנה שלמה פחדתי לגעת במחיר. שלוש שאלות שינו את זה.

שקופית 3
1. מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים איתי?
2. מי מהם היה משלם יותר בלי לחשוב פעמיים?
3. מה הכי גרוע שיקרה אם מישהו יגיד לא?

שקופית 4
רוצות את השאלות בקובץ? כתבו "מחיר" בתגובות.`,
  },
  story: {
    reply: "קיצרתי לפריים אחד: הוק, משפט אחד והנעה לפעולה.",
    revisedText: `${REVIEW_HOOK}

שאלה אחת שינתה לי את כל פגישות המכירה.

שלחו לי "מחיר" בהודעה.`,
  },
  talking_head: {
    reply: "קיצרתי לכ-30 שניות ושמרתי את שלוש השאלות.",
    revisedText: `${REVIEW_HOOK}.

שנה פחדתי לגעת במחיר.
אז שאלתי: מה משתנה אצל הלקוחות שלי? מי מהם היה משלם יותר? ומה הכי גרוע שיקרה אם יגידו לא?
כמעט אף אחד לא אמר.
כתבו לי "מחיר" ואשלח לכן את השאלות.`,
  },
  image_post: {
    reply: "קיצרתי את הכיתוב והשארתי את ההנעה לפעולה בסוף.",
    revisedText: `${REVIEW_HOOK}

שנה פחדתי לגעת במחיר. שלוש שאלות, וכמעט אף אחד לא אמר לא.

כתבו "מחיר" בתגובות ואשלח לכן אותן.`,
  },
  b_roll: {
    reply: "קיצרתי את הטקסט על המסך לשש מילים.",
    revisedText: "3 שאלות לפני שהעליתי מחיר",
  },
}

/**
 * Local stand-in for /api/format/refine. "generating" never answers (the
 * loading state holds still); "error" fails the first call only, so "ניסיון
 * חוזר" then shows the recovery.
 */
export function useReviewResponder(state: CopyAiReviewState | null): CopyRefineResponder {
  const failedOnceRef = useRef(false)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
    failedOnceRef.current = false
  }, [state])

  return useCallback(async ({ format }) => {
    const s = stateRef.current
    if (s === "generating") return new Promise<never>(() => {})
    await new Promise((r) => setTimeout(r, s === "proposal" ? 350 : 1400))
    if (s === "error" && !failedOnceRef.current) {
      failedOnceRef.current = true
      throw new Error(COPY_REFINE_ERROR_COPY.anthropic_overloaded)
    }
    return REVIEW_REVISIONS[format]
  }, [])
}

const STATE_LABEL: Record<CopyAiReviewState, string> = {
  idle: "סגור",
  open: "פתוח",
  generating: "בזמן יצירה",
  proposal: "הצעה לשינוי",
  error: "שגיאה",
}

/**
 * Review-only bar pinned to the top of the canvas: switch A/B and jump between
 * states without driving the flow. Each choice is a real URL, so what's on
 * screen always matches a shareable link.
 */
export function CopyEditStateToggle({ review }: { review: CopyEditReview }) {
  const pathname = usePathname()
  const go = (variant: CopyAiVariant, state: CopyAiReviewState | null) => {
    const q = new URLSearchParams({ copyedit: variant })
    if (state) q.set("state", state)
    // Full reload: every state starts from the same seeded copy.
    window.location.assign(`${pathname}?${q.toString()}`)
  }
  const current = review.state ?? "idle"

  return (
    <div
      dir="rtl"
      className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-1.5 shadow-md"
    >
      <span className="text-xs-body text-text-neutral-default">תצוגת סקירה</span>
      <div className="flex rounded-full bg-bg-surface p-0.5" role="group" aria-label="בחירת כיוון">
        {(["a", "b"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={review.variant === v}
            onClick={() => go(v, review.state)}
            className={cn(
              "rounded-full px-3 py-1 text-xs-body transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
              review.variant === v
                ? "bg-button-primary-default text-white"
                : "text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20",
            )}
          >
            אופציה {v.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex rounded-full bg-bg-surface p-0.5" role="group" aria-label="בחירת מצב">
        {COPY_AI_REVIEW_STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={current === s}
            onClick={() => go(review.variant, s === "idle" ? null : s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs-body transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
              current === s
                ? "bg-bg-surface-primary-default-80 text-text-primary-default"
                : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20",
            )}
          >
            {STATE_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  )
}
