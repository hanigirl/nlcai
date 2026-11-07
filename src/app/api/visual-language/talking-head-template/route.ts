import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canTalkingHeadAi } from "@/lib/feature-access"
import { loadTalkingHeadTemplate, saveTalkingHeadTemplate, withRequest } from "@/lib/talking-head-template"

/**
 * Her template for talking-head AI edits (lib/talking-head-template).
 *   GET                         → { instructions }
 *   PUT  { instructions }       → { instructions }   (Settings: the whole text)
 *   POST { append: request }    → { instructions }   (the panel's "לשמור כתבנית")
 * Hani + Nataliya only (lib/feature-access).
 */
async function gate() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const
  if (!canTalkingHeadAi(user.email)) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const
  return { supabase, user } as const
}

const FAILED = { error: "save_failed", message: "לא הצלחנו לשמור את התבנית. נסו שוב." }

export async function GET() {
  const g = await gate()
  if ("error" in g) return g.error
  return NextResponse.json({ instructions: await loadTalkingHeadTemplate(g.supabase, g.user.id) })
}

export async function PUT(req: NextRequest) {
  const g = await gate()
  if ("error" in g) return g.error
  const { instructions } = (await req.json().catch(() => ({}))) as { instructions?: unknown }
  if (typeof instructions !== "string") return NextResponse.json({ error: "instructions required" }, { status: 400 })
  try {
    return NextResponse.json({ instructions: await saveTalkingHeadTemplate(g.supabase, g.user.id, instructions) })
  } catch (err) {
    console.error("[talking-head-template] put", err)
    return NextResponse.json(FAILED, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ("error" in g) return g.error
  const { append } = (await req.json().catch(() => ({}))) as { append?: unknown }
  if (typeof append !== "string" || !append.trim()) return NextResponse.json({ error: "append required" }, { status: 400 })
  try {
    const current = await loadTalkingHeadTemplate(g.supabase, g.user.id)
    return NextResponse.json({ instructions: await saveTalkingHeadTemplate(g.supabase, g.user.id, withRequest(current, append)) })
  } catch (err) {
    console.error("[talking-head-template] append", err)
    return NextResponse.json(FAILED, { status: 500 })
  }
}
