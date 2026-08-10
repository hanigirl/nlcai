/**
 * What Instagram will accept, declared once, next to the thing that has to
 * honour it.
 *
 * The dimensions our renderers emit today already satisfy Instagram — feed
 * media comes out 1080×1350 or 1080×1080, vertical media 1080×1920. But that
 * is currently a coincidence held together by five separate constants in five
 * separate files. The next template someone adds at a comfortable-looking
 * 9:16 would sail through generation, sit on the calendar looking finished,
 * and then fail at publish time — days later, in the background, to a user
 * who is not watching.
 *
 * So the rule lives here and the generators assert against it. A bad size
 * fails while a human is still looking at the screen.
 *
 * ---- The rule ----
 * Instagram treats feed and vertical media as different products:
 *
 *  - FEED (single image, carousel): aspect must sit between 4:5 and 1.91:1.
 *    4:5 is the TALLEST allowed — this is the one that surprises people,
 *    because 9:16 feels like the natural Instagram shape and is rejected here.
 *  - REEL / STORY: vertical, 9:16. No feed constraint applies.
 *
 * Carousels are additionally capped at 10 items, and a story carries no
 * caption at all — text has to be baked into the image, since no API can add
 * text or stickers to a story.
 */

/** Feed aspect bounds, as width ÷ height. 4:5 = 0.8 (tallest), 1.91:1 (widest). */
export const FEED_ASPECT_MIN = 4 / 5
export const FEED_ASPECT_MAX = 1.91

/** A hair of tolerance so 1080×1350 isn't rejected by floating-point noise. */
const EPSILON = 0.005

export const MAX_CAROUSEL_ITEMS = 10
export const MAX_CAPTION_CHARS = 2200

/**
 * Where each nlcai format lands on Instagram.
 *
 * This is the mapping the publish path needs — a `carousel` is a feed post, a
 * `talking_head` is a reel — and it is also what decides which size rule the
 * generator has to satisfy.
 */
export type InstagramDestination = "post" | "reel" | "story"

export const FORMAT_DESTINATION: Record<string, InstagramDestination> = {
  carousel: "post",
  image_post: "post",
  story: "story",
  // Both are vertical video: a talking head is the creator to camera, b-roll is
  // supplied footage with the hook burned over it. Instagram sees one thing.
  talking_head: "reel",
  b_roll: "reel",
}

/** Unknown formats default to a feed post — the strictest rule, so a new format fails loudly rather than silently shipping something Instagram rejects. */
export function destinationForFormat(format: string): InstagramDestination {
  return FORMAT_DESTINATION[format] ?? "post"
}

export function isFeedSafeAspect(width: number, height: number): boolean {
  if (!width || !height) return false
  const aspect = width / height
  return aspect >= FEED_ASPECT_MIN - EPSILON && aspect <= FEED_ASPECT_MAX + EPSILON
}

/**
 * Throws if the given canvas would be rejected as feed media.
 *
 * Called by the generators rather than the publisher on purpose: the cost of
 * catching this at publish time is a post that quietly never appears, and the
 * cost of catching it here is an error message while someone is watching.
 */
export function assertFeedSafeAspect(
  width: number,
  height: number,
  label: string
): void {
  if (isFeedSafeAspect(width, height)) return

  const aspect = (width / height).toFixed(3)
  throw new Error(
    `${label}: ${width}×${height} (יחס ${aspect}) לא יתקבל כפוסט פיד באינסטגרם. ` +
      `היחס חייב להיות בין 4:5 (0.8, הכי גבוה שמותר) ל-1.91:1. ` +
      `מידות תקינות: 1080×1350 או 1080×1080.`
  )
}
