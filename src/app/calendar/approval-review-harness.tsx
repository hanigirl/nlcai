"use client"

/**
 * REVIEW HARNESS — DELETE BEFORE SHIPPING.
 *
 * Powers `/calendar?approved=a|b`: seeds the queue rail with sample posts
 * so the reviewer lands straight on the approval-aware rail, and renders a
 * state toggle so every rail state can be reached without driving the flow.
 *
 * Zero side effects: nothing here fetches, nothing here writes to the DB
 * or to localStorage. Drops onto the grid live in page state only.
 */

import { Button } from "@/components/ui/button"
import type { PanelItem } from "@/components/queue-panel"
import type { FormatId, ScheduledPost } from "@/lib/timing-storage"

export type ApprovalVariant = "a" | "b"

export type ReviewState =
  | "mixed"
  | "none-approved"
  | "all-approved"
  | "no-media"
  | "all-scheduled"
  | "loading"
  | "error"

export const REVIEW_STATES: { id: ReviewState; label: string }[] = [
  { id: "mixed", label: "מאושרים + ממתינים" },
  { id: "none-approved", label: "אין מאושרים" },
  { id: "all-approved", label: "הכל מאושר" },
  { id: "no-media", label: "אין מדיה" },
  { id: "all-scheduled", label: "הכל מתוזמן" },
  { id: "loading", label: "טעינה" },
  { id: "error", label: "שגיאה" },
]

/** Read `?approved=a|b` once. Anything else → null (production rail). */
export function readApprovalParam(): ApprovalVariant | null {
  if (typeof window === "undefined") return null
  const v = new URLSearchParams(window.location.search).get("approved")
  return v === "a" || v === "b" ? v : null
}

const IMG = (name: string) => `/images/carousel-templates/${name}.png`

const SEED_POSTS: PanelItem[] = [
  {
    corePostId: "seed-1",
    title: null,
    hookText: "הלקוחה שלא שילמה לימדה אותי יותר מכל קורס",
    format: "talking_head",
    formats: ["talking_head", "carousel"],
    formatsWithMedia: ["talking_head", "carousel"],
    hasBody: true,
    formatMedia: { carousel: IMG("ai-light") },
  },
  {
    corePostId: "seed-2",
    title: null,
    hookText: "שלוש שאלות שאני שואלת לפני כל פגישת ייעוץ",
    format: "story",
    formats: ["story", "carousel"],
    formatsWithMedia: ["story", "carousel"],
    hasBody: true,
    formatMedia: { story: IMG("ai-amber"), carousel: IMG("soft") },
  },
  {
    corePostId: "seed-3",
    title: null,
    hookText: "למה הפסקתי להציע הנחות ללקוחות חדשים",
    format: "image_post",
    formats: ["image_post"],
    formatsWithMedia: ["image_post"],
    hasBody: true,
    formatMedia: { image_post: IMG("ai-minimal") },
  },
  {
    corePostId: "seed-4",
    title: null,
    hookText: "הטעות שעשיתי בשנה הראשונה כעצמאית",
    format: "talking_head",
    formats: ["talking_head", "story"],
    formatsWithMedia: ["talking_head", "story"],
    hasBody: true,
    formatMedia: { story: IMG("vibrant") },
  },
]

/** Formats approved in the "mixed" state. The rest of the media'd formats wait. */
const MIXED_APPROVED = [
  "seed-1:talking_head",
  "seed-1:carousel",
  "seed-2:story",
  "seed-3:image_post",
]

const ALL_CARD_IDS = SEED_POSTS.flatMap((p) =>
  p.formatsWithMedia.map((f) => `${p.corePostId}:${f}`),
)

export function seedHookFor(corePostId: string): string {
  return SEED_POSTS.find((p) => p.corePostId === corePostId)?.hookText ?? ""
}

export function seedMediaFor(corePostId: string): Record<string, string> {
  return SEED_POSTS.find((p) => p.corePostId === corePostId)?.formatMedia ?? {}
}

/** Everything a review state needs to render: posts, approvals, grid rows. */
export function buildReviewSeed(
  state: ReviewState,
  weekDays: string[],
): {
  posts: PanelItem[]
  loading: boolean
  error: string | null
  approved: Set<string>
  scheduled: ScheduledPost[]
} {
  const base = {
    posts: SEED_POSTS,
    loading: false,
    error: null as string | null,
    approved: new Set<string>(MIXED_APPROVED),
    scheduled: [] as ScheduledPost[],
  }
  switch (state) {
    case "mixed":
      return base
    case "none-approved":
      return { ...base, approved: new Set() }
    case "all-approved":
      return { ...base, approved: new Set(ALL_CARD_IDS) }
    case "no-media":
      return {
        ...base,
        posts: SEED_POSTS.map((p) => ({ ...p, formatsWithMedia: [], formatMedia: {} })),
        approved: new Set(),
      }
    case "all-scheduled":
      return {
        ...base,
        approved: new Set(ALL_CARD_IDS),
        scheduled: ALL_CARD_IDS.map((id, i) => {
          const [corePostId, format] = id.split(":")
          return {
            corePostId,
            format: format as FormatId,
            scheduledDate: weekDays[(i + 1) % weekDays.length],
            scheduledTime: "09:00",
            publishedAt: null,
            hook: seedHookFor(corePostId),
          }
        }),
      }
    case "loading":
      return { ...base, posts: [], loading: true }
    case "error":
      return { ...base, posts: [], error: "שגיאה בטעינת הפוסטים" }
  }
}

/**
 * Review-only bar above the calendar: which variant is mounted + a state
 * toggle. Dashed border marks it as not-part-of-the-product.
 */
export function ApprovalReviewBar({
  variant,
  state,
  onStateChange,
}: {
  variant: ApprovalVariant
  state: ReviewState
  onStateChange: (s: ReviewState) => void
}) {
  return (
    <div
      dir="rtl"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-80 bg-gray-98 dark:bg-gray-10 px-3 py-2"
    >
      <span className="text-xs-body text-text-neutral-default">
        סביבת בדיקה · בלי כתיבה לנתונים ·
      </span>
      <div className="flex items-center gap-1">
        {(["a", "b"] as const).map((v) => (
          <Button
            key={v}
            asChild
            size="sm"
            variant={v === variant ? "default" : "ghost"}
          >
            {/* Plain <a>: the param is read once on mount, so switching
                variants needs a real reload, not a client-side nav. */}
            <a href={`/calendar?approved=${v}`}>
              {v === "a" ? "הצעה א׳ · שורת ממתינים" : "הצעה ב׳ · לשוניות"}
            </a>
          </Button>
        ))}
      </div>
      <span className="mx-1 h-4 w-px bg-gray-80" aria-hidden />
      <div className="flex flex-wrap items-center gap-1">
        {REVIEW_STATES.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={s.id === state ? "outline" : "ghost"}
            onClick={() => onStateChange(s.id)}
            aria-pressed={s.id === state}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
