import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canTalkingHeadAi } from "@/lib/feature-access"
import { peekOriginal, recordedOriginal } from "@/lib/talking-head-original"

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

/**
 * GET ?postId → { url } — her original video, read only (nothing reset): the
 * cover is made from it, never from an edited render with captions burned in.
 * url null when she has no edit yet (the current video is the original).
 */
export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId")
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 })
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data: post } = await supabase.from("core_posts").select("id").eq("id", postId).eq("user_id", user.id).maybeSingle()
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })
  return NextResponse.json({ url: await peekOriginal(supabase, user.id, postId) })
}
