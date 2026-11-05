import { BLANK_NEEDS_BRIEF, PLACE_FAILED_GEN, normalizeMediaBrief, withMediaBrief, withMediaReferences } from "@/lib/media-brief"
import { parseReferences, referenceBuffer } from "@/lib/ai-edit-references"
import sharp from "sharp"
import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { BLANK_TEMPLATE_ID, BRAND_TEMPLATE_ID, getTemplate } from "@/lib/carousel-templates"
import type { SlideData } from "@/lib/carousel-templates"
import { getAuthUser } from "@/lib/auth-user"
import { replaceImageAssetSet } from "@/lib/media-asset-set"
import { assertFeedSafeAspect } from "@/lib/social/media-spec"
import { generateImage, KEEP_INSIDE_FRAME_RULE } from "@/lib/openai-image"
import {
  applyFixedElements,
  reservedZoneLines,
  type ImageRole,
} from "@/lib/visual-language/fixed-elements"
import { buildCarouselBrief } from "@/lib/carousel-brief"
import {
  composeCarousel,
  illustrationPrompt,
  renderCarousel,
  saveCarousel,
  slideHash,
  uploadIllustration,
} from "@/lib/carousel-composition"
import {
  noExtrasRule,
  resolveDesignDirection,
  type DesignDirection,
} from "@/lib/visual-language/direction"

// gpt-image-2 takes 30-120s per image; several slides run with limited
// concurrency, so leave generous headroom.
export const maxDuration = 300

// A carousel is a feed post: Instagram accepts 4:5 to 1.91:1, so 4:5 is the
// tallest shape allowed here. Asserted below rather than trusted, so this pair
// can never drift to 9:16 without the generator saying so.
const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 1350
assertFeedSafeAspect(IMAGE_WIDTH, IMAGE_HEIGHT, "קרוסלת AI")

// Each slide is one gpt-image-2 call on the user's key — cap so a runaway
// slide count can't burn through their credit in one click.
const MAX_AI_SLIDES = 10

// Parallel OpenAI image calls per carousel (rate-limit friendly).
const CONCURRENCY = 3
// Illustrations are smaller, text-free and medium quality — more at once.
const ART_CONCURRENCY = 5

/**
 * AI carousel generation — gpt-image-2 (BYOK — users.openai_api_key)
 * renders each slide as a COMPLETE designed image including the Hebrew
 * text, all slides in one design direction so they read as one series:
 * her visual language, or her niche's language in dark / light.
 *
 * The route is pure: returns base64 PNGs in the same `{ images }` shape as
 * /api/carousel/generate, so preview / ZIP / persistence reuse one path.
 */

function buildSlidePrompt(
  slide: SlideData,
  index: number,
  total: number,
  topic: string,
  direction: DesignDirection,
): string {
  const role =
    slide.type === "cover"
      ? "This is the cover — the headline dominates and the visual is at its most striking."
      : slide.type === "cta"
        ? "This is the closing call-to-action slide — warm, inviting, decisive."
        : `This is content slide ${index + 1} of ${total}.`

  const textLines = [
    `Title: "${slide.title}"`,
    slide.body ? `Body: "${slide.body}"` : null,
  ]
    .filter(Boolean)
    .join("\n")

  return [
    `Design one slide of a premium vertical Instagram carousel in HEBREW, about: """${topic}"""`,
    "",
    "The slide contains exactly this Hebrew text, spelled EXACTLY as written, right-to-left, and no other words:",
    textLines,
    "",
    role,
    "",
    "Design (IDENTICAL across every slide of this series):",
    ...direction.lines,
    "- The imagery makes THIS slide's message visible — drawn from the topic and rendered in the visual language above, never generic stock decoration.",
    "- Typography: Hebrew type with a clear hierarchy INSIDE the text — the single most important word or phrase is emphasised the way the visual language describes; the rest stays clean and highly readable.",
    `- A small circular badge with the number ${index + 1} in a bottom corner, styled in the visual language.`,
    "",
    ...reservedZoneLines(direction.fixed, slideRole(slide), IMAGE_WIDTH, IMAGE_HEIGHT),
    "",
    KEEP_INSIDE_FRAME_RULE,
    `${noExtrasRule(direction)} No extra words.`,
  ].join("\n")
}

function slideRole(slide: SlideData): ImageRole {
  return slide.type === "cover" ? "cover" : slide.type === "cta" ? "closing" : "content"
}

/** Scale the 4:5 render to exactly 1080×1350 (trims only on the 1024×1536 fallback). */
function cropToCanvas(imageBase64: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}

export async function POST(req: NextRequest) {
  try {
    const { slides, templateId, postId, brief: mediaBrief, references, place } = (await req.json().catch(() => ({}))) as {
      slides?: SlideData[]
      templateId?: string
      /** Her own direction for this carousel (lib/media-brief). */
      brief?: unknown
      /** Look references (a picture pulled from a link) — lib/ai-edit-references. */
      references?: unknown
      /** Pictures she attached to put INTO the carousel as they are (lib/carousel-composition). */
      place?: unknown
      /** Lets "עריכה עם AI" find this carousel's layout later. */
      postId?: string
    }

    if (!slides || !Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json(
        { error: "slides array is required" },
        { status: 400 },
      )
    }
    if (slides.length > MAX_AI_SLIDES) {
      return NextResponse.json(
        {
          error: "too_many_slides",
          message: `אפשר לייצר עד ${MAX_AI_SLIDES} שקופיות בטמפלט AI (יש ${slides.length}). קצרו את הטקסט ונסו שוב.`,
        },
        { status: 400 },
      )
    }

    const isBrandTemplate = templateId === BRAND_TEMPLATE_ID
    // "חדש לגמרי": designed from her brief alone — none of her brand.
    const isBlankTemplate = templateId === BLANK_TEMPLATE_ID
    if (isBlankTemplate && !normalizeMediaBrief(mediaBrief)) {
      return NextResponse.json(BLANK_NEEDS_BRIEF, { status: 400 })
    }
    const template = templateId && !isBrandTemplate && !isBlankTemplate ? getTemplate(templateId) : undefined
    if (!isBrandTemplate && !isBlankTemplate && (!template || template.kind !== "ai" || !template.aiStyleSpec)) {
      return NextResponse.json(
        { error: `Template "${templateId}" is not an AI template` },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
              "כדי לייצר קרוסלת AI צריך לחבר מפתח OpenAI בהגדרות ← חיבורים ← OpenAI.",
          },
          { status: 402 },
        )
      }
      throw err
    }

    const total = slides.length
    const images: string[] = new Array(total)

    /**
     * Saved to the post HERE, and the stored URLs sent back. Slides in her
     * current language (fine film grain) weigh 1–1.6MB each; six of them as
     * base64 are ~8MB, past the 4.5MB a request may carry on our host — so
     * the page's save of a fresh set never arrived, the card showed slides
     * the post didn't have, and the AI edit then found "no saved images"
     * (Hani, 2026-11-05). Generating is choosing, so the set is the post's.
     */
    async function respond(set: string[]) {
      if (!postId) return NextResponse.json({ images: set })
      const { data: post } = await supabase
        .from("core_posts")
        .select("id")
        .eq("id", postId)
        .eq("user_id", user!.id)
        .maybeSingle()
      if (!post) return NextResponse.json({ images: set })
      const saved = await replaceImageAssetSet(supabase, user!.id, postId, "carousel", set, {
        source: "ai",
        ...(templateId ? { templateId } : {}),
      })
      if (!saved.ok) {
        console.error("[carousel/generate-ai] save to post", saved.error)
        return NextResponse.json(
          { error: "save_failed", message: "הקרוסלה נוצרה אבל לא נשמרה בפוסט. נסו ליצור שוב." },
          { status: 500 },
        )
      }
      const { data: variant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", postId)
        .eq("format", "carousel")
        .maybeSingle()
      const { data: rows } = variant
        ? await supabase
            .from("media_assets")
            .select("url")
            .eq("format_variant_id", (variant as { id: string }).id)
            .eq("asset_type", "image")
            .order("created_at", { ascending: true })
        : { data: [] }
      const urls = ((rows ?? []) as { url: string | null }[]).map((r) => r.url).filter((u): u is string => !!u)
      return NextResponse.json({ images: urls.length === set.length ? urls : set, saved: urls.length === set.length })
    }

    // The carousel's topic anchors every slide's imagery to the content.
    const topic = slides[0]?.title ?? ""

    // "השפה הוויזואלית שלך" designs from her analysed language. "כהה" /
    // "בהיר" are her NICHE's language on a dark / light canvas — never the
    // old glass-3D neon look (Hani, 2026-10-07).
    let direction: DesignDirection
    if (isBlankTemplate) {
      direction = await resolveDesignDirection(supabase, user.id, { format: "carousel", style: "blank" })
    } else if (isBrandTemplate) {
      direction = await resolveDesignDirection(supabase, user.id, { format: "carousel" })
      if (direction.source !== "brand") {
        return NextResponse.json(
          {
            error: "no_visual_language",
            message: "עדיין אין שפה ויזואלית מנותחת. הגדירו אותה בהגדרות ← מדיה ← שפה ויזואלית, או בחרו טמפלט אחר.",
          },
          { status: 400 },
        )
      }
    } else {
      direction = await resolveDesignDirection(supabase, user.id, {
        format: "carousel",
        style: templateId === "ai-light" ? "ai-light" : templateId === "ai-dark" ? "ai-dark" : "niche",
      })
    }

    // Her own direction for this carousel wins over the language where they
    // conflict — and is kept in the saved brief, so later AI edits honour it.
    direction = withMediaBrief(direction, normalizeMediaBrief(mediaBrief))
    // Her references: the layout step gets them as referenceBlocks, the image
    // model as reference images. The saved brief keeps the plain lines, so
    // later edits aren't told about images they don't have.
    const refs = parseReferences(references)
    const refDirection = withMediaReferences(direction, refs)
    // Her own pictures (Hani, 2026-11-05): placed as her exact files by the
    // layout engine — the only path that can. Without it, say so plainly.
    const placeRefs = parseReferences(place)
    const refImages = refDirection.references.slice(direction.references.length)

    // Laid out in code when she has a Claude key (lib/carousel-composition):
    // one stylesheet, her fonts, one type scale, identical grid and number on
    // every slide — the model only draws illustrations. Without a Claude key
    // the slides are drawn whole by the image model, as before.
    const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => null)
    if (placeRefs.length && !anthropicKey) {
      return NextResponse.json(
        { error: "place_needs_claude", message: "כדי להכניס את התמונה שלכם לקרוסלה צריך לחבר מפתח Claude בהגדרות. לא יצרתי כלום ולא שמתי תמונה אחרת במקומה." },
        { status: 400 },
      )
    }
    // If the new engine fails early (e.g. the headless browser can't start on
    // this server), the slides are drawn the old way instead of failing her.
    if (anthropicKey) {
      const started = Date.now()
      try {
        // Built the same way on every AI edit, from her settings at that time.
        const brief = await buildCarouselBrief(supabase, user.id, {
          slides: slides!,
          style: isBlankTemplate
            ? "blank"
            : isBrandTemplate
              ? "brand"
              : templateId === "ai-light"
                ? "ai-light"
                : templateId === "ai-dark"
                  ? "ai-dark"
                  : "niche",
          direction,
        })
        const fonts = brief.fonts

        // Layout first: Opus decides which slides get an illustration at all
        // (type-led examples → none), then only those are drawn.
        const layout = await composeCarousel(anthropicKey, brief, refs, placeRefs)
        const illustrations: string[] = new Array(total).fill("")
        const ownArt: boolean[] = new Array(total).fill(false)
        // Her pictures: each must have landed on a slide, as her exact file.
        const placedOn = placeRefs.length
          ? layout.attached.map((n, i) => ({ n, i })).filter((x) => x.n >= 1 && x.n <= placeRefs.length)
          : []
        if (placeRefs.length) {
          const covered = new Set(placedOn.map((x) => x.n))
          if (placeRefs.some((_, j) => !covered.has(j + 1))) {
            return NextResponse.json(PLACE_FAILED_GEN, { status: 422 })
          }
          await Promise.all(
            placedOn.map(async ({ n, i }) => {
              const file = referenceBuffer(placeRefs[n - 1])
              const png = await sharp(file)
                .rotate()
                .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
                .png()
                .toBuffer()
              illustrations[i] = await uploadIllustration(supabase, user!.id, png)
              ownArt[i] = true
            }),
          )
        }
        const isPlaced = (i: number) => placedOn.some((x) => x.i === i)
        const wanted = layout.illustrations
          .map((idea, i) => ({ idea: idea.trim(), i }))
          .filter((x) => x.idea && !isPlaced(x.i))
        let nextArt = 0
        async function artWorker() {
          while (nextArt < wanted.length) {
            const { idea, i } = wanted[nextArt++]
            const raw = await generateImage(openaiKey, illustrationPrompt(idea, slides![i], refDirection.lines), {
              shape: "1:1",
              quality: "medium",
              ...(refImages.length ? { references: refImages } : {}),
            })
            illustrations[i] = await uploadIllustration(supabase, user!.id, Buffer.from(raw, "base64"))
          }
        }
        await Promise.all(Array.from({ length: Math.min(ART_CONCURRENCY, wanted.length) }, () => artWorker()))
        const shots = await renderCarousel(layout.html, illustrations, fonts)
        for (let i = 0; i < total; i++) {
          const shot = shots[i]
          if (!shot) throw new Error("render_missing_slide")
          images[i] = await applyFixedElements(shot.toString("base64"), direction.fixed, slideRole(slides![i]))
        }
        if (postId) {
          await saveCarousel(supabase, user.id, postId, {
            html: layout.html,
            brief,
            illustrations,
            edits: [],
            ownArt,
            slideHashes: images.map((b64) => slideHash(Buffer.from(b64, "base64"))),
          }).catch((err) => console.error("[carousel/generate-ai] save composition", err))
        }
        return respond(images)
      } catch (err) {
        console.error("[carousel/generate-ai] layout engine failed", err)
        // The image-model fallback can't put her exact picture in: no stand-in.
        if (placeRefs.length) return NextResponse.json(PLACE_FAILED_GEN, { status: 422 })
        if (Date.now() - started > 90_000) throw err
        images.fill(undefined as unknown as string)
      }
    }

    // Simple concurrency pool — kinder to OpenAI rate limits than firing
    // all slides at once, much faster than fully sequential.
    let next = 0
    async function worker() {
      while (next < total) {
        const i = next++
        const prompt = buildSlidePrompt(slides![i], i, total, topic, refDirection)
        const raw = await generateImage(openaiKey, prompt, {
          shape: "4:5",
          // Legible Hebrew glyphs are the whole point, so we pay for "high".
          quality: "high",
          references: refDirection.references,
        })
        // Fixed brand elements go in by code — same pixels on every slide.
        images[i] = await applyFixedElements(cropToCanvas(raw), direction.fixed, slideRole(slides![i]))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    )

    return respond(images)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[carousel/generate-ai]", msg)
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
    return NextResponse.json(
      { error: `יצירת קרוסלת ה-AI נכשלה: ${msg}` },
      { status: 500 },
    )
  }
}
