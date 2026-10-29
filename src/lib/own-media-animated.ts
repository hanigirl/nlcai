import type { SupabaseClient } from "@supabase/supabase-js"
import { BACKGROUND_FRAMINGS, buildBackgroundPrompt, cropToCanvas } from "@/lib/broll-animation/background"
import { buildCompositionBrief } from "@/lib/broll-animation/brief"
import { composeBRoll, finalizeHtml, reviseBRoll, type CompositionBrief } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import type { StoredComposition } from "@/lib/broll-animation/store"
import { generateImage } from "@/lib/openai-image"
import { resolveDesignDirection } from "@/lib/visual-language/direction"
import { fixedElementsLayer, reservedZoneLines, type ImageRole } from "@/lib/visual-language/fixed-elements"

/**
 * A NEW story frame with animated Hebrew text, added to a story she filmed
 * herself (Hani, 2026-10-29: "הוא הרי עושה את זה בבירול, אז למה לא?").
 *
 * The b-roll engine, unchanged: a text-free background in her visual
 * language (gpt-image-2) + Opus writing the motion design in her fonts and
 * colours (lib/broll-animation/compose) → a 7s 1080×1920 MP4 rendered frame
 * by frame (lib/broll-animation/render). Her own frames are never sent to
 * either model — this is a frame of its own, appended to the set.
 *
 * Her fixed brand elements (logo, badge) sit on top of the motion as a still
 * layer, at the same spot as on every other slide; the animation is told to
 * keep clear of them.
 *
 * Stored side by side, like a b-roll, but under story/ so the set knows the
 * AI made it (lib/own-media isOwnMediaUrl):
 *   <user>/story/ai-anim-<stamp>.mp4        the frame
 *   <user>/story/ai-anim-<stamp>.json       the composition (for a later edit)
 *   <user>/story/ai-anim-<stamp>-bg.png     the background
 *   <user>/story/ai-anim-<stamp>-brand.png  the still brand layer, if any
 *
 * Her design wording (`design`, Hani 2026-10-29: "תוריד את הרקע הבומבסטי
 * הלבן, ופשוט תכתוב בלבן") goes to both models as a hard instruction over the
 * visual-language defaults, and stays in the stored brief so later edits keep
 * it. editAnimatedStoryFrame changes a frame made here in place, from its
 * stored composition — it is AI-made, so it may be changed freely.
 */

type StoredFrame = StoredComposition & { brandLayerUrl: string | null }

const BUCKET = "user-media"
const W = 1080
const H = 1920

export async function makeAnimatedStoryFrame(
  supabase: SupabaseClient,
  userId: string,
  input: {
    anthropicKey: string
    openaiKey: string
    headline?: string
    body?: string
    role: ImageRole
    post: { title: string | null; hook: string | null; body: string | null }
    /** Her own words about the look — a hard instruction (lib/broll-animation/compose). */
    design?: string
  },
): Promise<string> {
  const hook = input.headline?.trim() || input.body?.trim() || input.post.hook?.trim() || input.post.title?.trim()
  if (!hook) throw new Error("no_text")
  const rest = input.headline?.trim() && input.body?.trim() ? input.body.trim() : undefined

  // The b-roll's look: the background never gets reference images (a logo it
  // copies would fight the type). The fixed elements come from the story's
  // own direction and are pasted, not drawn.
  const [bgDirection, storyDirection] = await Promise.all([
    resolveDesignDirection(supabase, userId, { format: "story", allowReferences: false }),
    resolveDesignDirection(supabase, userId, { format: "story" }),
  ])
  const reserved = reservedZoneLines(storyDirection.fixed, input.role, W, H)

  const base = await buildCompositionBrief(
    supabase,
    userId,
    { hook, rest },
    bgDirection.lines,
    undefined,
  )
  const brief: CompositionBrief = {
    ...base,
    // A story frame, not a reel: no "קראו בתיאור" — there is no description.
    cta: null,
    design: input.design?.trim() || undefined,
    notes: [
      "- This is NOT a reel b-roll. It is ONE FRAME of an Instagram STORY, added after frames the creator filmed or photographed herself — it must feel like part of her brand, not a template.",
      input.role === "closing"
        ? "- It is the closing frame: the text lands the message / call to action, warm and decisive."
        : input.role === "cover"
          ? "- It opens the story: the headline dominates and pulls the viewer in."
          : "- It carries the story's message forward.",
      "- STORY SAFE ZONE (stricter than the reel one): keep ALL text between 270px from the top and 460px from the bottom.",
      ...(reserved.length
        ? [
            "- Her real brand elements are laid ON TOP of the finished video afterwards, still, at fixed spots. Keep every piece of text and every moving shape out of these areas at every moment (the background may continue under them):",
            ...reserved.slice(1).map((l) => `  ${l}`),
          ]
        : []),
    ],
  }

  const [background, template] = await Promise.all([
    makeBackground(input.openaiKey, bgDirection, reserved, input.post, brief.design),
    composeBRoll(input.anthropicKey, brief, 0),
  ])

  const stamp = crypto.randomUUID()
  const prefix = `${userId}/story/ai-anim-${stamp}`
  const upload = uploader(supabase)
  const backgroundUrl = await upload(`${prefix}-bg.png`, Buffer.from(background, "base64"), "image/png")
  const layer = await fixedElementsLayer(background, storyDirection.fixed, input.role)
  const layerUrl = layer ? await upload(`${prefix}-brand.png`, layer, "image/png") : null

  return renderAndStore(supabase, prefix, { template, brief, backgroundUrl, edits: [], brandLayerUrl: layerUrl })
}

/**
 * Her instruction applied to an animated frame made here, in place: Opus
 * revises the stored composition (like the b-roll's "עריכה עם AI"), with her
 * new words and design wording in the brief; a fresh background only when
 * she asks for a different picture. Returns the new clip's URL.
 *
 * A frame made before compositions were kept has nothing to revise, so it is
 * made again with her design wording — `remade: true` says so.
 */
export async function editAnimatedStoryFrame(
  supabase: SupabaseClient,
  userId: string,
  input: {
    anthropicKey: string
    /** Needed only for a new background or a re-make. */
    openaiKey: () => Promise<string>
    url: string
    instruction: string
    design?: string
    headline?: string
    body?: string
    newBackground?: boolean
    role: ImageRole
    post: { title: string | null; hook: string | null; body: string | null }
  },
): Promise<{ url: string; remade: boolean }> {
  const design = input.design?.trim() || input.instruction.trim()
  const stored = await loadAnimatedFrame(supabase, userId, input.url)
  if (!stored) {
    const url = await makeAnimatedStoryFrame(supabase, userId, {
      anthropicKey: input.anthropicKey,
      openaiKey: await input.openaiKey(),
      headline: input.headline,
      body: input.body,
      role: input.role,
      post: input.post,
      design,
    })
    return { url, remade: true }
  }

  const headline = input.headline?.trim()
  const brief: CompositionBrief = {
    ...stored.brief,
    // New words replace both lines; no new words keep the frame's own.
    ...(headline ? { hook: headline, rest: input.body?.trim() || undefined } : {}),
    design: [stored.brief.design, design].filter(Boolean).join("\n"),
  }

  const stamp = crypto.randomUUID()
  const prefix = `${userId}/story/ai-anim-${stamp}`
  let { backgroundUrl, brandLayerUrl } = stored
  const reviseInstruction = headline
    ? `${input.instruction}\n(The frame's text is now: ${JSON.stringify([brief.hook, brief.rest].filter(Boolean).join(" / "))} — use exactly these words.)`
    : input.instruction

  if (input.newBackground) {
    const [bgDirection, storyDirection] = await Promise.all([
      resolveDesignDirection(supabase, userId, { format: "story", allowReferences: false }),
      resolveDesignDirection(supabase, userId, { format: "story" }),
    ])
    const reserved = reservedZoneLines(storyDirection.fixed, input.role, W, H)
    const [background, template] = await Promise.all([
      input.openaiKey().then((key) => makeBackground(key, bgDirection, reserved, input.post, brief.design)),
      reviseBRoll(input.anthropicKey, brief, stored.template, reviseInstruction),
    ])
    const upload = uploader(supabase)
    backgroundUrl = await upload(`${prefix}-bg.png`, Buffer.from(background, "base64"), "image/png")
    const layer = await fixedElementsLayer(background, storyDirection.fixed, input.role)
    brandLayerUrl = layer ? await upload(`${prefix}-brand.png`, layer, "image/png") : null
    const url = await renderAndStore(supabase, prefix, {
      template,
      brief,
      backgroundUrl,
      edits: [...stored.edits, input.instruction],
      brandLayerUrl,
    })
    return { url, remade: false }
  }

  const template = await reviseBRoll(input.anthropicKey, brief, stored.template, reviseInstruction)
  const url = await renderAndStore(supabase, prefix, {
    template,
    brief,
    backgroundUrl,
    edits: [...stored.edits, input.instruction],
    brandLayerUrl,
  })
  return { url, remade: false }
}

/** True for a clip this module made (and only for this user's). */
export function isAnimatedFrameUrl(url: string, userId: string): boolean {
  const m = /\/user-media\/(.+)\/story\/ai-anim-[0-9a-f-]{36}\.mp4(?:\?.*)?$/i.exec(url)
  return !!m && m[1] === userId
}

/** The composition stored next to an animated frame, or null (older frames, or not one of ours). */
export async function loadAnimatedFrame(
  supabase: SupabaseClient,
  userId: string,
  url: string,
): Promise<StoredFrame | null> {
  if (!isAnimatedFrameUrl(url, userId)) return null
  const m = /\/user-media\/(.+\/story\/ai-anim-[0-9a-f-]{36})\.mp4/i.exec(url)
  if (!m) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(`${m[1]}.json`)
  if (error || !data) return null
  try {
    const parsed = JSON.parse(await data.text()) as StoredFrame
    return parsed?.template && parsed.brief && parsed.backgroundUrl
      ? { ...parsed, edits: parsed.edits ?? [], brandLayerUrl: parsed.brandLayerUrl ?? null }
      : null
  } catch {
    return null
  }
}

async function makeBackground(
  openaiKey: string,
  direction: Awaited<ReturnType<typeof resolveDesignDirection>>,
  reserved: string[],
  post: { title: string | null; hook: string | null; body: string | null },
  design: string | undefined,
): Promise<string> {
  const context = [post.title, post.hook, post.body?.slice(0, 500)].filter(Boolean).join("\n")
  const framing = BACKGROUND_FRAMINGS[Math.floor(Math.random() * BACKGROUND_FRAMINGS.length)]
  const raw = await generateImage(
    openaiKey,
    buildBackgroundPrompt(direction, framing, context, reserved.length ? ["- " + reserved[0], ...reserved.slice(1)] : [], design),
    { shape: "9:16" },
  )
  return cropToCanvas(raw)
}

function uploader(supabase: SupabaseClient) {
  return async (path: string, data: Buffer | string, contentType: string) => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, data, { contentType })
    if (error) throw new Error(error.message)
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  }
}

/** Render the composition to <prefix>.mp4 and keep the composition beside it. */
async function renderAndStore(supabase: SupabaseClient, prefix: string, composition: StoredFrame): Promise<string> {
  const upload = uploader(supabase)
  const stamp = prefix.slice(prefix.lastIndexOf("-anim-") + 6)
  const { template, brief, backgroundUrl, brandLayerUrl: layerUrl } = composition
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const outPath = path.join(os.tmpdir(), `story-anim-${stamp}.mp4`)
  try {
    await renderComposition(withBrandLayer(finalizeHtml(template, backgroundUrl, brief.fonts), layerUrl), outPath)
    const clip = await fs.readFile(outPath)
    const url = await upload(`${prefix}.mp4`, clip, "video/mp4")
    // Best effort: the frame is already made; losing the recipe only costs a later edit.
    await supabase.storage
      .from(BUCKET)
      .upload(`${prefix}.json`, JSON.stringify(composition), { contentType: "application/json" })
      .catch(() => undefined)
    return url
  } finally {
    await fs.unlink(outPath).catch(() => undefined)
  }
}

/** Her brand elements over everything, not animated. */
export function withBrandLayer(html: string, layerUrl: string | null): string {
  if (!layerUrl) return html
  const img = `<img src=${JSON.stringify(layerUrl)} alt="" style="position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:2147483647;pointer-events:none;animation:none;transition:none">`
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : `${html}${img}`
}
