"use client"

/**
 * REVIEW HARNESS — DELETE BEFORE SHIPPING.
 *
 * Powers `/calendar?preview=a|b`: puts four sample formats on this week's
 * board (reel, carousel, story, image post) so a click on any of them opens
 * the format preview straight away, and renders a toggle for every publish
 * status and content state so none of them needs the real flow to reach.
 *
 * Zero side effects: nothing here fetches or writes. Rescheduling, caption
 * edits and removals live in the calendar page's state only. The publish
 * statuses are samples — Ben's bridge task wires the real ones.
 */

import { Button } from "@/components/ui/button"
import type {
  FormatPreviewData,
  PreviewContentState,
  PublishStatus,
} from "@/components/format-preview/shared"
import type { FormatId, ScheduledPost } from "@/lib/timing-storage"
import { seedHookFor, seedMediaFor } from "./approval-review-harness"

export type PreviewVariant = "a" | "b"

/** Read `?preview=a|b` once. Anything else → null (production board). */
export function readPreviewParam(): PreviewVariant | null {
  if (typeof window === "undefined") return null
  const v = new URLSearchParams(window.location.search).get("preview")
  return v === "a" || v === "b" ? v : null
}

const IMG = (name: string) => `/images/carousel-templates/${name}.png`

export const PREVIEW_HANDLE = "noa.cohen.consulting"

type SeedFormat = {
  corePostId: string
  format: FormatId
  caption: string
  slides: FormatPreviewData["slides"]
  coverUrl?: string
  /** Day offset from the first open day this week, and the hour. */
  dayOffset: number
  time: string
}

const REEL_SCRIPT = `הלקוחה שלא שילמה לימדה אותי יותר מכל קורס.

לפני שנתיים סיימתי פרויקט של שלושה חודשים, שלחתי חשבונית, וחיכיתי. ועוד חיכיתי.

בסוף הבנתי שהבעיה לא הייתה בה. הבעיה הייתה שלא היה לי חוזה, לא הייתה מקדמה, ולא הייתה לי שום דרך להגיד "עד כאן".

היום כל פרויקט אצלי מתחיל בשלושה דברים: הסכם כתוב, 30% מראש, ותאריכי תשלום שכתובים ביומן שלי ושל הלקוחה.

זה לא עניין של חשדנות. זה עניין של כבוד, גם לעבודה שלי וגם לה.

איך אתן מתחילות פרויקט חדש? ספרו לי בתגובות 👇`

const CAROUSEL_CAPTION = `שלוש שאלות שאני שואלת לפני כל פגישת ייעוץ, ולמה הן חוסכות לי חצי מהפגישה.

החליקו לראות את כולן ➜

שמרו את הפוסט לפגישה הבאה שלכן.

#ייעוץעסקי #עצמאיות #ניהולזמן`

const IMAGE_CAPTION = `הפסקתי להציע הנחות ללקוחות חדשים.

לא בגלל שאני לא רוצה לעזור, אלא כי הנחה בהתחלה מלמדת את הלקוחה שהמחיר שלי גמיש. ומשם הדרך לעבודה שלא משתלמת קצרה מאוד.

במקום הנחה אני נותנת בהירות: מה בדיוק מקבלים, כמה זמן זה לוקח, ומה קורה אם משהו משתנה באמצע.`

const SEED_FORMATS: SeedFormat[] = [
  {
    corePostId: "seed-1",
    format: "talking_head",
    caption: REEL_SCRIPT,
    slides: [{ url: IMG("ai-dark"), type: "image" }],
    coverUrl: IMG("ai-dark"),
    dayOffset: 1,
    time: "09:00",
  },
  {
    corePostId: "seed-2",
    format: "carousel",
    caption: CAROUSEL_CAPTION,
    slides: ["ai-light", "soft", "ai-amber", "ai-minimal", "vibrant"].map((n) => ({
      url: IMG(n),
      type: "image" as const,
    })),
    dayOffset: 2,
    time: "18:00",
  },
  {
    corePostId: "seed-4",
    format: "story",
    caption: "",
    slides: [{ url: IMG("ai-vibrant"), type: "image" }],
    dayOffset: 3,
    time: "12:00",
  },
  {
    corePostId: "seed-3",
    format: "image_post",
    caption: IMAGE_CAPTION,
    slides: [{ url: IMG("ai-ice"), type: "image" }],
    dayOffset: 0,
    time: "08:00",
  },
]

const key = (corePostId: string, format: string) => `${corePostId}:${format}`

/** Seeded rows for the board, spread over this week's open days. */
export function buildPreviewScheduled(openDays: string[]): ScheduledPost[] {
  if (openDays.length === 0) return []
  return SEED_FORMATS.map((s) => ({
    corePostId: s.corePostId,
    format: s.format,
    scheduledDate: openDays[s.dayOffset % openDays.length],
    scheduledTime: s.time,
    publishedAt: null,
    hook: seedHookFor(s.corePostId),
  }))
}

/** Thumbnail for the board card — the cover for a reel, the first slide otherwise. */
export function previewThumbFor(corePostId: string, format: string): string | undefined {
  const s = SEED_FORMATS.find((f) => key(f.corePostId, f.format) === key(corePostId, format))
  return s?.coverUrl ?? s?.slides[0]?.url
}

// --- statuses -----------------------------------------------------------------

export type StatusPick =
  | "mixed"
  | "not_connected"
  | "pending"
  | "scheduled"
  | "failed_reconnect"
  | "failed_media"
  | "failed_retry"
  | "published"

const STATUS_OPTIONS: { id: StatusPick; label: string }[] = [
  { id: "mixed", label: "לפי כרטיס" },
  { id: "not_connected", label: "לא מחובר" },
  { id: "pending", label: "בתהליך" },
  { id: "scheduled", label: "תוזמן" },
  { id: "failed_reconnect", label: "נכשל · חיבור פג" },
  { id: "failed_media", label: "נכשל · מדיה" },
  { id: "failed_retry", label: "נכשל · תקלה" },
  { id: "published", label: "פורסם" },
]

const STATUS: Record<Exclude<StatusPick, "mixed">, PublishStatus> = {
  not_connected: { kind: "not_connected" },
  pending: { kind: "pending" },
  scheduled: { kind: "scheduled" },
  failed_reconnect: {
    kind: "failed",
    action: "reconnect",
    reason: "החיבור לאינסטגרם פג, ולכן הפוסט לא נשלח. אחרי חיבור מחדש הוא יתוזמן שוב לאותו מועד.",
  },
  failed_media: {
    kind: "failed",
    action: "fix_media",
    reason: "אינסטגרם דחתה את השקופית השלישית: היא רחבה מדי לפיד. בפיד אפשר יחס בין 4:5 ל-1.91:1.",
  },
  failed_retry: {
    kind: "failed",
    action: "retry",
    reason: "לא הצלחנו להגיע לאינסטגרם כרגע. הפוסט לא תוזמן, ואפשר לנסות שוב.",
  },
  published: { kind: "published", permalink: "https://www.instagram.com/" },
}

/** "לפי כרטיס" — a different status per card, so a click-through shows the range. */
const MIXED: Record<string, PublishStatus> = {
  [key("seed-1", "talking_head")]: STATUS.scheduled,
  [key("seed-2", "carousel")]: STATUS.failed_media,
  [key("seed-4", "story")]: STATUS.pending,
  [key("seed-3", "image_post")]: STATUS.published,
}

const LONG_TAIL =
  "\n\n" +
  "ועוד משהו שחשוב לי להגיד: ".repeat(1) +
  "כל לקוחה שמגיעה אליי מביאה איתה סיפור, ולכל סיפור יש קצב משלו. ".repeat(40)

/** Everything the preview needs for one card, under the current toggles. */
export function buildPreviewData(
  post: ScheduledPost,
  hook: string,
  statusPick: StatusPick,
  content: PreviewContentState | "too-long",
  captionOverrides: Map<string, string>,
  isPast = false,
): FormatPreviewData {
  const k = key(post.corePostId, post.format)
  // Rail items aren't in SEED_FORMATS — borrow a same-format sample caption
  // and use the rail's own thumbnail as the media.
  const seed =
    SEED_FORMATS.find((f) => key(f.corePostId, f.format) === k) ??
    (() => {
      const sameFormat = SEED_FORMATS.find((f) => f.format === post.format)
      const thumb = seedMediaFor(post.corePostId)[post.format]
      return sameFormat
        ? { ...sameFormat, slides: thumb ? [{ url: thumb, type: "image" as const }] : sameFormat.slides, coverUrl: undefined }
        : undefined
    })()
  const baseCaption = captionOverrides.get(k) ?? seed?.caption ?? ""
  return {
    corePostId: post.corePostId,
    format: post.format,
    hook,
    caption: content === "too-long" && post.format !== "story" ? baseCaption + LONG_TAIL : baseCaption,
    slides: seed?.slides ?? [],
    coverUrl: seed?.coverUrl,
    handle: PREVIEW_HANDLE,
    scheduledDate: post.scheduledDate,
    scheduledTime: post.scheduledDate ? (post.scheduledTime ?? "09:00") : "",
    isPast,
    publish: !post.scheduledDate
      ? { kind: "unscheduled" }
      : isPast && statusPick === "mixed"
        ? { kind: "sent" }
        : statusPick === "mixed"
        ? (MIXED[k] ?? STATUS.scheduled)
        : STATUS[statusPick],
  }
}

// --- review bar ---------------------------------------------------------------

export type ContentPick = PreviewContentState | "too-long"

const CONTENT_OPTIONS: { id: ContentPick; label: string }[] = [
  { id: "ready", label: "מוכן" },
  { id: "loading", label: "טעינה" },
  { id: "no-media", label: "אין מדיה" },
  { id: "too-long", label: "כיתוב ארוך מדי" },
]

/**
 * Review-only bar above the calendar. Dashed border marks it as not part of
 * the product.
 */
export function PreviewReviewBar({
  variant,
  status,
  onStatus,
  content,
  onContent,
}: {
  variant: PreviewVariant
  status: StatusPick
  onStatus: (s: StatusPick) => void
  content: ContentPick
  onContent: (c: ContentPick) => void
}) {
  return (
    <div
      dir="rtl"
      className="mb-4 flex flex-col gap-2 rounded-xl border border-dashed border-gray-80 bg-gray-98 px-3 py-2 dark:bg-gray-10"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs-body text-text-neutral-default">
          סביבת בדיקה · פוסטים לדוגמה · בלי כתיבה לנתונים · לחצו על כרטיס בלוח
        </span>
        <div className="flex items-center gap-1">
          {(["a", "b"] as const).map((v) => (
            <Button key={v} asChild size="sm" variant={v === variant ? "default" : "ghost"}>
              {/* Plain <a>: the param is read once on mount. */}
              <a href={`/calendar?preview=${v}`}>
                {v === "a" ? "הצעה א׳ · חלון עם תצוגת טלפון" : "הצעה ב׳ · פאנל במקום הרשימה"}
              </a>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="me-1 text-xs-body text-text-neutral-default">סטטוס פרסום:</span>
        {STATUS_OPTIONS.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={s.id === status ? "outline" : "ghost"}
            onClick={() => onStatus(s.id)}
            aria-pressed={s.id === status}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="me-1 text-xs-body text-text-neutral-default">תוכן:</span>
        {CONTENT_OPTIONS.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant={c.id === content ? "outline" : "ghost"}
            onClick={() => onContent(c.id)}
            aria-pressed={c.id === content}
          >
            {c.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
