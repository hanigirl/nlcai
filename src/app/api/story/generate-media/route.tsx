import { canOwnMediaText } from "@/lib/feature-access"
import { resetAgentChat } from "@/lib/edit-agent/reset-chat"
import { withGraphicOnly } from "@/lib/visual-language/graphic-only"
import { BLANK_NEEDS_BRIEF, PLACE_FAILED_GEN, normalizeMediaBrief, withMediaBrief, withMediaReferences, withPlacedImages } from "@/lib/media-brief"
import { PICTURE_IS_BACKGROUND, refusesPlacingIntoDesign, gatePlacement } from "@/lib/feature-access"
import { picturesPlaced, placedImages } from "@/lib/placed-check"
import { parseReferences } from "@/lib/ai-edit-references"
import { NextRequest, NextResponse } from "next/server"
import { buildStoryPrompt, cropStoryToCanvas as cropToCanvas, frameRole } from "@/lib/story-frame-prompt"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { requestedFrameCount, storyFrames } from "@/lib/story-text-split"
import { getAuthUser } from "@/lib/auth-user"
import { replaceImageAssetSet, storedImageUrls } from "@/lib/media-asset-set"
import { generateImage } from "@/lib/openai-image"
import { applyFixedElements } from "@/lib/visual-language/fixed-elements"
import { isMediaStyle } from "@/lib/visual-language/types"
import { pickComposition, resolveDesignDirection } from "@/lib/visual-language/direction"

// gpt-image-2 takes 30-120s per image; a long story fans out to up to 3
// frames run with limited concurrency, so leave generous headroom.
export const maxDuration = 300

// Parallel OpenAI image calls per story (rate-limit friendly).
const CONCURRENCY = 3

/**
 * AI "media-to-story" generation — gpt-image-2 (BYOK — users.openai_api_key)
 * renders each story frame as a COMPLETE designed 9:16 image, with the
 * Hebrew script baked into the composition (designed typography AND correct
 * spelling), following one shared design language so multi-frame stories
 * read as a single set. Same model + crop approach as
 * image-post/generate-media and carousel/generate-ai.
 *
 * The route is pure: it returns base64 PNGs (plus the frame count) and does
 * NOT persist anything. The client persists the chosen set via
 * PATCH /api/core-posts/{id} { storyImages } — the carousel-style
 * multi-image path — so persistence stays in one place.
 */

/**
 * Split the story body into designed frames.
 *
 * The split itself lives in `lib/story-text-split` so the Drive-import path
 * burns captions on exactly the same boundaries (Hani, 2026-07-29). Here we
 * still CHOOSE the frame count from the script's length — the AI path owns
 * that decision, whereas the import path is told the count by how many links
 * the user pasted.
 */
/**
 * `asked`: a frame count she named in her brief ("לפצל ל-2 סטוריז"). The
 * split is lib/story-text-split storyFrames — the same one the story card
 * shows while she writes: her own marks first, then `asked` (balanced by
 * length), then her paragraphs.
 */
function splitStoryIntoFrames(body: string, asked?: number | null): string[] {
  return storyFrames(body, asked)
}


export async function POST(req: NextRequest) {
  try {
    const { postId, variationIndex, style, brief, references, place } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
      style?: unknown
      /** Her own direction for this piece (lib/media-brief). */
      brief?: unknown
      /** Look references (a picture pulled from a link) — lib/ai-edit-references. */
      references?: unknown
      /** Pictures she attached to put INTO the story as they are — on its first frame. */
      place?: unknown
    }
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }
    if (style === "blank" && !normalizeMediaBrief(brief)) {
      return NextResponse.json(BLANK_NEEDS_BRIEF, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Ownership + theme context in one fetch.
    const { data: postRow, error: postErr } = await supabase
      .from("core_posts")
      .select("id, title, hook_text, body")
      .eq("id", postId)
      .eq("user_id", user.id)
      .single()
    const post = postRow as {
      id: string
      title: string | null
      hook_text: string | null
      body: string | null
    } | null
    if (postErr || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // The text that appears ON the frames comes from the story variant —
    // server-authoritative, not echoed from the client.
    const { data: variantRow, error: variantErr } = await supabase
      .from("format_variants")
      .select("body")
      .eq("core_post_id", postId)
      .eq("format", "story")
      .single()
    const variant = variantRow as { body: string | null } | null
    if (variantErr || !variant?.body?.trim()) {
      return NextResponse.json(
        {
          error: "no_story_variant",
          message:
            "לפוסט הזה אין עדיין טקסט לפורמט סטורי. צרו קודם את הפורמט ואז אפשר לייצר ממנו סטורי.",
        },
        { status: 400 },
      )
    }

    const frames = splitStoryIntoFrames(variant.body, requestedFrameCount(normalizeMediaBrief(brief)))
    if (frames.length === 0) {
      return NextResponse.json(
        {
          error: "empty_story_text",
          message: "הטקסט של פורמט הסטורי ריק. מלאו אותו ונסו שוב.",
        },
        { status: 400 },
      )
    }

    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "openai_not_connected") {
        return NextResponse.json(
          {
            error: "openai_not_connected",
            message:
              "כדי לייצר סטורי עם AI צריך לחבר מפתח OpenAI בהגדרות ← חיבורים ← OpenAI.",
          },
          { status: 402 },
        )
      }
      throw err
    }

    // The look: her visual language, else one derived from her niche.
    // Resolved once so every frame shares it; regenerate rotates only the
    // composition.
    const base = withMediaBrief(
      // Her language makes graphics only, never a photo (gated).
      withGraphicOnly(
        await resolveDesignDirection(supabase, user.id, {
          format: "story",
          style: isMediaStyle(style) ? style : undefined,
        }),
        user.email,
      ),
      normalizeMediaBrief(brief),
    )
    // Placing is Hani-only for now (lib/feature-access); off it, all are looks.
    if (refusesPlacingIntoDesign(user.email, parseReferences(place))) {
      return NextResponse.json(PICTURE_IS_BACKGROUND, { status: 409 })
    }
    const gated = gatePlacement(user.email, parseReferences(place), parseReferences(references))
    const looks = gated.looks
    const direction = withMediaReferences(base, looks)
    // Her own pictures go in as they are — on the first frame, the one that
    // opens the story; a link's picture is a look only.
    const placed = await placedImages(gated.place)
    const firstDirection = placed.length ? withMediaReferences(withPlacedImages(base, placed), looks) : direction
    const composition = pickComposition(variationIndex)

    // Theme context: title + hook carry the essence; the body is truncated
    // so a long post doesn't drown the composition instructions.
    // Fixed path (gated): no core post / hook in the prompt — the image model
    // draws whatever text it is given (Hani, 2026-11-09).
    const context = canOwnMediaText(user.email)
      ? ""
      : [post.title, post.hook_text, post.body?.slice(0, 500)].filter(Boolean).join("\n")

    const total = frames.length
    const images: string[] = new Array(total)
    let firstRaw: string | null = null

    // Simple concurrency pool — kinder to OpenAI rate limits than firing
    // all frames at once, much faster than fully sequential.
    let next = 0
    async function worker() {
      while (next < total) {
        const i = next++
        const frameDirection = i === 0 ? firstDirection : direction
        const prompt = buildStoryPrompt(
          frames[i],
          i,
          total,
          frameDirection,
          composition,
          context,
        )
        const raw = await generateImage(openaiKey, prompt, {
          shape: "9:16",
          // gpt-image-2 — legible Hebrew glyphs are the whole point, so we
          // pay for "high" (same reasoning as image-post/generate-media).
          quality: "high",
          references: frameDirection.references,
          strict: i === 0 && placed.length > 0,
        })
        if (i === 0 && placed.length) firstRaw = raw
        // Fixed brand elements go in by code — same pixels on every frame.
        images[i] = await applyFixedElements(cropToCanvas(raw), direction.fixed, frameRole(i, total))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    )
    // Her picture must really be on the first frame — a look-alike or a miss is not kept.
    if (placed.length && firstRaw) {
      const claudeKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => null)
      if ((await picturesPlaced(claudeKey, placed, firstRaw)) === false) {
        return NextResponse.json(PLACE_FAILED_GEN, { status: 422 })
      }
    }

    // Saved to the post HERE, and the stored URLs sent back. Frames in her
    // visual language (fine grain) are 2–3MB each; as base64 two of them are
    // past the 4.5MB a request may carry on our host, so the browser's save
    // never arrived and the chat said "נוצר אבל לא נשמר" (Hani, 2026-11-05).
    // Generating is choosing — the set is the post's.
    // Stamped with the style it was made in — the panel reopens on it.
    const madeIn = isMediaStyle(style) ? style : base.source === "brand" ? "brand" : "niche"
    const saved = await replaceImageAssetSet(supabase, user.id, postId, "story", images, {
      style: madeIn === "brand" && base.source !== "brand" ? "niche" : madeIn,
    })
    if (!saved.ok) {
      console.error("[story/generate-media] save to post", saved.error)
      return NextResponse.json(
        { error: "save_failed", message: "הסטורי נוצר אבל השמירה בפוסט נכשלה. נסו ליצור אותו שוב." },
        { status: 500 },
      )
    }
    // A new story starts a new AI conversation (lib/edit-agent).
    await resetAgentChat(supabase as never, user.id, postId, "story").catch(() => undefined)
    const urls = await storedImageUrls(supabase, postId, "story")
    return NextResponse.json(
      urls.length === total ? { images: urls, frameCount: total, saved: true } : { images, frameCount: total },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[story/generate-media]", msg)
    return NextResponse.json(
      { error: `יצירת הסטורי נכשלה: ${msg}` },
      { status: 500 },
    )
  }
}
