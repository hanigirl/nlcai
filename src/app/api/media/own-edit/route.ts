import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { imageHasBakedText } from "@/lib/baked-text"
import { readCaptionRecord } from "@/lib/caption-record"
import { replaceImageAssetSet } from "@/lib/media-asset-set"
import { generateImage } from "@/lib/openai-image"
import { applyFixedElements, type ImageRole } from "@/lib/visual-language/fixed-elements"
import { resolveDesignDirection } from "@/lib/visual-language/direction"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { planOwnMediaEdit, slidePrompt } from "@/lib/own-media-plan"
import {
  isCaptionedRenderUrl,
  isOwnMediaUrl,
  isVideoMediaUrl,
  type CaptionRecord,
  type OwnEditFormat,
  type OwnFrameInfo,
} from "@/lib/own-media"

// One plan (Opus) + per-frame text checks; a new slide is one gpt-image-2 call.
export const maxDuration = 300

/**
 * "עריכת מדיה עם AI" on media she brought herself (Hani, 2026-10-29).
 *
 *   action "plan"  — read the format's media, find out per frame whether it is
 *                    hers, whether it already carries words and whether we
 *                    still have the original under our caption, then ask Opus
 *                    for a closed-set plan (lib/own-media-plan). No writes.
 *   action "slide" — one NEW slide/frame in her visual language (gpt-image-2),
 *                    stored, URL returned. Her own frames are never sent to it.
 *   action "save"  — the finished set, in order, becomes the format's media.
 *
 * The caption itself is drawn by the existing routes (story/generate-video-
 * media for video, media/caption-image for stills), called by the panel —
 * lib/own-media-edit runs the plan.
 */

type Body = {
  action?: "plan" | "slide" | "save"
  postId?: string
  format?: unknown
  instruction?: string
  currentFrame?: number
  /** Originals the browser still remembers for older renders (format meta). */
  knownOriginals?: Record<string, string>
  history?: { role: "user" | "assistant"; content: string }[]
  headline?: string
  body?: string
  role?: ImageRole
  urls?: string[]
  driveLinks?: string[] | null
}

function isFormat(v: unknown): v is OwnEditFormat {
  return v === "story" || v === "carousel" || v === "image_post" || v === "b_roll"
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json().catch(() => ({}))) as Body
    const { postId, format } = input
    if (!postId || !isFormat(format)) return json({ error: "postId and format are required" }, 400)

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return json({ error: "Unauthorized" }, 401)

    const { data: postRow } = await supabase
      .from("core_posts")
      .select("id, title, hook_text, body")
      .eq("id", postId)
      .eq("user_id", user.id)
      .maybeSingle()
    const post = postRow as { id: string; title: string | null; hook_text: string | null; body: string | null } | null
    if (!post) return json({ error: "Post not found" }, 404)

    const { data: variantRow } = await supabase
      .from("format_variants")
      .select("id, body, drive_slide_links")
      .eq("core_post_id", postId)
      .eq("format", format)
      .maybeSingle()
    const variant = variantRow as { id: string; body: string | null; drive_slide_links: string[] | null } | null

    /* -------------------------------- save -------------------------------- */
    if (input.action === "save") {
      const urls = (input.urls ?? []).filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
      if (!variant) return json({ error: "no_variant" }, 400)
      if (format === "story" || format === "carousel") {
        if (urls.length === 0) return json({ error: "empty_set", message: "לא נשארו פריימים. כדי למחוק הכל השתמשו במחיקה." }, 400)
        const saved = await replaceImageAssetSet(supabase, user.id, postId, format, urls)
        if (!saved.ok) return json({ error: saved.error }, 500)
        // A story clip can also sit in the video slot; the set now holds it.
        if (format === "story") {
          await supabase.from("media_assets").delete().eq("format_variant_id", variant.id).eq("asset_type", "video")
        }
        if (Array.isArray(input.driveLinks)) {
          await supabase
            .from("format_variants")
            .update({ drive_slide_links: input.driveLinks } as never)
            .eq("id", variant.id)
        }
        return json({ urls })
      }
      const url = urls[0]
      if (!url) return json({ error: "no_url" }, 400)
      const assetType = isVideoMediaUrl(url) ? "video" : "image"
      await supabase
        .from("media_assets")
        .delete()
        .eq("format_variant_id", variant.id)
        .in("asset_type", format === "b_roll" ? ["image", "video"] : ["image"])
      await supabase.from("media_assets").insert({
        format_variant_id: variant.id,
        asset_type: assetType,
        url,
        status: "completed",
      } as never)
      return json({ urls: [url] })
    }

    /* -------------------------------- slide ------------------------------- */
    if (input.action === "slide") {
      if (format !== "story" && format !== "carousel") return json({ error: "not_a_set" }, 400)
      let openaiKey: string
      try {
        openaiKey = await getUserApiKey(supabase, "openai_api_key")
      } catch {
        return json(
          { error: "openai_not_connected", message: "כדי להוסיף שקופית עם AI צריך לחבר מפתח OpenAI בהגדרות." },
          400,
        )
      }
      const [W, H] = format === "story" ? [1080, 1920] : [1080, 1350]
      const role: ImageRole = input.role === "cover" || input.role === "content" ? input.role : "closing"
      const direction = await resolveDesignDirection(supabase, user.id, { format })
      const context = [post.title, post.hook_text, post.body?.slice(0, 500)].filter(Boolean).join("\n")
      const raw = await generateImage(
        openaiKey,
        slidePrompt({
          format,
          headline: input.headline?.trim() || undefined,
          body: input.body?.trim() || undefined,
          role,
          direction,
          context,
          width: W,
          height: H,
        }),
        { shape: format === "story" ? "9:16" : "4:5", quality: "high", references: direction.references },
      )
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        `<image href="data:image/png;base64,${raw}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` +
        `</svg>`
      const fitted = Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
      const finished = await applyFixedElements(fitted, direction.fixed, role)
      // "ai-slide-" marks it as made here, so the next edit knows it isn't hers.
      const path = `${user.id}/${format}/ai-slide-${crypto.randomUUID()}.png`
      const { error: upErr } = await supabase.storage
        .from("user-media")
        .upload(path, Buffer.from(finished, "base64"), { contentType: "image/png" })
      if (upErr) return json({ error: upErr.message }, 500)
      return json({ url: supabase.storage.from("user-media").getPublicUrl(path).data.publicUrl })
    }

    /* -------------------------------- plan -------------------------------- */
    const instruction = input.instruction?.trim()
    if (!instruction) return json({ error: "instruction is required" }, 400)
    if (!variant) return json({ error: "no_media", message: "אין כאן מדיה לערוך." }, 400)

    const { data: assets } = await supabase
      .from("media_assets")
      .select("url, asset_type, metadata, created_at")
      .eq("format_variant_id", variant.id)
      .in("asset_type", ["image", "video"])
      .order("created_at", { ascending: true })
    const rows = ((assets ?? []) as { url: string | null; asset_type: string; metadata: Record<string, unknown> | null }[])
      .filter((a): a is { url: string; asset_type: string; metadata: Record<string, unknown> | null } => !!a.url)
    // Same order the card shows: the image rows (a story's frames), then a
    // clip in the video slot when it isn't already one of them.
    const images = rows.filter((r) => r.asset_type === "image").map((r) => r.url)
    const videos = rows.filter((r) => r.asset_type === "video").map((r) => r.url)
    let urls: string[]
    if (format === "story") urls = [...images, ...videos.filter((v) => !images.includes(v))]
    else if (format === "carousel") urls = images
    else if (format === "b_roll") urls = videos.length ? [videos[videos.length - 1]] : images.slice(-1)
    else urls = images.slice(-1)
    if (urls.length === 0) return json({ error: "no_media", message: "אין כאן מדיה לערוך." }, 400)

    let anthropicKey: string
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      return json(
        { error: "anthropic_not_connected", message: "כדי לערוך עם AI צריך לחבר מפתח Claude בהגדרות." },
        400,
      )
    }

    const carouselMeta = format === "carousel" ? (rows[0]?.metadata ?? {}) : {}
    const links = (variant.drive_slide_links ?? []).filter((l) => typeof l === "string")
    // One link per frame, in order ("" for a frame that has none, like an
    // added AI slide) — only then does link i belong to frame i.
    const linksAligned = links.length === urls.length && links.some(Boolean)

    const frames: OwnFrameInfo[] = await Promise.all(
      urls.map(async (url, i): Promise<OwnFrameInfo> => {
        const kind = isVideoMediaUrl(url) ? "video" : "image"
        const aiMade =
          /\/ai-slide-[0-9a-f-]+\.png/.test(url) ||
          (format === "carousel"
            ? carouselMeta.source === "ai" && !linksAligned
            : !isOwnMediaUrl(url))
        const driveLink = linksAligned ? links[i] || undefined : undefined
        let record: CaptionRecord | null = isCaptionedRenderUrl(url) || format === "carousel"
          ? await readCaptionRecord(supabase, url)
          : null
        if (!record && input.knownOriginals?.[url]) {
          record = { v: 1, sourceUrl: input.knownOriginals[url], caption: {} }
        }
        if (record) return { url, kind, aiMade, caption: "ours", record }
        if (aiMade) return { url, kind, aiMade, caption: "baked" }
        if (isCaptionedRenderUrl(url)) {
          // An older render: the original wasn't recorded. A Drive link that
          // lines up with it is the original, pulled again.
          return driveLink
            ? { url, kind, aiMade, caption: "ours", record: { v: 1, sourceUrl: driveLink, caption: {} } }
            : { url, kind, aiMade, caption: "ours-legacy" }
        }
        if (format === "carousel") {
          if (carouselMeta.bakedText === true) return { url, kind, aiMade, caption: "baked" }
          // Imported slides are captioned on arrival by default; with the
          // Drive link lined up the original can always be pulled again.
          if (driveLink && carouselMeta.bakedText === false) {
            return { url, kind, aiMade, caption: "ours", record: { v: 1, sourceUrl: driveLink, caption: {} } }
          }
          return { url, kind, aiMade, caption: "unknown" }
        }
        if (kind === "video") return { url, kind, aiMade, caption: "unknown" }
        // A bare picture of hers: does it already carry words? (Notion P2
        // "מדיה משלי: לזהות טקסט קיים") — one small Haiku look.
        const b64 = await fetchBase64(url)
        const has = b64 ? await imageHasBakedText(anthropicKey, b64) : null
        return { url, kind, aiMade, caption: has === true ? "baked" : has === false ? "none" : "unknown" }
      }),
    )

    const plan = await planOwnMediaEdit(anthropicKey, {
      format,
      instruction,
      frames,
      currentFrame: input.currentFrame,
      post: { title: post.title, hook: post.hook_text, body: post.body, formatBody: variant.body },
      history: input.history,
    })
    return json({ plan, frames, driveLinks: linksAligned ? links : null })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[media/own-edit]", msg)
    if (isInvalidClaudeKey(msg)) return json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, 400)
    return json({ error: msg, message: "העריכה לא הצליחה הפעם. נסו שוב." }, 500)
  }
}

async function fetchBase64(url: string): Promise<string | null> {
  try {
    const res = isDriveUrl(url) ? await fetchDriveFile(extractDriveFileId(url)!) : await fetch(url)
    if (!res.ok || (res.headers.get("content-type") || "").includes("text/html")) return null
    return Buffer.from(await res.arrayBuffer()).toString("base64")
  } catch {
    return null
  }
}
