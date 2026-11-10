import { canOwnMediaText, driveInBRoll } from "@/lib/feature-access"
import { withGraphicOnly } from "@/lib/visual-language/graphic-only"
import { gatePlacement } from "@/lib/feature-access"
import { BLANK_NEEDS_BRIEF, normalizeMediaBrief, withMediaBrief, withMediaReferences } from "@/lib/media-brief"
import { parseReferences, referenceBuffer } from "@/lib/ai-edit-references"
import { stripFrameMarkers } from "@/lib/story-text-split"
import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { BACKGROUND_FRAMINGS, OWN_BACKGROUND_LINE, buildBackgroundPrompt, cropToCanvas, pictureAsBackground } from "@/lib/broll-animation/background"
import { buildCompositionBrief } from "@/lib/broll-animation/brief"
import { composeBRoll, finalizeHtml } from "@/lib/broll-animation/compose"
import { FAST_RENDER_PAGES, renderComposition } from "@/lib/broll-animation/render"
import { pickLibraryMedia } from "@/lib/broll-animation/library-media"
import { saveBRoll, uploadBackground } from "@/lib/broll-animation/store"
import { generateImage } from "@/lib/openai-image"
import { isMediaStyle } from "@/lib/visual-language/types"
import { loadBrandExamples, resolveDesignDirection } from "@/lib/visual-language/direction"

// Rendering the clip alone takes ~250–270s on our functions (175 frames
// screenshotted by a Lambda-sized Chromium; the same render is 10–18s on a
// laptop). Anything before it — reading the request, editing the picture,
// checking it, a new background — pushed past the old 300s cap and the whole
// edit was cut off after the work was done (Hani, 2026-11-05: her blended
// picture was ready at 29s; the render was killed at 300s). The project runs
// on Pro with Fluid compute, where 800s is allowed.
export const maxDuration = 800

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
  const started = Date.now()
  const timing: Record<string, number> = {}
  try {
    const { postId, variationIndex, style, brief: mediaBrief, references, place } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
      style?: unknown
      /** Her own direction for this piece (lib/media-brief). */
      brief?: unknown
      /** Look references (a picture pulled from a link) — lib/ai-edit-references. */
      references?: unknown
      /** Pictures she attached to put INTO the b-roll as they are — the first one is its background. */
      place?: unknown
    }
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }
    if (style === "blank" && !normalizeMediaBrief(mediaBrief)) {
      return NextResponse.json(BLANK_NEEDS_BRIEF, { status: 400 })
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

    // The b-roll's script is the text, word for word (Hani, 2026-11-09):
    // its first line is the hook, the rest the reading caption. The post's
    // hook / title only when the b-roll has no script of its own.
    const scriptHook = variantBody ? stripFrameMarkers(variantBody).split(/\n+/).map((l) => l.trim()).find(Boolean) : undefined
    const hook = scriptHook || post.hook_text?.trim() || post.title?.trim() || ""
    if (!hook) {
      return NextResponse.json(
        {
          error: "no_hook",
          message: "אין טקסט כותרת לפוסט. הוסיפו הוק ואז נוכל לייצר בי-רול.",
        },
        { status: 400 },
      )
    }
    const rest = (variantBody ? stripFrameMarkers(variantBody) : undefined)
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
    // Her own direction (lib/media-brief) rides on the direction lines, so it
    // reaches both the background picture and the motion design.
    // Her own picture (Hani, 2026-11-05: "התמונה תכנס ביצירה הראשונה"):
    // the b-roll is built ON it — her exact file, whole, never redrawn —
    // instead of a generated background. A link's picture stays a look only.
    // Placing is Hani-only for now (lib/feature-access); off it, all are looks.
    const gated = gatePlacement(user.email, parseReferences(place), parseReferences(references))
    const placed = gated.place
    // EXPERIMENT (gated): one file from her Drive b-roll folder, placed whole
    // on the generated background (lib/broll-animation/library-media).
    const stamp = crypto.randomUUID()
    let library: Awaited<ReturnType<typeof pickLibraryMedia>> = null
    if (!placed.length && driveInBRoll(user.email)) {
      const t = Date.now()
      library = await pickLibraryMedia(supabase, user.id, stamp).catch((e) => {
        console.error("[b-roll library]", e)
        return null
      })
      timing.library = Date.now() - t
    }
    const ownBackground = placed.length ? await pictureAsBackground(referenceBuffer(placed[0])) : null
    const baseDirection = withMediaBrief(
      // Her language makes graphics only, never a photo (gated).
      withGraphicOnly(
        await resolveDesignDirection(supabase, user.id, {
          format: "b_roll",
          allowReferences: false,
          style: isMediaStyle(style) ? style : undefined,
        }),
        user.email,
      ),
      normalizeMediaBrief(mediaBrief),
    )
    const direction = ownBackground
      ? {
          ...baseDirection,
          lines: [
            ...baseDirection.lines,
            "",
            OWN_BACKGROUND_LINE,
          ],
        }
      : baseDirection
    // Her references: the background gets them as images, the motion design
    // as referenceBlocks. The saved composition brief keeps the plain lines,
    // so later edits aren't told about images they don't have.
    const refs = gated.looks
    const refDirection = withMediaReferences(direction, refs)
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

    // Fixed path (gated): the background is a picture, never the core post's words.
    const context = canOwnMediaText(user.email) ? "" : (post.body ?? variantBody ?? hook).slice(0, 600)
    const mediaStyle = isMediaStyle(style) ? style : undefined
    timing.setup = Date.now() - started
    let mark = Date.now()
    const [brief, examples] = await Promise.all([
      buildCompositionBrief(supabase, user.id, { hook, rest: rest || undefined }, direction.lines, mediaStyle),
      // Her own finished b-roll frames (Settings → דוגמאות לשימוש → בי-רול)
      // set how the text looks — only in her own visual language, so a
      // niche / dark / light pick stays clear of her brand. They go to Opus
      // only: the background stays reference-free, so no lettering from them
      // can leak into it.
      direction.source === "brand"
        ? loadBrandExamples(supabase, user.id, "b_roll", undefined)
        : Promise.resolve([]),
    ])

    timing.brief = Date.now() - mark
    if (library) brief.libraryMedia = { url: library.url, kind: library.kind, width: library.width, height: library.height }
    mark = Date.now()
    const timed = <T,>(k: string, p: Promise<T>) =>
      p.then((v) => {
        timing[k] = Date.now() - mark
        return v
      })
    // Background and motion design don't depend on each other — run both.
    const [raw, template] = await Promise.all([
      ownBackground
        ? Promise.resolve(null)
        : timed("background", generateImage(
            openaiKey,
            buildBackgroundPrompt(
              refDirection,
              BACKGROUND_FRAMINGS[Math.abs(variationIndex ?? 0) % BACKGROUND_FRAMINGS.length],
              context,
            ),
            { shape: "9:16", references: refDirection.references },
          )),
      timed("opus", composeBRoll(anthropicKey, brief, Math.abs(variationIndex ?? 0), examples, refs)),
    ])
    timing.parallel = Date.now() - mark
    mark = Date.now()
    const background = ownBackground ?? Buffer.from(cropToCanvas(raw!), "base64")

    const backgroundUrl = await uploadBackground(supabase, user.id, stamp, background)
    timing.uploadBackground = Date.now() - mark

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-${stamp}.mp4`)
    tmpFiles.push(outPath)
    mark = Date.now()
    await renderComposition(finalizeHtml(template, backgroundUrl, brief.fonts), outPath, timing, driveInBRoll(user.email) ? FAST_RENDER_PAGES : 1)
    timing.render = Date.now() - mark
    const clip = await fs.readFile(outPath)

    mark = Date.now()
    timing.total = Date.now() - started
    const publicUrl = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      template,
      brief,
      backgroundUrl,
      edits: [],
      timing,
    })
    timing.save = Date.now() - mark
    console.log("[b-roll timing]", JSON.stringify({ ...timing, total: Date.now() - started }))

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
