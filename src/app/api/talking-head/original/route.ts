import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canTalkingHeadAi } from "@/lib/feature-access"
import { recordedOriginal } from "@/lib/talking-head-original"

/** POST { postId } → { url } — "חזרה לסרטון המקורי": her video as she brought it. */
export async function POST(req: NextRequest) {
  const { postId } = (await req.json().catch(() => ({}))) as { postId?: string }
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 })
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canTalkingHeadAi(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })
  const url = await recordedOriginal(supabase, user.id, postId)
  if (!url) return NextResponse.json({ error: "no_original", message: "לא מצאתי את הסרטון המקורי של הפוסט." }, { status: 404 })
  return NextResponse.json({ url })
}
