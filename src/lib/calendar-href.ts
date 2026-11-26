/**
 * The link from a post (and one of its formats) to the calendar.
 *
 * A format card's "ללוח התזמון" must land on THAT format. Without `format`
 * the calendar opens the post's soonest slot on the board — so once the story
 * was scheduled, every card's calendar button reopened the story instead of
 * the b-roll or talking head she pressed it on (bug 2026-11-21).
 */
export function calendarHref(postId: string | null | undefined, format?: string | null): string {
  if (!postId) return "/calendar"
  const params = new URLSearchParams({ post_id: postId })
  if (format) params.set("format", format)
  return `/calendar?${params.toString()}`
}

/**
 * Where a format-specific deep link lands on the calendar: that format's
 * preview, and the week of its own slot when it has one. Never another
 * format's slot. Pure — the calendar page and /test/calendar-format-link
 * both run it.
 */
export function formatDeepLinkTarget(
  board: { corePostId: string; format: string; scheduledDate: string }[],
  postId: string,
  format: string,
): { format: string; weekOf: string | null } {
  const own = board.find((r) => r.corePostId === postId && r.format === format)
  return { format, weekOf: own?.scheduledDate ?? null }
}
