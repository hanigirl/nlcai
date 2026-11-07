/**
 * What's new at the launch (Notion "כל החידושים", the 15 rows checked
 * "נכנס ל-walkthrough"; brief by Hani 2026-11-07).
 *
 * One entry per new feature. Each one drives two things:
 *   - a step in the launch walkthrough (a popover anchored to the feature,
 *     with "הבנתי"), shown once per user on the first visit after launch;
 *   - the "פיצ׳ר חדש" note rendered beside the feature, for NOTE_DAYS from
 *     that first visit. The note's "להדגמה" opens `video` in a popover.
 *
 * The demo videos are a separate task (HyperFrames). Until one is ready its
 * `video` stays null and the note shows without "להדגמה". To add a video:
 * drop the file in /public/launch/ and set `video: "/launch/<file>.mp4"`.
 *
 * Gated features (the email lists in lib/scheduling-access + lib/feature-access)
 * need nothing here: the note is rendered inside the feature's own JSX, so a
 * user who can't see the feature can't see its note or its walkthrough step.
 */

/** Launch day (Israel time). Nothing shows before it. */
export const LAUNCH_AT = "2026-11-08T00:00:00+02:00"

/** How long the "פיצ׳ר חדש" notes stay, from the user's first visit after launch. */
export const NOTE_DAYS = 14

export type LaunchFeatureId =
  | "media-brief"
  | "broll-animated"
  | "real-publishing"
  | "format-style"
  | "copy-structure"
  | "settings-split"
  | "placed-image"
  | "carousel-video"
  | "ai-edit-panel"
  | "format-lanes"
  | "format-gap"
  | "story-frames"
  | "own-video-edit"
  | "visual-language"
  | "posting-routine"

export interface LaunchFeature {
  id: LaunchFeatureId
  /** Short name, shown as the popover title. */
  title: string
  /** One line: what changed, in plain words. */
  body: string
  /** Demo video (mp4/webm under /public, or a full URL). null = not ready yet. */
  video: string | null
  /** Poster frame for the video, optional. */
  poster?: string | null
}

/** Order = walkthrough order when several features share a screen. */
export const LAUNCH_FEATURES: LaunchFeature[] = [
  {
    id: "format-lanes",
    title: "קנבס לרוחב",
    body: "כל פורמט במסלול משלו. המדיה, העריכה והתזמון — הכל בפאנל אחד בצד.",
    video: null,
  },
  {
    id: "media-brief",
    title: "ה-AI שואל לפני שהוא יוצר",
    body: "לפני יצירת מדיה ה-AI שואל כמה שאלות. אפשר לצרף קישורים ותמונות כרפרנס.",
    video: null,
  },
  {
    id: "format-style",
    title: "סגנון לכל פורמט",
    body: "בוחרים לכל פורמט: נישה כהה או בהירה, השפה הוויזואלית שלכם, או משהו חדש לגמרי.",
    video: null,
  },
  {
    id: "ai-edit-panel",
    title: "עריכה עם AI על כל מדיה",
    body: "מבקשים שינוי בפאנל הצד, וכל עריכה מלמדת את המערכת את הסגנון שלכם.",
    video: null,
  },
  {
    id: "broll-animated",
    title: "בי-רול מונפש",
    body: "ההוק מונפש בפונטים ובצבעים של המותג שלכם.",
    video: null,
  },
  {
    id: "own-video-edit",
    title: "עריכת AI לוידאו שלכם",
    body: "הכיתוב על הוידאו שהעליתם מונפש, והצילום עצמו נשאר כמו שהוא.",
    video: null,
  },
  {
    id: "placed-image",
    title: "התמונה שלכם בתוך המדיה",
    body: "תמונה שצירפתם נכנסת למדיה עצמה, משתלבת ברקע של הבי-רול, ואפשר לערוך אותה באמת.",
    video: null,
  },
  {
    id: "carousel-video",
    title: "שקופיות וידאו בקרוסלה",
    body: "קרוסלה יכולה לכלול שקופיות וידאו, ולכל קובץ מצורף בוחרים לאיזו שקופית הוא נכנס.",
    video: null,
  },
  {
    id: "copy-structure",
    title: "״תעשו לי כזה״",
    body: "שולחים קישור או צילומי מסך של קרוסלה שאהבתם, ומקבלים קרוסלה באותו מבנה.",
    video: null,
  },
  {
    id: "story-frames",
    title: "סטורי בכמה פריימים",
    body: "חלוקה לסטוריז ישר על הכרטיס. לחיצה ימנית מוסיפה פריים או מאחדת שניים.",
    video: null,
  },
  {
    id: "real-publishing",
    title: "פרסום אמיתי לרשתות",
    body: "מחברים אינסטגרם, יוטיוב ולינקדאין, והפוסט עולה בזמן שתזמנתם — גם סטורי בכמה פריימים.",
    video: null,
  },
  {
    id: "posting-routine",
    title: "לוח פרסום קבוע",
    body: "מגדירים פעם אחת באילו ימים ושעות מפרסמים, ו״סידור אוטומטי״ מסדר את כל הפוסטים.",
    video: null,
  },
  {
    id: "format-gap",
    title: "רווח בין פורמטים",
    body: "פורמטים של אותו פוסט לא יוצאים צמודים: ברירת המחדל היא 10 ימים ביניהם.",
    video: null,
  },
  {
    id: "settings-split",
    title: "ההגדרות בסדר חדש",
    body: "חיבורים מחולקים לכתיבה, מדיה ורשתות. מדיה מחולקת לשפה ויזואלית ודוגמאות.",
    video: null,
  },
  {
    id: "visual-language",
    title: "שפה ויזואלית",
    body: "השפה הוויזואלית שלכם מניעה כל תמונת AI, כולל תבנית קרוסלה משלכם.",
    video: null,
  },
]

const BY_ID = new Map(LAUNCH_FEATURES.map((f) => [f.id, f]))

export function getLaunchFeature(id: LaunchFeatureId): LaunchFeature {
  const f = BY_ID.get(id)
  if (!f) throw new Error(`unknown launch feature ${id}`)
  return f
}

export function launchOrder(id: string): number {
  const i = LAUNCH_FEATURES.findIndex((f) => f.id === id)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}

/** Per-user launch state, kept in Supabase auth user_metadata (no migration). */
export interface LaunchIntroState {
  /** ISO time of the first visit on/after LAUNCH_AT. */
  firstVisitAt: string | null
  /** Walkthrough steps the user already acknowledged ("הבנתי" / skip). */
  seen: LaunchFeatureId[]
  /** The user skipped the rest of the walkthrough. */
  skipped: boolean
}

export const EMPTY_LAUNCH_STATE: LaunchIntroState = { firstVisitAt: null, seen: [], skipped: false }

export function readLaunchState(meta: Record<string, unknown> | null | undefined): LaunchIntroState {
  const raw = meta?.launch_intro as Partial<LaunchIntroState> | undefined
  if (!raw || typeof raw !== "object") return EMPTY_LAUNCH_STATE
  return {
    firstVisitAt: typeof raw.firstVisitAt === "string" ? raw.firstVisitAt : null,
    seen: Array.isArray(raw.seen) ? (raw.seen.filter((s) => BY_ID.has(s as LaunchFeatureId)) as LaunchFeatureId[]) : [],
    skipped: raw.skipped === true,
  }
}

export function isLaunched(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(LAUNCH_AT).getTime()
}

/** Notes (and the walkthrough) live for NOTE_DAYS from the first visit. */
export function isInNoteWindow(firstVisitAt: string | null, now: Date = new Date()): boolean {
  if (!firstVisitAt) return true
  const start = new Date(firstVisitAt).getTime()
  return now.getTime() < start + NOTE_DAYS * 24 * 60 * 60 * 1000
}
