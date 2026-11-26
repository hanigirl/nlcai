import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"

/**
 * GET /api/hooks/:id/brief        → { brief: string | null }
 * PUT /api/hooks/:id/brief { brief } → { ok: true, brief }
 *
 * The canvas field "מה תרצו להגיד על זה?" for one hook. It used to live only
 * in a single localStorage slot that the next hook she opened overwrote, so it
 * never reached another device and was gone within an hour on the same one.
 *
 * Every query is scoped to the caller's own row (id + user_id, on top of the
 * hooks RLS policies); someone else's hook id answers 404.
 *
 * Until migration 049 is applied the column doesn't exist: both methods answer
 * 200 with `unavailable: true` so the canvas keeps its local copy and carries
 * on instead of erroring.
 */

const MAX_BRIEF_CHARS = 20_000

type PgError = { code?: string; message?: string } | null

function isMissingColumn(error: PgError): boolean {
  if (!error) return false
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /brief.*(does not exist|could not find)|could not find.*brief/i.test(error.message ?? "")
  )
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const { data, error } = await supabase
    .from("hooks")
    .select("id, brief")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (isMissingColumn(error)) {
    console.warn("[hooks/brief] hooks.brief missing — migration 049 not applied yet")
    return NextResponse.json({ brief: null, unavailable: true })
  }
  if (error) {
    console.error("[hooks/brief] GET failed", error)
    return NextResponse.json({ error: "load_failed" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const brief = (data as { brief: string | null }).brief
  return NextResponse.json({ brief: brief ?? null })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const body = (await req.json().catch(() => null)) as { brief?: unknown; onlyIfEmpty?: unknown } | null
  if (!body || typeof body.brief !== "string") {
    return NextResponse.json({ error: "brief must be a string" }, { status: 400 })
  }
  const brief = body.brief.slice(0, MAX_BRIEF_CHARS)
  // The one-time push of a brief found only in this browser must never
  // overwrite a value already on the server (typed on another device).
  const onlyIfEmpty = body.onlyIfEmpty === true

  let query = supabase
    .from("hooks")
    .update({ brief, brief_updated_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("user_id", user.id)
  if (onlyIfEmpty) query = query.or("brief.is.null,brief.eq.")

  const { data, error } = await query.select("id, brief")

  if (isMissingColumn(error)) {
    console.warn("[hooks/brief] hooks.brief missing — migration 049 not applied yet")
    return NextResponse.json({ ok: false, unavailable: true })
  }
  if (error) {
    console.error("[hooks/brief] PUT failed", error)
    return NextResponse.json({ error: "save_failed" }, { status: 500 })
  }

  const rows = (data as { id: string; brief: string | null }[] | null) ?? []
  if (rows.length === 0) {
    if (onlyIfEmpty) {
      // Either the hook isn't hers, or the server already has a brief. Tell
      // the two apart so the canvas can adopt the server value.
      const { data: existing } = await supabase
        .from("hooks")
        .select("brief")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: false, skipped: "server_not_empty", brief: (existing as { brief: string | null }).brief ?? null })
      }
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, brief: rows[0].brief ?? "" })
}
