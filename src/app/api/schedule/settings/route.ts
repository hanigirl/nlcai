import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"

/**
 * The weekly posting routine ("הגדרות תזמון"), stored on the account so it is
 * the same on every device (QA 2026-11-15 — it lived in one browser only).
 *
 * GET  → { schedule: PostingSchedule | null, userId }   (null = never saved)
 * PUT  { schedule } → { ok: true }
 */
export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data, error } = await supabase
    .from("users")
    .select("posting_schedule")
    .eq("id", user.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    schedule: (data as { posting_schedule?: unknown } | null)?.posting_schedule ?? null,
    userId: user.id,
  })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  let body: { schedule?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const s = body?.schedule as { days?: unknown } | undefined
  if (!s || !Array.isArray(s.days) || s.days.length !== 7) {
    return NextResponse.json({ error: "Invalid schedule" }, { status: 400 })
  }
  if (JSON.stringify(s).length > 20_000) {
    return NextResponse.json({ error: "Schedule too large" }, { status: 400 })
  }
  const { data, error } = await supabase
    .from("users")
    .update({ posting_schedule: s } as never)
    .eq("id", user.id)
    .select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: "Not saved" }, { status: 500 })
  return NextResponse.json({ ok: true })
}
