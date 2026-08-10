/**
 * Turning a calendar slot into something Instagram will accept.
 *
 * A slot in `scheduled_posts` is three facts: which post, which format, which
 * day and hour. Everything else the publish needs — the caption, the slides,
 * the cover — already exists elsewhere in the database. This file is the join,
 * and it is where the product decisions about that join are written down:
 *
 *   caption  = the format's own body, in full (Hani, 2026-08-10). Not the hook,
 *              not a summary — whatever is in the description of the thing
 *              being scheduled.
 *   media    = every image on the variant in slide order, or the video.
 *   cover    = the generated reel cover, attached as the reel's thumbnail.
 *
 * Assembly deliberately fails loudly rather than publishing something
 * degraded. A caption silently truncated at 2,200 characters, or a carousel
 * quietly missing its tenth slide, is worse than a slot that refuses to queue
 * and says why — because the first two are discovered in the feed, days later,
 * by the person whose name is on the post.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/types"
import {
  MAX_CAPTION_CHARS,
  MAX_CAROUSEL_ITEMS,
  destinationForFormat,
} from "./media-spec"
import { SocialPublishError, type SchedulePostInput, type SocialMedia } from "./types"

/** Israel. The calendar stores a bare local hour; publishing needs a real instant. */
const CALENDAR_TIMEZONE = "Asia/Jerusalem"

type AssembleArgs = {
  db: SupabaseClient<Database>
  userId: string
  corePostId: string
  format: string
  socialAccountId: string
  /** "YYYY-MM-DD" from the calendar. */
  scheduledDate: string
  /** "HH:00" from the calendar. */
  scheduledTime: string
}

/**
 * Resolve the calendar's local wall-clock slot to an absolute instant.
 *
 * The board stores "the 5th at 09:00" with no zone, on purpose — it has to
 * mean the same thing to everyone looking at it (migration 026). Publishing
 * cannot carry that ambiguity, so the wall-clock time is interpreted as Israel
 * time here, in one place, rather than each caller guessing.
 *
 * Done by asking Intl what the zone's offset actually was on that date, so DST
 * is handled by the timezone database instead of a hardcoded +2/+3.
 */
export function slotToInstant(scheduledDate: string, scheduledTime: string): Date {
  const [y, m, d] = scheduledDate.split("-").map(Number)
  const [hh, mm] = scheduledTime.split(":").map(Number)

  if (!y || !m || !d || Number.isNaN(hh)) {
    throw new SocialPublishError(
      `slot has an unreadable date/time: ${scheduledDate} ${scheduledTime}`,
      "provider_error",
      false
    )
  }

  // Start from the instant that has these numbers in UTC, then correct by
  // whatever offset Israel was on at that moment.
  const asUtc = Date.UTC(y, m - 1, d, hh, mm || 0)
  const offsetMs = zoneOffsetMs(new Date(asUtc))
  return new Date(asUtc - offsetMs)
}

/** How far ahead of UTC the calendar's zone was at a given instant. */
function zoneOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  )
  return local - at.getTime()
}

export async function assembleScheduledPost(
  args: AssembleArgs
): Promise<SchedulePostInput> {
  const { db, userId, corePostId, format, socialAccountId } = args
  const kind = destinationForFormat(format)

  // ---- the format's own body: the caption, in full ----
  const { data: variantRow } = await db
    .from("format_variants")
    .select("id, body")
    .eq("core_post_id", corePostId)
    .eq("format", format)
    .maybeSingle()

  const variant = variantRow as { id: string; body: string | null } | null
  if (!variant) {
    throw new SocialPublishError(
      `אין תוכן לפורמט "${format}" בפוסט הזה.`,
      "not_connected"
    )
  }

  const body = (variant.body ?? "").trim()

  // A story carries no caption at all — Instagram accepts zero characters and
  // no API can add text or stickers to one. So the body is simply not sent;
  // any text that has to be visible is already baked into the frame by the
  // story generator. This is the one place Hani's "caption = the full body"
  // rule cannot apply, and it is a platform fact rather than a choice.
  const caption = kind === "story" ? "" : body

  if (caption.length > MAX_CAPTION_CHARS) {
    throw new SocialPublishError(
      `הכיתוב ארוך מ-${MAX_CAPTION_CHARS} תווים (יש ${caption.length}). ` +
        `אינסטגרם תחתוך אותו — עדיף לקצר לפני שמתזמנים.`,
      "media_rejected"
    )
  }

  // ---- media: content assets in slide order, cover kept apart ----
  const { data: assetRows } = await db
    .from("media_assets")
    .select("asset_type, url, status")
    // Slide order IS insertion order: saving a carousel wipes the whole set and
    // rewrites it in the user's arrangement, so ascending created_at is the
    // order she sees on screen (see migrations 029/030).
    .order("created_at", { ascending: true })
    .eq("format_variant_id", variant.id)

  const assets = (assetRows ?? []) as {
    asset_type: string
    url: string | null
    status: string
  }[]

  const usable = assets.filter((a) => a.url && a.status === "completed")

  const media: SocialMedia[] = usable
    .filter((a) => a.asset_type === "image" || a.asset_type === "video")
    .map((a) => ({
      url: a.url as string,
      type: a.asset_type === "video" ? "video" : "image",
    }))

  // Reels only. A feed post's first slide is already its cover, and a story has
  // no cover concept — passing one to either would be meaningless.
  const coverUrl =
    kind === "reel"
      ? usable.find((a) => a.asset_type === "cover")?.url ?? undefined
      : undefined

  if (media.length === 0) {
    throw new SocialPublishError(
      "אין מדיה מוכנה לפרסום בפורמט הזה. ייתכן שהיצירה עוד רצה או נכשלה.",
      "media_rejected"
    )
  }

  if (media.length > MAX_CAROUSEL_ITEMS) {
    throw new SocialPublishError(
      `אינסטגרם מקבלת עד ${MAX_CAROUSEL_ITEMS} פריטים בקרוסלה, ויש כאן ${media.length}.`,
      "media_rejected"
    )
  }

  if (kind === "reel" && media.some((m) => m.type !== "video")) {
    throw new SocialPublishError("רילז דורש סרטון.", "media_rejected")
  }

  return {
    userId,
    socialAccountId,
    caption,
    media,
    coverUrl,
    kind,
    publishAt: slotToInstant(args.scheduledDate, args.scheduledTime),
  }
}
