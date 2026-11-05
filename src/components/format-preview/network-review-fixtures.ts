/**
 * Sample data for reviewing the network switch — REVIEW ONLY.
 *
 * Read by `/calendar?state=…` (the preview opens straight on a
 * seeded post) and by `/test/network-switch`. No fetch, no DB write, no
 * provider call is made from anything here. Delete with the review harness
 * when a variant is picked.
 */

import type { InstagramConnection } from "@/lib/instagram-connection"
import type { SocialPlatform } from "@/lib/supabase/types"
import type { ConnectedNetwork } from "./network-switch"
import type { FormatPreviewData, PreviewNetwork } from "./shared"

export type NetworkReviewState = "one" | "three" | "failed" | "optout" | "mixed" | "expired"

export const NETWORK_REVIEW_STATES: { id: NetworkReviewState; label: string }[] = [
  { id: "one", label: "רשת אחת (סטורי, אינסטגרם בלבד)" },
  { id: "three", label: "שלוש רשתות, כולן תוזמנו" },
  { id: "failed", label: "רשת אחת נכשלה" },
  { id: "optout", label: "רשת שהורדה מהפוסט" },
  { id: "mixed", label: "חלק מהרשתות לא מחוברות" },
  { id: "expired", label: "החיבור ל-YouTube פג" },
]

export function isNetworkReviewState(v: string | null): v is NetworkReviewState {
  return NETWORK_REVIEW_STATES.some((s) => s.id === v)
}

const CAPTION =
  "רוב היועצות שאני פוגשת כותבות פוסט רק כשיש להן זמן. והזמן הזה לא מגיע.\n\nמה שעובד: שעה אחת ביום ראשון, שלושה רעיונות, ולוח שמחליט בשבילכן מתי כל אחד עולה. בלי לחשוב על זה שוב באמצע השבוע.\n\nמה הרגל הכתיבה שלכן?"

const ok = (platform: PreviewNetwork["platform"], handle: string): PreviewNetwork => ({
  platform,
  included: true,
  connection: "connected",
  handle,
  publish: { kind: "scheduled" },
  ...(platform === "youtube" ? { youtubePrivacy: "public" as const } : {}),
})

function base(format: FormatPreviewData["format"]): FormatPreviewData {
  return {
    corePostId: "00000000-0000-4000-8000-000000000042",
    format,
    hook: "שעה אחת ביום ראשון שחוסכת לכן שבוע שלם של ״מה לכתוב היום?״",
    caption: format === "story" ? "" : CAPTION,
    slides: [{ url: "/images/carousel-templates/ai-light.png", type: "image" }],
    coverUrl: "/images/carousel-templates/ai-light.png",
    handle: "noa.cohen.consulting",
    scheduledDate: "2026-11-12",
    scheduledTime: "09:00",
    publish: { kind: "scheduled" },
  }
}

export function reviewPreviewData(state: NetworkReviewState): FormatPreviewData {
  switch (state) {
    case "one":
      return { ...base("story"), networks: [ok("instagram", "noa.cohen.consulting")] }
    case "three":
      return {
        ...base("b_roll"),
        networks: [
          ok("instagram", "noa.cohen.consulting"),
          ok("youtube", "Noa Cohen Consulting"),
          ok("linkedin", "נועה כהן"),
        ],
      }
    case "failed":
      return {
        ...base("b_roll"),
        publish: {
          kind: "failed",
          reason: "LinkedIn: המדיה נדחתה ב-LinkedIn. צריך לוודא שהקובץ תקין ולנסות שוב.",
          action: "retry",
        },
        networks: [
          ok("instagram", "noa.cohen.consulting"),
          { ...ok("youtube", "Noa Cohen Consulting"), youtubePrivacy: "unlisted" },
          {
            ...ok("linkedin", "נועה כהן"),
            publish: {
              kind: "failed",
              reason: "המדיה נדחתה ב-LinkedIn. צריך לוודא שהקובץ תקין ולנסות שוב.",
              action: "retry",
            },
          },
        ],
      }
    case "optout":
      return {
        ...base("b_roll"),
        networks: [
          ok("instagram", "noa.cohen.consulting"),
          { ...ok("youtube", "Noa Cohen Consulting"), included: false, publish: { kind: "unscheduled" } },
          ok("linkedin", "נועה כהן"),
        ],
      }
    case "expired":
      return {
        ...base("b_roll"),
        networks: [
          ok("instagram", "noa.cohen.consulting"),
          { ...ok("youtube", "Noa Cohen Consulting"), connection: "expired", publish: { kind: "not_connected" } },
          { platform: "linkedin", included: false, connection: "none", handle: null, publish: { kind: "not_connected" } },
        ],
      }
    case "mixed":
      return {
        ...base("b_roll"),
        networks: [
          ok("instagram", "noa.cohen.consulting"),
          ok("youtube", "Noa Cohen Consulting"),
          { platform: "linkedin", included: false, connection: "none", handle: null, publish: { kind: "not_connected" } },
        ],
      }
  }
}

/** What the marker above the calendar shows in each review state. */
export function reviewConnections(state: NetworkReviewState): ConnectedNetwork[] {
  const c = (platform: ConnectedNetwork["platform"], s: ConnectedNetwork["state"], handle?: string): ConnectedNetwork => ({
    platform,
    state: s,
    handle,
  })
  switch (state) {
    case "one":
      return [c("instagram", "connected", "noa.cohen.consulting"), c("youtube", "none"), c("linkedin", "none")]
    case "mixed":
      return [c("instagram", "connected", "noa.cohen.consulting"), c("youtube", "connected", "Noa Cohen Consulting"), c("linkedin", "none")]
    case "expired":
      return [c("instagram", "connected", "noa.cohen.consulting"), c("youtube", "expired", "Noa Cohen Consulting"), c("linkedin", "none")]
    default:
      return [
        c("instagram", "connected", "noa.cohen.consulting"),
        c("youtube", "connected", "Noa Cohen Consulting"),
        c("linkedin", "connected", "נועה כהן"),
      ]
  }
}

/**
 * The connect modal's view of one network in a review state — what the
 * marker's icon opens on a review link (buttons inert there).
 */
export function reviewConnectionFor(state: NetworkReviewState, platform: SocialPlatform): InstagramConnection {
  const n = reviewConnections(state).find((x) => x.platform === platform)
  if (!n || n.state === "none" || n.state === "loading") return { status: "disconnected", accounts: [], primary: null }
  const account = {
    id: `review-${platform}`,
    platform,
    handle: n.handle ?? null,
    avatarUrl: null,
    status: n.state === "connected" ? ("connected" as const) : ("needs_reconnect" as const),
    queuedCount: n.state === "connected" ? 2 : 0,
  }
  return { status: n.state === "connected" ? "connected" : "disconnected", accounts: [account], primary: account }
}
