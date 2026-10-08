import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { createAdminClient, isAdminEmail } from "@/lib/supabase/admin"

/**
 * GET  /api/notices        → the caller's open notices (+ admin ones for admins)
 * POST /api/notices {id}   → dismiss one
 *
 * system_notices is service-role only (039); this route is the gate.
 */

type Row = { id: string; audience: "user" | "admin"; code: string; created_at: string; expires_at: string | null }

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = isAdminEmail(user.email)
  const scope = admin
    ? `user_id.eq.${user.id},audience.eq.admin`
    : `user_id.eq.${user.id}`
  const { data, error } = await createAdminClient()
    .from("system_notices")
    .select("id, audience, code, created_at, expires_at")
    .or(scope)
    .is("resolved_at", null)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Expired ones (Gemini's daily cap has reset) are filtered here rather than
  // in a second `.or()`, which PostgREST would not AND with the first.
  const now = Date.now()
  const notices = ((data as Row[] | null) ?? []).filter(
    (n) => !n.expires_at || new Date(n.expires_at).getTime() > now,
  )
  return NextResponse.json({ notices })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const db = createAdminClient()
  const { data } = await db
    .from("system_notices")
    .select("audience, user_id")
    .eq("id", id)
    .maybeSingle<{ audience: string; user_id: string | null }>()
  const allowed =
    !!data && (data.user_id === user.id || (data.audience === "admin" && isAdminEmail(user.email)))
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await db.from("system_notices").update({ dismissed_at: new Date().toISOString() } as never).eq("id", id)
  return NextResponse.json({ ok: true })
}
