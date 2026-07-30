import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"

/**
 * The calendar's server side.
 *
 * `timing-storage.ts` still writes localStorage synchronously so the board
 * stays instant, but every write is mirrored here and every page load
 * re-hydrates from here. That makes this table the source of truth: the board
 * survives a browser switch, and Chandler (the newsletter agent, running in
 * the cloud on Saturday night) can read what was scheduled without Hani's tab
 * being open.
 *
 * Wire shape is camelCase — identical to the client `ScheduledPost` type — so
 * the sync layer can drop rows straight into its cache with no translation.
 */

type Row = {
  core_post_id: string
  format: string
  scheduled_date: string
  scheduled_time: string | null
  published_at: string | null
  hook: string | null
}

type WireRow = {
  corePostId: string
  format: string
  scheduledDate: string
  scheduledTime: string | null
  publishedAt: string | null
  hook?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toWire(row: Row): WireRow {
  return {
    corePostId: row.core_post_id,
    format: row.format,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    publishedAt: row.published_at,
    hook: row.hook ?? undefined,
  }
}

/** Validate + normalise one incoming row. Returns null when unusable. */
function parseWire(input: unknown): WireRow | null {
  if (!input || typeof input !== "object") return null
  const r = input as Record<string, unknown>
  const corePostId = typeof r.corePostId === "string" ? r.corePostId : ""
  const format = typeof r.format === "string" ? r.format.trim() : ""
  const scheduledDate = typeof r.scheduledDate === "string" ? r.scheduledDate : ""
  if (!UUID_RE.test(corePostId)) return null
  if (!format) return null
  if (!DATE_RE.test(scheduledDate)) return null

  const rawTime = typeof r.scheduledTime === "string" ? r.scheduledTime : ""
  const scheduledTime = TIME_RE.test(rawTime) ? rawTime : "09:00"
  const publishedAt = typeof r.publishedAt === "string" ? r.publishedAt : null
  const hook = typeof r.hook === "string" ? r.hook : undefined

  return { corePostId, format, scheduledDate, scheduledTime, publishedAt, hook }
}

// GET — the whole board for the signed-in user.
export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("core_post_id, format, scheduled_date, scheduled_time, published_at, hook")
    .eq("user_id", user.id)
    .order("scheduled_date", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ scheduled: (data as Row[]).map(toWire) })
}

/**
 * PUT — upsert one row, or a batch.
 *
 * The batch form (`{ rows: [...] }`) exists for the one-time backfill that
 * lifts a browser's existing localStorage board into the table on first load
 * after this ships. Both forms upsert on (core_post_id, format), so replaying
 * either is safe.
 */
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const raw = body as { rows?: unknown }
  const inputs = Array.isArray(raw?.rows) ? raw.rows : [body]
  const parsed = inputs.map(parseWire).filter((r): r is WireRow => r !== null)
  const skipped = inputs.length - parsed.length

  if (parsed.length === 0) {
    return NextResponse.json(
      { error: "No valid rows", skipped },
      { status: 400 },
    )
  }

  const payload = parsed.map((r) => ({
    user_id: user.id,
    core_post_id: r.corePostId,
    format: r.format,
    scheduled_date: r.scheduledDate,
    scheduled_time: r.scheduledTime ?? "09:00",
    published_at: r.publishedAt,
    hook: r.hook ?? null,
  }))

  // `as never` per the repo convention (see core-identity, sync-allowlist) —
  // this supabase-js version widens write payloads to `never` under the
  // Database generic.
  const { error } = await supabase
    .from("scheduled_posts")
    .upsert(payload as never, { onConflict: "core_post_id,format" })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ saved: parsed.length, skipped })
}

/**
 * DELETE — remove one slot, or every slot of a post.
 *
 * `?corePostId=…&format=…` unschedules a single format ("בטלו תזמון").
 * `?corePostId=…` with no format clears the whole post — what happens when
 * the core post itself is deleted and there is nothing left to schedule.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const corePostId = searchParams.get("corePostId") ?? ""
  const format = searchParams.get("format")

  if (!UUID_RE.test(corePostId)) {
    return NextResponse.json({ error: "corePostId is required" }, { status: 400 })
  }

  let query = supabase
    .from("scheduled_posts")
    .delete()
    .eq("user_id", user.id)
    .eq("core_post_id", corePostId)

  if (format) query = query.eq("format", format)

  const { error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
