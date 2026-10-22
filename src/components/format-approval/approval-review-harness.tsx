"use client"

/**
 * DESIGN-REVIEW HARNESS — only mounted with `/project?approve=a|b`.
 * Not part of the shipped feature: delete this file when a variant ships.
 *
 *   - Sample post + media, so the canvas lands straight on the media cards
 *     (no idea → hooks → post → duplicate flow, no credits).
 *   - A scenario toggle to jump between the states the brief asks about.
 *   - A preview of how the same post reads in the core-posts list, using the
 *     real FormatStatusChip, so "approved vs not, also in the list" is
 *     reviewable from the same link.
 */

import { cn } from "@/lib/utils"
import { FormatStatusChip } from "@/components/format-status-chip"
import type { FormatReadiness } from "@/lib/timing-storage"
import type { ApprovalSeed, FormatApprovals } from "./use-format-approvals"

// Absolute URLs: the story/carousel players treat anything that isn't
// http(s)/data as a base64 payload.
// Resolved at call time, on the client only — the page seeds its media in a
// mount effect so server and client HTML agree.
const asset = (name: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/images/carousel-templates/${name}`

export const APPROVAL_SAMPLE = {
  hook: "למה הלקוחות שלכם לא חוזרים (וזה לא המחיר)",
  corePost:
    "למה הלקוחות שלכם לא חוזרים (וזה לא המחיר)\n\nרוב היועצות שאני פוגשת בטוחות שהבעיה היא התמחור. הן מורידות מחיר, מוסיפות בונוסים, ועדיין — הלקוחה נעלמת אחרי הפגישה השלישית.\n\nהבעיה היא שאין לה תמונה של הסוף. היא לא יודעת איך נראית ההצלחה שלה איתכם.\n\nבפגישה הראשונה, כתבו איתה יחד משפט אחד: \"בעוד שלושה חודשים, אני...\". תחזרו אליו בכל פגישה.\n\nכתבו לי \"סוף\" ואשלח לכם את התבנית שאני עובדת איתה.",
  formats: ["carousel", "image_post", "story"] as string[],
  formatPosts: {
    carousel:
      "שקף 1: למה הלקוחות לא חוזרים?\nשקף 2: זה לא המחיר\nשקף 3: אין להן תמונה של הסוף\nשקף 4: משפט אחד בפגישה הראשונה\nשקף 5: כתבו לי \"סוף\"",
    image_post:
      "הלקוחות שלכם לא נעלמות בגלל המחיר. הן נעלמות כי הן לא רואות את הסוף. משפט אחד בפגישה הראשונה משנה את זה.",
    story:
      "פריים 1: \"הורדתי מחיר והיא עדיין נעלמה\"\nפריים 2: זה לא המחיר\nפריים 3: כתבו לי \"סוף\"",
  } as Record<string, string>,
  get carouselImages() {
    return [asset("ai-light.png"), asset("ai-amber.png"), asset("ai-minimal.png")]
  },
  get imagePostUrl() {
    return asset("soft.png")
  },
  get storyImages() {
    return [asset("ai-vibrant.png"), asset("ai-ice.png")]
  },
  get altImageUrl() {
    return asset("ai-collage.png")
  },
}

export type ApprovalScenario = "none" | "partial" | "all" | "scheduled" | "edited" | "missing"

const SCENARIOS: { id: ApprovalScenario; label: string }[] = [
  { id: "none", label: "טרם אושר" },
  { id: "partial", label: "חלק מאושר" },
  { id: "all", label: "הכל מאושר" },
  { id: "scheduled", label: "חלק תוזמן" },
  { id: "edited", label: "נערך אחרי אישור" },
  { id: "missing", label: "חסרה מדיה" },
]

export function seedForScenario(s: ApprovalScenario): ApprovalSeed {
  switch (s) {
    case "none":
    case "missing":
      return { approved: [], edited: [] }
    case "partial":
      return { approved: ["carousel"], edited: [] }
    case "all":
      return { approved: ["carousel", "image_post", "story"], edited: [] }
    case "scheduled":
      return { approved: ["carousel", "image_post"], edited: [], scheduled: ["carousel"] }
    case "edited":
      return { approved: ["carousel"], edited: ["image_post"] }
  }
}

export function ApprovalReviewHarness({
  variant,
  scenario,
  onScenarioChange,
  approvals,
  formats,
}: {
  variant: "a" | "b"
  scenario: ApprovalScenario
  onScenarioChange: (s: ApprovalScenario) => void
  approvals: FormatApprovals
  formats: string[]
}) {
  // Project the live approval state onto the readiness the list card reads.
  const readinessFor = (f: string): FormatReadiness => {
    const s = approvals.statusOf(f)
    return s === "scheduled" ? "scheduled" : s === "approved" ? "approved" : s === "no-media" ? "incomplete" : "ready"
  }

  return (
    <div
      dir="rtl"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2"
    >
      <div className="flex items-center gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-1 shadow-[0_8px_24px_rgb(0_0_0_/_0.08)]">
        <span className="px-2 text-xs text-text-neutral-default whitespace-nowrap">
          בדיקת מצבים — אישור מדיה ({variant === "a" ? "א׳" : "ב׳"})
        </span>
        <div role="group" aria-label="מצב תצוגה" className="flex items-center gap-1">
          {SCENARIOS.map((s) => {
            const active = s.id === scenario
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => onScenarioChange(s.id)}
                className={cn(
                  "h-8 rounded-[8px] px-3 text-small whitespace-nowrap transition-colors cursor-pointer",
                  active
                    ? "bg-bg-surface-primary-default-80 text-text-primary-default"
                    : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20",
                )}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* How the same post reads in the core-posts list (real chip component). */}
      <div className="flex items-center gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0_/_0.08)]">
        <span className="text-xs text-text-neutral-default whitespace-nowrap">ברשימת פוסטי הליבה:</span>
        <div className="flex flex-wrap gap-1">
          {formats.map((f) => (
            <FormatStatusChip key={f} format={f} state={readinessFor(f)} size="sm" />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-text-neutral-default bg-white/80 dark:bg-gray-10/80 rounded px-2">
        תצוגת בדיקה: אין קריאה ל-AI, אין שמירה. כפתורי העריכה מדמים עריכה כדי להראות שהאישור מתבטל.
      </p>
    </div>
  )
}
