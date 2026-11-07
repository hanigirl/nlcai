import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * A public page's share picture (og:image / twitter:image), fetched safely:
 * public http(s) only, every redirect hop checked, sizes capped. Shared by
 * api/media/link-reference (a link as a look) and
 * api/carousel/reference-slides (a carousel to copy the structure of).
 * No AI and nothing stored.
 */

export const MAX_HTML_BYTES = 1_500_000
/** The client shrinks it to the reference size (components/ai-edit-reference). */
export const MAX_IMAGE_BYTES = 3_000_000
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3

/**
 * Instagram (and most social sites) only hand the preview tags to link
 * unfurlers; a regular page fetch gets a login wall.
 */
export const UNFURL_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

export const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/

export class LinkError extends Error {}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v === "::1" || v === "::") return true
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  const [a, b] = ip.split(".").map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

/** Public http(s) only — checked on every hop of a redirect. */
async function assertPublic(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new LinkError("זה לא נראה כמו קישור.")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("אפשר רק קישורי http או https.")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new LinkError("הקישור לא ציבורי.")
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!addresses.length) throw new LinkError("לא הצלחנו להגיע לאתר.")
  if (addresses.some(isPrivateAddress)) throw new LinkError("הקישור לא ציבורי.")
  return url
}

export async function safeFetch(raw: string, ua: string, accept: string): Promise<Response> {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublic(current)
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": ua, Accept: accept, "Accept-Language": "he,en;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!next) return res
    current = new URL(next, url).toString()
  }
  throw new LinkError("הקישור מפנה יותר מדי פעמים.")
}

export async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") || 0)
  if (declared > cap) return null
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[\u200e\u200f]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")

/** <meta property|name="key" content="…"> in either attribute order. */
export function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const k = key.replace(/[:.]/g, "\\$&")
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`, "i")) ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`, "i"))
    if (m?.[1]) return decode(m[1].trim())
  }
  return null
}

/** The page's share picture and title, trying the unfurler first. */
export async function readPreview(url: string): Promise<{ image: string; title: string | null; base: string }> {
  for (const ua of [UNFURL_UA, BROWSER_UA]) {
    let res: Response
    try {
      res = await safeFetch(url, ua, "text/html,application/xhtml+xml")
    } catch (err) {
      if (err instanceof LinkError) throw err
      continue
    }
    const type = res.headers.get("content-type") ?? ""
    // A direct image link is its own preview.
    if (IMAGE_TYPES.test(type.split(";")[0].trim())) return { image: res.url || url, title: null, base: url }
    if (!res.ok || !type.includes("html")) continue
    const bytes = await readCapped(res, MAX_HTML_BYTES)
    if (!bytes) continue
    const html = new TextDecoder().decode(bytes)
    const image = meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"])
    if (image) {
      const title = meta(html, ["og:title", "twitter:title"]) ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null
      return { image: new URL(image, url).toString(), title: title ? decode(title).slice(0, 140) : null, base: url }
    }
  }
  throw new LinkError("לא מצאנו בקישור הזה תמונה לשתף. אפשר לצרף צילום מסך במקום.")
}

