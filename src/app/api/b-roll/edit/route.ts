import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { finalizeHtml, reviseBRoll } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import { loadComposition, saveBRoll, uploadBackground } from "@/lib/broll-animation/store"
import { currentCompositionBrief } from "@/lib/broll-animation/brief"
import { BACKGROUND_FRAMINGS, buildBackgroundPrompt, cropToCanvas } from "@/lib/broll-animation/background"
import { generateImage } from "@/lib/openai-image"
import { MOTION_RESTYLE_NOTE, wantsOwnLanguage } from "@/lib/visual-language/current-brief"
import { parseReferences } from "@/lib/ai-edit-references"

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
    const { postId, instruction, references } = (await req.json().catch(() => ({}))) as {
      /** Screenshots she attached (lib/ai-edit-references). */
      references?: unknown
      postId?: string
      instruction?: string
    }
    const text = instruction?.trim()
    const refs = parseReferences(references)
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

    // What to remember is decided before the edit, by the chat's memory
    // check (POST /api/visual-language/style-memory) — this route only edits.
    // Edited from her CURRENT language — never the snapshot the clip was made
    // in. When that language changed since, or she asks for hers, the look is
    // rebuilt in it, background included (Hani, 2026-11-05).
    const ownLanguage = wantsOwnLanguage(text)
    const current = await currentCompositionBrief(supabase, user.id, composition.brief, { format: "b_roll", ownLanguage })
    const restyle = current.changed || ownLanguage
    const brief = current.brief
    const stamp = crypto.randomUUID()
    let backgroundUrl = composition.backgroundUrl
    let template: string
    if (restyle) {
      let openaiKey: string
      try {
        openaiKey = await getUserApiKey(supabase, "openai_api_key")
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === "openai_not_connected") {
          return NextResponse.json(
            { error: msg, message: "כדי להחיל את השפה הוויזואלית על הבי-רול צריך לחבר מפתח OpenAI בהגדרות." },
            { status: 400 },
          )
        }
        throw e
      }
      const context = [brief.hook, brief.rest].filter(Boolean).join("\n")
      const [raw, revised] = await Promise.all([
        generateImage(openaiKey, buildBackgroundPrompt(current.direction, BACKGROUND_FRAMINGS[0], context), { shape: "9:16" }),
        reviseBRoll(anthropicKey, brief, composition.template, `${text}\n\n${MOTION_RESTYLE_NOTE}`, refs),
      ])
      backgroundUrl = await uploadBackground(supabase, user.id, stamp, Buffer.from(cropToCanvas(raw), "base64"))
      template = revised
    } else {
      template = await reviseBRoll(anthropicKey, brief, composition.template, text, refs)
      // Opus handed back the same composition: nothing to render or save.
      if (template.trim() === composition.template.trim()) {
        return NextResponse.json({
          url: clipUrl,
          unchanged: true,
          message: "הבקשה לא שינתה כלום בבי-רול, אז השארתי אותו כמו שהיה. נסו לכתוב מה בדיוק לשנות, למשל גודל הכותרת, הצבע או איך המילים נכנסות.",
        })
      }
    }

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-edit-${stamp}.mp4`)
    tmpFiles.push(outPath)
    await renderComposition(
      finalizeHtml(template, backgroundUrl, brief.fonts),
      outPath,
    )
    const clip = await fs.readFile(outPath)

    const url = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      ...composition,
      // The brief and background it now matches — her current language.
      brief,
      backgroundUrl,
      template,
      edits: [...composition.edits, text],
    })
    return NextResponse.json({ url })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/edit]", msg)
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
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
