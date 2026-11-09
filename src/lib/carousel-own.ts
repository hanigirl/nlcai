import { isDriveUrl } from "@/lib/drive-media"

/**
 * Whether a carousel is HER media (Hani, 2026-11-09: own media + the script's
 * text) — usable on the server and in the browser.
 *
 * Until now a carousel counted as hers only when it had one Drive link per
 * slide. A set she uploaded from her computer, or attached in the AI chat,
 * has no links, so it was taken for an AI carousel and "עריכה עם AI" sent her
 * photos to gpt-image to be repainted. The slide URLs say where each file came
 * from, so they decide too:
 *
 *   user-media/<uid>/slots/…              her picture (computer / slot / chat)
 *   user-media/<uid>/image/…              her picture (Drive store), or our
 *                                         caption render over it (captioned-)
 *   user-media/<uid>/video/…              her clip
 *   user-media/<uid>/carousel/video-…     her clip as a carousel video slide
 *   a Drive link                          hers
 *
 *   user-media/<uid>/carousel/<uuid>.png  a set saved as bytes — AI or an
 *                                         older Drive import (links decide)
 *   …/ai-slide-…                          a slide the AI added to her set
 */
export function isOwnCarouselSlideUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (isDriveUrl(url)) return true
  if (/\/ai-(slide|anim)-[0-9a-f-]+\./i.test(url)) return false
  return /\/user-media\/[^/]+\/(slots|image|video)\//.test(url) || /\/user-media\/[^/]+\/carousel\/video-/.test(url)
}

const AI_ADDED = /\/ai-(slide|anim)-[0-9a-f-]+\./i

/** One link per slide ("" for one the AI added), at least one real. */
export function carouselLinksAligned(urls: string[], links: string[] | null | undefined): boolean {
  return !!links && links.length === urls.length && links.some(Boolean)
}

/**
 * The set is hers: Drive links that line up, or every slide is one of her
 * files (an AI slide she asked to add to her set doesn't change that).
 */
export function isOwnCarousel(urls: string[], links: string[] | null | undefined): boolean {
  if (urls.length === 0) return false
  if (carouselLinksAligned(urls, links)) return true
  return urls.some(isOwnCarouselSlideUrl) && urls.every((u) => isOwnCarouselSlideUrl(u) || AI_ADDED.test(u))
}
