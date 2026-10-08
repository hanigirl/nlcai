import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { recordLikedHookInsight } from "@/lib/learning-insights"

/**
 * POST /api/hooks/liked { hookId }
 *
 * Called when she stars a hook. Distills what WORKED in its form into
 * "מה ה-AI למד" (see recordLikedHookInsight). Best-effort: the star itself
 * is already saved client-side; a failure here costs only the lesson.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { hookId } = (await req.json().catch(() => ({}))) as { hookId?: string }
  if (!hookId) return NextResponse.json({ error: "hookId is required" }, { status: 400 })

  const { data: hook } = await supabase
    .from("hooks")
    .select("hook_text")
    .eq("id", hookId)
    .eq("user_id", user.id)
    .maybeSingle<{ hook_text: string }>()
  if (!hook?.hook_text) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return NextResponse.json({ insight: null, skipped: "anthropic_not_connected" })
  }

  try {
    const result = await recordLikedHookInsight(supabase, apiKey, { userId: user.id, hookText: hook.hook_text })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[hooks/liked]", err)
    return NextResponse.json({ insight: null, error: "learn_failed" }, { status: 500 })
  }
}
