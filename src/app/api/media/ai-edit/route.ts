import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import Anthropic from "@anthropic-ai/sdk"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { editImage, type ImageShape } from "@/lib/openai-image"
import { loadImageForModels } from "@/lib/visual-language/image-input"
import { replaceImageAssetSet } from "@/lib/media-asset-set"
import { learnFromInstruction } from "@/lib/style-memory"
import { applyFixedElements } from "@/lib/visual-language/fixed-elements"
import { resolveDesignDirection } from "@/lib/visual-language/direction"
import {
  carouselStillMatches,
  illustrationPrompt,
  loadCarousel,
  renderCarousel,
  reviseCarousel,
  saveCarousel,
  slideHash,
  uploadIllustration,
} from "@/lib/carousel-composition"
import { generateImage } from "@/lib/openai-image"

// Planning + up to 10 parallel image edits (30–120s each).
export const maxDuration = 300

/**
 * "עריכה עם AI" for the image formats — carousel, story, image post (Hani,
 * 2026-10-22, the same move as the b-roll's). Her instruction, in her words,
 * applied to the media that is already on the post:
 *
 *   1. Claude Opus reads the instruction against the set (N slides / frames)
 *      and decides which ones it touches ("שקופית 3", "בכל השקופיות", or by
 *      default all of them) and writes a precise English edit brief.
 *   2. gpt-image-2 edits each targeted image from the image itself — never a
 *      regeneration from scratch, so her design survives.
 *   3. The set is saved back in order (untouched slides keep their URLs).
 *
 * POST { postId, format, instruction } → { urls, edited: number[] }
 */

type EditableFormat = "carousel" | "story" | "image_post"

const SHAPE: Record<EditableFormat, ImageShape> = {
  carousel: "4:5",
  image_post: "4:5",
  story: "9:16",
}
const CANVAS: Record<EditableFormat, [number, number]> = {
  carousel: [1080, 1350],
  image_post: [1080, 1350],
  story: [1080, 1920],
}
const NOUN: Record<EditableFormat, string> = {
  carousel: "carousel slide",
  image_post: "single image post",
  story: "Instagram story frame",
}

function isEditableFormat(v: unknown): v is EditableFormat {
  return v === "carousel" || v === "story" || v === "image_post"
}

function toCanvas(base64: string, [w, h]: [number, number]): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image href="data:image/png;base64,${base64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}

/** Opus: which items, and the exact edit to make. */
async function plan(
  apiKey: string,
  format: EditableFormat,
  count: number,
  instruction: string,
): Promise<{ targets: number[]; edit: string }> {
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1500,
    system:
      "You turn a Hebrew-speaking creator's edit request for her designed social media images into an exact brief for an image-editing model. Reply with JSON only.",
    messages: [
      {
        role: "user",
        content: [
          `Format: ${NOUN[format]}${count > 1 ? `, a set of ${count} (numbered 1..${count} in order)` : ""}.`,
          `Her request (Hebrew): ${JSON.stringify(instruction)}`,
          "",
          'Return {"targets": [numbers] , "edit": "..."}.',
          `- targets: which items the request is about. If she names items (e.g. "שקופית 2", "הפריים האחרון", "הראשונה") use those; if it's about the look in general or doesn't say, all of 1..${count}.`,
          "- edit: one precise English instruction for an image-editing model describing ONLY the change she asked for (colours, sizes, positions, elements, mood…). If she asks to change wording, quote the new Hebrew text exactly. Do not invent changes she didn't ask for.",
        ].join("\n"),
      },
    ],
  })
  const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
    targets?: number[]
    edit?: string
  }
  const targets = (json.targets ?? [])
    .map((n) => Math.round(n))
    .filter((n) => n >= 1 && n <= count)
  return {
    targets: targets.length ? Array.from(new Set(targets)) : Array.from({ length: count }, (_, i) => i + 1),
    edit: (json.edit ?? "").trim() || instruction,
  }
}

function editPrompt(edit: string): string {
  return [
    "Edit this image. Apply ONLY the following change:",
    edit,
    "",
    "Keep everything else exactly as it is: the layout, every piece of Hebrew text (same words, same spelling, right-to-left), the fonts, colours, illustrations and any logo. Do not add new text. Nothing may touch or cross the image edge.",
  ].join("\n")
}

export async function POST(req: NextRequest) {
  try {
    const { postId, format, instruction } = (await req.json().catch(() => ({}))) as {
      postId?: string
      format?: unknown
      instruction?: string
    }
    const text = instruction?.trim()
    if (!postId || !text || !isEditableFormat(format)) {
      return NextResponse.json({ error: "postId, format and instruction are required" }, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
      .eq("format", format)
      .maybeSingle()
    const { data: assets } = variant
      ? await supabase
          .from("media_assets")
          .select("url")
          .eq("format_variant_id", (variant as { id: string }).id)
          .eq("asset_type", "image")
          .order("created_at", { ascending: true })
      : { data: [] }
    const urls = ((assets ?? []) as { url: string | null }[])
      .map((a) => a.url)
      .filter((u): u is string => !!u && /^https?:\/\//.test(u))
    if (urls.length === 0) {
      return NextResponse.json(
        { error: "no_media", message: "אין כאן תמונות שמורות לערוך. צרו או העלו מדיה ואז ערכו אותה." },
        { status: 400 },
      )
    }

    let openaiKey: string
    let anthropicKey: string
    try {
      ;[openaiKey, anthropicKey] = await Promise.all([
        getUserApiKey(supabase, "openai_api_key"),
        getUserApiKey(supabase, "anthropic_api_key"),
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const message =
        msg === "openai_not_connected"
          ? "כדי לערוך עם AI צריך לחבר מפתח OpenAI בהגדרות."
          : msg === "anthropic_not_connected"
            ? "כדי לערוך עם AI צריך לחבר מפתח Claude בהגדרות."
            : undefined
      if (message) return NextResponse.json({ error: msg, message }, { status: 400 })
      throw e
    }

    const learning = learnFromInstruction(supabase, user.id, anthropicKey, text, NOUN[format])

    // A carousel laid out in code is edited in its layout — exact and
    // obedient — and only the illustrations she asks about are redrawn. Only
    // while the post still holds exactly the slides that layout made; if she
    // changed any of them, the real images are edited instead.
    const stored = format === "carousel" ? await loadCarousel(supabase, user.id, postId) : null
    if (stored && (await carouselStillMatches(stored, urls))) {
      const revised = await reviseCarousel(anthropicKey, stored, text)
      const illustrations = [...stored.illustrations]
      const redraw = revised.illustrations
        .map((idea, i) => ({ idea: idea.trim(), i }))
        .filter((x) => x.idea)
      await Promise.all(
        redraw.map(async ({ idea, i }) => {
          const raw = await generateImage(openaiKey, illustrationPrompt(idea, stored.brief.slides[i], stored.brief.styleLines), {
            shape: "1:1",
            quality: "medium",
          })
          illustrations[i] = await uploadIllustration(supabase, user.id, Buffer.from(raw, "base64"))
        }),
      )
      const direction = await resolveDesignDirection(supabase, user.id, { format: "carousel" })
      const shots = await renderCarousel(revised.html, illustrations, stored.brief.fonts)
      const nextSet = await Promise.all(
        shots.map((shot, i) =>
          applyFixedElements(
            shot.toString("base64"),
            direction.fixed,
            stored.brief.slides[i].type === "cover" ? "cover" : stored.brief.slides[i].type === "cta" ? "closing" : "content",
          ),
        ),
      )
      const saved = await replaceImageAssetSet(supabase, user.id, postId, format, nextSet)
      if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 })
      await saveCarousel(supabase, user.id, postId, {
        html: revised.html,
        brief: stored.brief,
        illustrations,
        edits: [...stored.edits, text],
        slideHashes: nextSet.map((b64) => slideHash(Buffer.from(b64, "base64"))),
      })
      const { data: after } = await supabase
        .from("media_assets")
        .select("url")
        .eq("format_variant_id", (variant as unknown as { id: string }).id)
        .eq("asset_type", "image")
        .order("created_at", { ascending: true })
      return NextResponse.json({
        urls: ((after ?? []) as { url: string }[]).map((a) => a.url),
        edited: shots.map((_, i) => i + 1),
        remembered: await learning,
      })
    }
    const { targets, edit } = await plan(anthropicKey, format, urls.length, text)
    const prompt = editPrompt(edit)

    const next = [...urls]
    await Promise.all(
      targets.map(async (n) => {
        const source = await loadImageForModels(urls[n - 1])
        const out = await editImage(openaiKey, prompt, source, SHAPE[format])
        next[n - 1] = toCanvas(out, CANVAS[format])
      }),
    )

    const saved = await replaceImageAssetSet(supabase, user.id, postId, format, next)
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 })

    // Read back the stored URLs in order — the edited ones are new files.
    const { data: after } = await supabase
      .from("media_assets")
      .select("url")
      .eq("format_variant_id", (variant as unknown as { id: string }).id)
      .eq("asset_type", "image")
      .order("created_at", { ascending: true })
    return NextResponse.json({
      urls: ((after ?? []) as { url: string }[]).map((a) => a.url),
      edited: targets,
      remembered: await learning,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[media/ai-edit]", msg)
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
    return NextResponse.json({ error: msg, message: "העריכה לא הצליחה הפעם. נסו שוב." }, { status: 500 })
  }
}
