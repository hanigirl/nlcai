import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * Server-side fetch of a URL that came from a user (request body or a stored
 * row): public http(s) hosts only, every redirect hop re-checked
 * (security audit 2026-11-09). Without this, the function could be pointed at
 * loopback / link-local / private addresses inside the hosting network.
 *
 * Use guardedFetch() instead of fetch() for any URL a user can influence.
 * Fixed provider URLs (fonts.googleapis.com, api.openai.com, Drive via
 * drive-fetch) don't need it.
 */

export class PrivateUrlError extends Error {
  constructor(message = "url_not_public") {
    super(message)
    this.name = "PrivateUrlError"
  }
}

const MAX_REDIRECTS = 5

/** 16 bytes of an IPv6 literal, or null if it doesn't parse. */
function ipv6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "")
  const dotted = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (dotted) {
    const p = dotted.slice(2).map(Number)
    if (p.some((n) => n > 255)) return null
    s = dotted[1] + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16)
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0) return null
  const groups = [...head, ...Array(fill).fill("0"), ...tail]
  if (groups.length !== 8) return null
  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const n = parseInt(g, 16)
    out.push(n >> 8, n & 255)
  }
  return out
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** True for anything that is not a public unicast address. Fails closed. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/%.*$/, ""))
  if (kind === 4) return isPrivateV4(ip)
  if (kind !== 6) return true
  const b = ipv6Bytes(ip)
  if (!b) return true
  const zeros = (n: number) => b.slice(0, n).every((x) => x === 0)
  const v4 = (o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`
  if (zeros(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateV4(v4(12)) // ::ffff:0:0/96 mapped
  if (zeros(12)) return true // ::, ::1, ::/96 IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true // 64:ff9b::/96 NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateV4(v4(2)) // 2002::/16 6to4
  if ((b[0] & 0xfe) === 0xfc) return true // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true // fec0::/10 site-local
  if (b[0] === 0xff) return true // multicast
  return false
}

/** Throws PrivateUrlError unless the URL is http(s) on a public address. */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw.toString())
  } catch {
    throw new PrivateUrlError("invalid_url")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PrivateUrlError("unsupported_scheme")
  if (url.username || url.password) throw new PrivateUrlError("credentials_in_url")
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new PrivateUrlError()
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!addresses.length) throw new PrivateUrlError("unresolvable_host")
  if (addresses.some(isPrivateAddress)) throw new PrivateUrlError()
  return url
}

/**
 * fetch() for user-influenced URLs: same signature, but redirects are followed
 * manually so every hop is checked. Throws PrivateUrlError for a non-public
 * destination.
 */
export async function guardedFetch(raw: string | URL, init: RequestInit = {}): Promise<Response> {
  let current = raw.toString()
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current)
    const res = await fetch(url, { ...init, redirect: "manual" })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!location) return res
    await res.body?.cancel().catch(() => undefined)
    current = new URL(location, url).toString()
  }
  throw new PrivateUrlError("too_many_redirects")
}
