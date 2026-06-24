import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Bug reports submitted from the in-app "נתקלת בבאג?" widget land in a Notion
// database. The app authenticates to Notion with an internal integration token
// (NOTION_API_KEY) that must be shared with the target database.
const NOTION_API = "https://api.notion.com/v1/pages"
const NOTION_VERSION = "2022-06-28"
// The "🐞 דיווחי באגים — NLCAI" database. Overridable via env.
const BUG_DB_ID = process.env.NOTION_BUG_DB_ID || "99312b78e45a4b14b66b55e56936a68d"

const PAGES = new Set(["בית", "פוסטי ליבה", "רעיונות", "מחסן הוקים", "מדיה", "תזמון", "הגדרות", "אחר"])

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const token = process.env.NOTION_API_KEY
    if (!token) {
      console.error("[bug-report] NOTION_API_KEY is not set")
      return NextResponse.json({ error: "notion_not_configured" }, { status: 503 })
    }

    const body = await req.json().catch(() => ({}))
    const description = typeof body.description === "string" ? body.description.trim() : ""
    const page = PAGES.has(body.page) ? body.page : "אחר"
    // Accept an array of screenshot URLs (back-compat: also accept a single screenshotUrl).
    const screenshotUrls: string[] = Array.isArray(body.screenshotUrls)
      ? body.screenshotUrls.filter((u: unknown): u is string => typeof u === "string" && u.trim().length > 0).map((u: string) => u.trim())
      : typeof body.screenshotUrl === "string" && body.screenshotUrl.trim()
        ? [body.screenshotUrl.trim()]
        : []
    if (!description) {
      return NextResponse.json({ error: "description_required" }, { status: 400 })
    }

    // Title = first line / first ~70 chars of the description, for a readable row.
    const firstLine = description.split("\n")[0]
    const summary = firstLine.length > 70 ? `${firstLine.slice(0, 70)}…` : firstLine

    // Notion caps a single rich_text content at 2000 chars.
    const safeDescription = description.slice(0, 2000)

    const properties: Record<string, unknown> = {
      "סיכום": { title: [{ text: { content: summary } }] },
      "תיאור הבאג": { rich_text: [{ text: { content: safeDescription } }] },
      "עמוד": { select: { name: page } },
      "סטטוס": { select: { name: "חדש" } },
    }
    if (user.email) properties["מדווח/ת"] = { email: user.email }
    // The URL property holds a quick-access link (first shot); all shots go in the body.
    if (screenshotUrls.length > 0) properties["צילום מסך"] = { url: screenshotUrls[0] }

    // Mirror every screenshot into the page body, so they're viewable inline.
    const children = screenshotUrls.length > 0
      ? screenshotUrls.map((url) => ({ object: "block", type: "image", image: { type: "external", external: { url } } }))
      : undefined

    const res = await fetch(NOTION_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: BUG_DB_ID },
        properties,
        ...(children ? { children } : {}),
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error(`[bug-report] Notion create failed: ${res.status} ${errText}`)
      // 401/404 usually means the integration token is wrong or the DB wasn't
      // shared with the integration — surface as the config error.
      if (res.status === 401 || res.status === 404) {
        return NextResponse.json({ error: "notion_not_configured" }, { status: 503 })
      }
      return NextResponse.json({ error: "notion_create_failed" }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[bug-report] error:", err)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
