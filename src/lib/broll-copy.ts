/**
 * The b-roll's call-to-action, in its two forms.
 *
 * Lives in its own module with no dependencies on purpose: the script version
 * is needed by a client component, and the caption renderer that owns the
 * on-video version pulls in satori and resvg — server-only packages that must
 * never reach the browser bundle.
 */

/** Burned onto the clip, arriving ~2s in. */
export const BROLL_VIDEO_CTA = "קראו בתיאור"

/**
 * Written into the b-roll's script — the text posted alongside the clip.
 * Deliberately not the same wording as the on-video line: on screen it tells
 * the viewer to read, in the caption it points at what's below.
 */
export const BROLL_SCRIPT_CTA = "תראו בתיאור"
