/**
 * Phebe's live demo of the app (Hani, 2026-10-29).
 *
 * Phebe (Hani's agent dashboard) opens the app in a frame — or a window of its
 * own — and walks through what shipped: she moves a visible cursor, points,
 * clicks and types, like a designer showing her own design. The app can't be
 * scripted from Phebe's page (different origin), so the app listens for
 * Phebe's messages itself: components/phebe-demo-driver.tsx.
 *
 * Everything here is narrow on purpose:
 *  - only messages from Phebe's origins are answered,
 *  - only Hani's account is driven,
 *  - while a demo runs the frame is read only: no POST/PATCH/PUT/DELETE leaves
 *    it (no generation, no AI edit, no approve, no scheduling, no saves) —
 *    except the sign-in refresh that keeps her session alive,
 *  - on real pages the driver clicks only elements marked as safe to click.
 */

export const DEMO_EMAILS = ["hanigirl@gmail.com"]

/** Phebe in production, and Phebe running on Hani's Mac. */
export function isPhebeOrigin(origin: string): boolean {
  if (origin === "https://phebe-dashboard.vercel.app") return true
  return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin)
}

/** Same list, as a CSP frame-ancestors value (next.config.ts). */
export const PHEBE_FRAME_ANCESTORS =
  "'self' https://phebe-dashboard.vercel.app http://localhost:* http://127.0.0.1:*"

/** URL flag Phebe puts on every page it opens in the demo frame. */
export const DEMO_PARAM = "phebe_demo"
export const DEMO_SESSION_KEY = "nlcai:phebe-demo"

/**
 * Set by /api/demo/embed for Hani only. While it is there, the sign-in
 * cookies are written SameSite=None, so the app stays signed in inside
 * Phebe's frame (a cross-site frame never gets SameSite=Lax cookies).
 * Expires on its own; /api/demo/embed?off=1 ends it at once.
 */
export const EMBED_MARKER = "nlcai_phebe_embed"
export const EMBED_MARKER_MAX_AGE = 8 * 60 * 60

/** Cookie options for the Supabase clients: SameSite=None only while the marker is set. */
export function embedCookieOptions(markerPresent: boolean): { sameSite: "none"; secure: true } | undefined {
  return markerPresent ? { sameSite: "none", secure: true } : undefined
}

/**
 * Elements on real pages the driver may click (by their data-demo name).
 * Each one only opens or closes something on screen; none of them saves.
 */
export const SAFE_REAL_CLICKS = new Set([
  "copy-ai-button", // opens the AI edit panel for a format's copy
  "calendar-arrange", // lays posts on the board as drafts (nothing is scheduled)
  "calendar-arrange-cancel", // takes the drafts off again
  "planned-card", // opens a draft's preview
])

/** Never clicked on a real page, whatever the target says. */
export const FORBIDDEN_LABELS = [
  "תזמון כל הפוסטים",
  "תזמון",
  "אישור",
  "שמירה",
  "שמירת השינוי",
  "שליחה",
  "מחיקה",
  "הסרה מהלוח",
  "ביטול תזמון",
  "יצירה",
  "צור",
  "לשמור לשפה הוויזואלית שלי",
]
