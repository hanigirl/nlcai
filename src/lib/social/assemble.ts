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
import { slotToInstant } from "./slot-time"

export { slotToInstant } from "./slot-time"

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
      "media_rejected"
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
      // A story set is saved as one ordered list of rows, so a clip in it
      // (her own, or an AI frame with animated text) can sit in an "image"
      // row — the file's extension is what tells.
      type: a.asset_type === "video" || VIDEO_FILE.test(a.url as string) ? "video" : "image",
    }))

  // Reels only. A feed post's first slide is already its cover, and a story has
  // no cover concept — passing one to either would be meaningless.
  const coverUrl =
    kind === "reel"
      ? usable.find((a) => a.asset_type === "cover")?.url ?? undefined
      : undefined

  // The provider fetches each file itself, from the URL, at publish time. A
  // Drive "view" link answers with an HTML page, not the file, and Instagram
  // has no SVG support at all — both would sit in the queue looking fine and
  // fail at the slot minute, while nobody is watching.
  const unfetchable = media.find((m) => !isDirectMediaUrl(m.url))
  if (unfetchable) {
    throw new SocialPublishError(
      "אחד מקובצי המדיה הוא קישור (למשל מגוגל דרייב) או קובץ שאינסטגרם לא מקבלת. צריך להעלות את הקובץ עצמו.",
      "media_rejected"
    )
  }

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

/**
 * The provider posts one slot becomes, in frame order.
 *
 * A story with a gap (the routine's "מרווח בין פריימים בסטורי") goes out one
 * frame per post: frame 1 at the slot time, frame 2 at +gap, frame 3 at
 * +2·gap. Handed over as ONE post, the provider publishes every frame in the
 * same minute (verified live 2026-10-29) — the gap she picked meant nothing.
 *
 * Everything else — a reel, a carousel, a single-frame story, a story with no
 * gap on its row (pre-041, or written before the client sent one) — stays
 * one post, exactly as before.
 */
export function splitStoryFrames(
  input: SchedulePostInput,
  gapMinutes: number | null | undefined
): SchedulePostInput[] {
  if (input.kind !== "story" || !gapMinutes || gapMinutes <= 0 || input.media.length < 2) {
    return [input]
  }
  const start = input.publishAt.getTime()
  return input.media.map((m, i) => ({
    ...input,
    media: [m],
    publishAt: new Date(start + i * gapMinutes * 60_000),
  }))
}

/** A URL the provider can download a real image/video file from. */
const VIDEO_FILE = /\.(mp4|mov|m4v|webm)(\?|#|$)/i

function isDirectMediaUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
  if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$|(^|\.)canva\.com$/i.test(parsed.hostname)) {
    return false
  }
  return !/\.svg$/i.test(parsed.pathname)
}
