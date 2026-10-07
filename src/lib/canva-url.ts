/**
 * Canva link shapes — client-safe (no secrets), shared by the media panel and
 * the server routes. The server-side half lives in `lib/canva.ts`.
 */

const CANVA_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(canva\.com|canva\.link)\//i

/** True for any canva.com / canva.link URL. */
export function isCanvaUrl(url: string | null | undefined): boolean {
  return !!url && CANVA_HOST_RE.test(url.trim())
}

/** `https://www.canva.com/design/DAHFGfAdmDg/<token>/edit` → `DAHFGfAdmDg`. */
export function extractCanvaDesignId(url: string): string | null {
  const m = url.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/i)
  return m?.[1] ?? null
}

/**
 * True once the field holds a Canva link worth acting on — a full design URL
 * or a `canva.link/<code>` short link — so the debounced auto-import doesn't
 * fire on a half-pasted URL.
 */
export function isCompleteCanvaUrl(url: string | null | undefined): boolean {
  if (!isCanvaUrl(url)) return false
  const u = url!.trim()
  return extractCanvaDesignId(u) !== null || /canva\.link\/[A-Za-z0-9_-]+/i.test(u)
}
