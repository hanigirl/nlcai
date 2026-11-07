import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { BROWSER_UA, IMAGE_TYPES, LinkError, MAX_IMAGE_BYTES, readCapped, readPreview, safeFetch } from "@/lib/link-preview"

/**
 * POST { url } → { image: dataUrl, title, host } | { error, message }
 *
 * A link as a reference (Hani, 2026-11-05: "אולי בא לי להוסיף לו תמונת רפרנס
 * או קישור לפני שהוא מתחיל לעבוד"). The image models can't open a page, so a
 * pasted link becomes the picture the page shares when it is posted anywhere
 * — its preview image (og:image / twitter:image). In the AI panel that picture
 * joins her references like a screenshot she attached; the link itself stays
 * in her words.
 *
 * No AI call and nothing stored: one page fetch and one image fetch, no
 * credits. Only public http(s) addresses — never this server's network.
 */

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { url } = (await req.json().catch(() => ({}))) as { url?: unknown }
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "url_required", message: "חסר קישור." }, { status: 400 })
  }

  try {
    const preview = await readPreview(url.trim())
    const res = await safeFetch(preview.image, BROWSER_UA, "image/*")
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim()
    if (!res.ok || !IMAGE_TYPES.test(type)) throw new LinkError("לא הצלחנו להוריד את התמונה מהקישור. אפשר לצרף צילום מסך במקום.")
    const bytes = await readCapped(res, MAX_IMAGE_BYTES)
    if (!bytes) throw new LinkError("התמונה בקישור גדולה מדי. אפשר לצרף צילום מסך במקום.")
    return NextResponse.json({
      image: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`,
      title: preview.title,
      host: new URL(preview.base).hostname.replace(/^www\./, ""),
    })
  } catch (err) {
    const message =
      err instanceof LinkError ? err.message : "לא הצלחנו לפתוח את הקישור. אפשר לצרף צילום מסך במקום."
    return NextResponse.json({ error: "link_failed", message }, { status: 422 })
  }
}
