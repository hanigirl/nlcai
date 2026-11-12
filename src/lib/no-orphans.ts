/**
 * Never a single word alone on a line (Hani, 2026-11-12: "לא לשבור שורה עם
 * מילה אחת"). Every page we render to media — carousel slides, b-roll, story,
 * image post, the agents' snapshots — gets this before it is drawn:
 *
 *   every text → balanced: when it breaks, the lines share the words
 *                evenly, so the last line is never one word (media text is
 *                short; the browser balances up to 6 lines)
 *
 * The longhand `text-wrap-style` on purpose: the `text-wrap` shorthand would
 * also reset `text-wrap-mode` and undo a composition's `white-space: nowrap`.
 * Zero specificity (`:where`), so a composition's own choice still wins.
 */
export const NO_ORPHANS_STYLE =
  "<style data-no-orphans>:where(body *){text-wrap-style:balance}</style>"

export function withNoOrphans(html: string): string {
  if (html.includes("data-no-orphans")) return html
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${NO_ORPHANS_STYLE}</head>`) : `${NO_ORPHANS_STYLE}${html}`
}
