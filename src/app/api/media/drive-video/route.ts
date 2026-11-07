import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { fetchDriveFile } from "@/lib/drive-fetch"

// A long clip streams for a while; seeking makes short ranged requests.
export const maxDuration = 300

/**
 * Her Drive video, streamed so a real <video> can play it (Hani, 2026-11-08:
 * "אם זה סרטון אני צריכה נגן שינגן לי את זה, יש שם תמונה"). Drive serves no
 * CORS headers, so a <video src> can't point at Drive itself — the app used
 * to show Drive's poster image in its place. This passes the bytes (and the
 * player's Range requests, so it can seek) straight through. Signed-in users
 * only; nothing is stored.
 *
 * GET /api/media/drive-video?id=<Drive file id>
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  // Local dev only: the /test preview pages have no session (as /test/* itself).
  if (!user && process.env.NODE_ENV === "production") return new Response("Unauthorized", { status: 401 })
  const id = req.nextUrl.searchParams.get("id") ?? ""
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return new Response("Bad id", { status: 400 })

  let res: Response
  try {
    res = await fetchDriveFile(id, req.headers.get("range"))
  } catch {
    return new Response("Drive timeout", { status: 504 })
  }
  const type = (res.headers.get("content-type") || "").split(";")[0].trim()
  if (!res.ok || !res.body || type.includes("text/html")) {
    await res.body?.cancel().catch(() => undefined)
    return new Response("Drive file not available", { status: 404 })
  }
  const headers = new Headers({
    // Drive answers "application/octet-stream" for most uploads; a player wants a video type.
    "Content-Type": !type || type === "application/octet-stream" ? "video/mp4" : type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  })
  for (const h of ["content-length", "content-range"]) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(res.body, { status: res.status, headers })
}
