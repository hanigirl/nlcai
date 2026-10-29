import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { BACKGROUND_FRAMINGS, buildBackgroundPrompt, cropToCanvas } from "@/lib/broll-animation/background"
import { buildCompositionBrief } from "@/lib/broll-animation/brief"
import { composeBRoll, finalizeHtml } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import { saveBRoll, uploadBackground } from "@/lib/broll-animation/store"
import { generateImage } from "@/lib/openai-image"
import { isMediaStyle } from "@/lib/visual-language/types"
import { resolveDesignDirection } from "@/lib/visual-language/direction"

// gpt-image-2 takes 30-120s for one image.
export const maxDuration = 300

/**
 * AI b-roll — a generated background with the hook ANIMATED over it by
 * Claude Opus (Hani, 2026-10-22). Replaces the static caption plate.
 *
 * Two models, two jobs, run in parallel:
 *   - the image model draws the background only (still told to put no text in
 *     it — lettering it invents would fight the real type);
 *   - Opus writes the motion design as HTML in her fonts and brand colours,
 *     with the hook and "קראו בתיאור" verbatim (lib/broll-animation/compose).
 * A headless browser then renders the HTML frame by frame into a 7s MP4
 * (lib/broll-animation/render). The HTML is stored next to the clip so
 * "עריכה עם AI" can revise it (api/b-roll/edit).
 */

export async function POST(req: NextRequest) {
  const tmpFiles: string[] = []
  try {
    const { postId, variationIndex, style } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
      style?: unknown
    }
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id, hook_text, title, body")
      .eq("id", postId)
      .eq("user_id", user.id)
      .single()
    const post = postRow as {
      id: string
      hook_text: string | null
      title: string | null
      body: string | null
    } | null
    if (postErr || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { data: variantRow } = await supabase
      .from("format_variants")
      .select("body")
      .eq("core_post_id", postId)
      .eq("format", "b_roll")
      .maybeSingle()
    const variantBody = (variantRow as { body: string | null } | null)?.body

    // b-roll's script IS the hook (see api/core-posts/[id]/media), so the
    // caption is the hook alone unless the variant carries more.
    const hook =
      post.hook_text?.trim() ||
      post.title?.trim() ||
      variantBody?.split(/\n+/)[0]?.trim() ||
      ""
    if (!hook) {
      return NextResponse.json(
        {
          error: "no_hook",
          message: "אין טקסט כותרת לפוסט. הוסיפו הוק ואז נוכל לייצר בי-רול.",
        },
        { status: 400 },
      )
    }
    const rest = variantBody
      ?.split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.replace(/\s+/g, "") !== hook.replace(/\s+/g, ""))
      .join(" ")

    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "openai_not_connected") {
        return NextResponse.json(
          {
            error: "openai_not_connected",
            message:
              "כדי לייצר בי-רול צריך לחבר מפתח OpenAI בהגדרות.",
          },
          { status: 400 },
        )
      }
      throw e
    }

    // Her visual language (or the niche-derived one). No reference
    // elements: this is a text-free background and the caption is laid
    // over it afterwards, so a logo would collide with it.
    const direction = await resolveDesignDirection(supabase, user.id, {
      format: "b_roll",
      allowReferences: false,
      style: isMediaStyle(style) ? style : undefined,
    })
    let anthropicKey: string
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "anthropic_not_connected") {
        return NextResponse.json(
          {
            error: "anthropic_not_connected",
            message: "כדי לייצר בי-רול צריך לחבר מפתח Claude בהגדרות.",
          },
          { status: 400 },
        )
      }
      throw e
    }

    const context = (post.body ?? variantBody ?? hook).slice(0, 600)
    const mediaStyle = isMediaStyle(style) ? style : undefined
    const brief = await buildCompositionBrief(
      supabase,
      user.id,
      { hook, rest: rest || undefined },
      direction.lines,
      mediaStyle,
    )

    // Background and motion design don't depend on each other — run both.
    const [raw, template] = await Promise.all([
      generateImage(
        openaiKey,
        buildBackgroundPrompt(
          direction,
          BACKGROUND_FRAMINGS[Math.abs(variationIndex ?? 0) % BACKGROUND_FRAMINGS.length],
          context,
        ),
        { shape: "9:16", references: direction.references },
      ),
      composeBRoll(anthropicKey, brief, Math.abs(variationIndex ?? 0)),
    ])
    const background = Buffer.from(cropToCanvas(raw), "base64")

    const stamp = crypto.randomUUID()
    const backgroundUrl = await uploadBackground(supabase, user.id, stamp, background)

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-${stamp}.mp4`)
    tmpFiles.push(outPath)
    await renderComposition(finalizeHtml(template, backgroundUrl, brief.fonts), outPath)
    const clip = await fs.readFile(outPath)

    const publicUrl = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      template,
      brief,
      backgroundUrl,
      edits: [],
    })

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/generate-media]", msg)
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
    const message =
      msg === "composition_invalid" || msg === "composition_not_seekable"
        ? "יצירת האנימציה לא הצליחה הפעם. נסו שוב."
        : undefined
    return NextResponse.json({ error: msg, message }, { status: 500 })
  } finally {
    // Best-effort temp cleanup — never let it mask the real result.
    const fs = await import("fs/promises")
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)))
  }
}
