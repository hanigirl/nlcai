import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { BROWSER_UA, IMAGE_TYPES, LinkError, MAX_IMAGE_BYTES, readCapped, readPreview, safeFetch } from "@/lib/link-preview"

/**
 * POST { url } → { slides: dataUrl[], source } | { error: "unreadable", message }
 *
 * "תעשה לי כזה" with a link (Hani, 2026-11-07): every slide of the carousel
 * behind the link, to copy its structure. No AI, nothing stored.
 *
 * What can be read, honestly:
 *   - Instagram, through the official Graph API's Business Discovery — only
 *     when META_IG_USER_ID + META_IG_ACCESS_TOKEN are set (a Meta app with an
 *     Instagram business account of our own), and only for public Business /
 *     Creator accounts, for a post among their recent ones. Not set today:
 *     our Instagram publishing runs through HighLevel, which exposes no read
 *     of other accounts.
 *   - Any page: its share picture — ONE slide. One slide isn't a carousel to
 *     copy, so that's "unreadable" too.
 * Unreadable → the panel asks for screenshots of the slides instead.
 */

const UNREADABLE =
  "אי אפשר לקרוא לינק מחשבון אישי או לא ציבורי. שימו לי כאן צילומי מסך של השקופיות ואפעל לפיהם."
const MAX_SLIDES = 10
const GRAPH = "https://graph.facebook.com/v21.0"

/** The account name in an Instagram post link, or in its share title. */
function instagramUsername(url: URL, title: string | null): string | null {
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length >= 3 && (parts[1] === "p" || parts[1] === "reel")) return parts[0]
  const m = title?.match(/@([A-Za-z0-9._]{1,30})/) ?? title?.match(/^([A-Za-z0-9._]{1,30}) on Instagram/i)
  return m?.[1] ?? null
}
const shortcodeOf = (url: URL) => url.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] ?? null

async function imageDataUrl(src: string): Promise<string | null> {
  try {
    const res = await safeFetch(src, BROWSER_UA, "image/*")
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim()
    if (!res.ok || !IMAGE_TYPES.test(type)) return null
    const bytes = await readCapped(res, MAX_IMAGE_BYTES)
    return bytes ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null
  } catch {
    return null
  }
}

/** Business Discovery: the carousel's children, when the post is found. */
async function instagramSlides(username: string, code: string): Promise<string[] | null> {
  const igUser = process.env.META_IG_USER_ID
  const token = process.env.META_IG_ACCESS_TOKEN
  if (!igUser || !token) return null
  const fields = `business_discovery.username(${username}){media.limit(50){permalink,media_type,media_url,children{media_type,media_url}}}`
  try {
    const res = await fetch(`${GRAPH}/${igUser}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      business_discovery?: {
        media?: {
          data?: {
            permalink?: string
            media_type?: string
            media_url?: string
            children?: { data?: { media_type?: string; media_url?: string }[] }
          }[]
        }
      }
    }
    const post = data.business_discovery?.media?.data?.find((m) => m.permalink?.includes(`/${code}`))
    if (!post) return null
    const urls =
      post.media_type === "CAROUSEL_ALBUM"
        ? (post.children?.data ?? []).filter((c) => c.media_type === "IMAGE" && c.media_url).map((c) => c.media_url!)
        : post.media_url
          ? [post.media_url]
          : []
    const slides = await Promise.all(urls.slice(0, MAX_SLIDES).map(imageDataUrl))
    return slides.filter((s): s is string => !!s)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { url } = (await req.json().catch(() => ({}))) as { url?: unknown }
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "url_required", message: "חסר קישור." }, { status: 400 })
  }
  try {
    const link = new URL(url.trim())
    const host = link.hostname.replace(/^www\./, "")
    let title: string | null = null
    try {
      const preview = await readPreview(link.toString())
      title = preview.title
    } catch (err) {
      if (!(err instanceof LinkError)) throw err
    }
    if (host === "instagram.com" || host.endsWith(".instagram.com")) {
      const code = shortcodeOf(link)
      const username = instagramUsername(link, title)
      const slides = code && username ? await instagramSlides(username, code) : null
      if (slides && slides.length >= 2) return NextResponse.json({ slides, source: "instagram" })
    }
    // A page's share picture is one slide — not a carousel to copy.
    return NextResponse.json({ error: "unreadable", message: UNREADABLE }, { status: 422 })
  } catch {
    return NextResponse.json({ error: "unreadable", message: UNREADABLE }, { status: 422 })
  }
}
