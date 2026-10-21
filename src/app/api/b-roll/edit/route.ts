import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { finalizeHtml, reviseBRoll } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import { loadComposition, saveBRoll } from "@/lib/broll-animation/store"
import { learnFromInstruction } from "@/lib/style-memory"

// Opus revision + frame-by-frame render.
export const maxDuration = 300

/**
 * "עריכה עם AI" on a b-roll (Hani, 2026-10-22): her instruction, in her words,
 * applied by Opus to the composition behind the current clip. The background
 * stays; only the motion design / type / colours change as she asks. The
 * result replaces the clip, and its composition (with the instruction
 * appended to `edits`) is stored so the next edit builds on this one.
 *
 * POST { postId, instruction } → { url }
 */
export async function POST(req: NextRequest) {
  const tmpFiles: string[] = []
  try {
    const { postId, instruction } = (await req.json().catch(() => ({}))) as {
      postId?: string
      instruction?: string
    }
    const text = instruction?.trim()
    if (!postId || !text) {
      return NextResponse.json({ error: "postId and instruction are required" }, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // The post must be hers; its current b-roll clip is the one we edit.
    const { data: post } = await supabase
      .from("core_posts")
      .select("id")
      .eq("id", postId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    const { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", postId)
      .eq("format", "b_roll")
      .maybeSingle()
    const { data: asset } = variant
      ? await supabase
          .from("media_assets")
          .select("url")
          .eq("format_variant_id", (variant as { id: string }).id)
          .eq("asset_type", "video")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null }
    const clipUrl = (asset as { url: string | null } | null)?.url ?? null
    const composition = clipUrl ? await loadComposition(supabase, clipUrl) : null
    if (!composition) {
      return NextResponse.json(
        {
          error: "no_composition",
          message: "אפשר לערוך עם AI רק בי-רול שנוצר במנוע החדש. צרו בי-רול חדש ואז ערכו אותו.",
        },
        { status: 400 },
      )
    }

    let anthropicKey: string
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "anthropic_not_connected") {
        return NextResponse.json(
          { error: "anthropic_not_connected", message: "כדי לערוך עם AI צריך לחבר מפתח Claude בהגדרות." },
          { status: 400 },
        )
      }
      throw e
    }

    // Learning runs alongside the edit: a lasting preference in her words
    // ("the brush thin and yellow") applies to every format from now on.
    const [template, remembered] = await Promise.all([
      reviseBRoll(anthropicKey, composition.brief, composition.template, text),
      learnFromInstruction(supabase, user.id, anthropicKey, text, "b-roll"),
    ])

    const stamp = crypto.randomUUID()
    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-edit-${stamp}.mp4`)
    tmpFiles.push(outPath)
    await renderComposition(
      finalizeHtml(template, composition.backgroundUrl, composition.brief.fonts),
      outPath,
    )
    const clip = await fs.readFile(outPath)

    const url = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      ...composition,
      template,
      edits: [...composition.edits, text],
    })
    return NextResponse.json({ url, remembered })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/edit]", msg)
    const message =
      msg === "composition_invalid" || msg === "composition_not_seekable"
        ? "העריכה לא הצליחה הפעם. נסו שוב, אולי בניסוח אחר."
        : undefined
    return NextResponse.json({ error: msg, message }, { status: 500 })
  } finally {
    const fs = await import("fs/promises")
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)))
  }
}
