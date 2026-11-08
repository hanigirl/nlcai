import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canTalkingHeadAi } from "@/lib/feature-access"
import { EditError, runTalkingHeadEdit, type PlanMoment } from "@/lib/talking-head-edit"
import { saveApplied } from "@/lib/talking-head-original"

/** Shared by api/talking-head/captions and /edit: gate, run from the original, store. */
export async function handleTalkingHeadEdit(body: {
  postId?: string
  url?: string
  captions: boolean
  moments: PlanMoment[]
  request?: string
  /** Cut fillers and dead air first, when the video needs it (lib/talking-head-cuts). */
  cuts?: boolean
}) {
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const stamp = crypto.randomUUID()
  const work = path.join(os.tmpdir(), `th-edit-${stamp}`)
  try {
    if (!body.postId) return NextResponse.json({ error: "postId is required" }, { status: 400 })
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!canTalkingHeadAi(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })
    const { data: post } = await supabase.from("core_posts").select("id").eq("id", body.postId).eq("user_id", user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    const { buffer, lines, source, applied, cuts } = await runTalkingHeadEdit({
      supabase,
      userId: user.id,
      postId: body.postId,
      url: body.url,
      captions: body.captions,
      moments: body.moments,
      request: body.request,
      cuts: body.cuts,
      work,
    })
    // What the cut pass did, for the chat (undefined: no cut pass).
    const cutInfo = cuts === undefined ? {} : { cuts: cuts ?? { none: true } }
    // Only cuts asked, and they were already good: her video stays as it is.
    if (!buffer) return NextResponse.json({ url: null, lines: [], ...cutInfo })
    const kind = applied.captions && !applied.moments.length && !applied.cuts ? "captioned" : "edited"
    const storagePath = `${user.id}/video/${kind}-th-${stamp}.mp4`
    const { error: upErr } = await supabase.storage.from("user-media").upload(storagePath, buffer, { contentType: "video/mp4" })
    if (upErr) throw new Error(upErr.message)
    const url = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl
    // What's on her video now — the next request continues from it.
    await saveApplied(supabase, user.id, body.postId, source, applied)
    return NextResponse.json({ url, lines: lines.map(({ text, start, end }) => ({ text, start, end })), ...cutInfo })
  } catch (error) {
    if (error instanceof EditError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[talking-head/edit]", msg)
    const message = msg === "no_audio" ? "בסרטון הזה אין פס קול, אז אין מה לתמלל." : "העריכה לא הצליחה הפעם. נסו שוב."
    return NextResponse.json({ error: msg, message }, { status: 500 })
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function parseMoments(raw: unknown): PlanMoment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((m) => m as { at?: unknown; quote?: unknown; element?: unknown })
    .filter((m) => typeof m.quote === "string" && m.quote.trim())
    .slice(0, 6)
    .map((m) => ({
      at: typeof m.at === "string" ? m.at : "0:00",
      quote: String(m.quote).trim().slice(0, 120),
      element: m.element === "highlight" || m.element === "animation" ? m.element : "card",
    }))
}
