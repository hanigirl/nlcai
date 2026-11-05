/**
 * Video slides in a carousel (Hani, 2026-11-06) — Instagram allows a carousel
 * to mix pictures and clips. Shared, client-safe facts:
 *
 *   - A slide is a video when its URL is an mp4 (our stored video slides
 *     always are — api/carousel/video-slide writes them).
 *   - The limits we hold a video slide to, Instagram's for carousel videos as
 *     we understand them: up to 60 seconds, in the carousel's 4:5 frame
 *     (1080×1350 — padded over a blurred fill of itself, never cropped into
 *     her subject), and a file small enough for the provider to fetch.
 */

export const CAROUSEL_VIDEO_MAX_SECONDS = 60
/** The finished slide's ceiling — Instagram's carousel-video cap as we understand it. */
export const CAROUSEL_VIDEO_MAX_MB = 100
/** What we'll download to make one (her source clip). */
export const CAROUSEL_VIDEO_SOURCE_MAX_MB = 300

export const CAROUSEL_VIDEO_WIDTH = 1080
export const CAROUSEL_VIDEO_HEIGHT = 1350

const VIDEO_URL = /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i

/** A slide (URL or base64) that is a video. */
export function isVideoSlide(slide: string | null | undefined): boolean {
  return !!slide && /^https?:\/\//i.test(slide) && VIDEO_URL.test(slide)
}

/** What she reads when a clip is longer than a carousel video slide can be. */
export function carouselVideoTooLongMessage(seconds: number): string {
  return `הסרטון באורך ${Math.round(seconds)} שניות, ובקרוסלה באינסטגרם שקופית וידאו יכולה להיות עד ${CAROUSEL_VIDEO_MAX_SECONDS} שניות. קצרו אותו ונסו שוב.`
}
