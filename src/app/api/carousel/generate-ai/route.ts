import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { BRAND_TEMPLATE_ID, getTemplate } from "@/lib/carousel-templates"
import type { SlideData } from "@/lib/carousel-templates"
import { getAuthUser } from "@/lib/auth-user"
import { assertFeedSafeAspect } from "@/lib/social/media-spec"
import { generateImage, KEEP_INSIDE_FRAME_RULE } from "@/lib/openai-image"
import {
  applyFixedElements,
  reservedZoneLines,
  type ImageRole,
} from "@/lib/visual-language/fixed-elements"
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
    const { slides, templateId } = (await req.json().catch(() => ({}))) as {
      slides?: SlideData[]
      templateId?: string
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
    const template = templateId && !isBrandTemplate ? getTemplate(templateId) : undefined
    if (!isBrandTemplate && (!template || template.kind !== "ai" || !template.aiStyleSpec)) {
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

    // The carousel's topic anchors every slide's imagery to the content.
    const topic = slides[0]?.title ?? ""

    // "השפה הוויזואלית שלך" designs from her analysed language. "כהה" /
    // "בהיר" are her NICHE's language on a dark / light canvas — never the
    // old glass-3D neon look (Hani, 2026-10-07).
    let direction: DesignDirection
    if (isBrandTemplate) {
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

    // Simple concurrency pool — kinder to OpenAI rate limits than firing
    // all slides at once, much faster than fully sequential.
    let next = 0
    async function worker() {
      while (next < total) {
        const i = next++
        const prompt = buildSlidePrompt(slides![i], i, total, topic, direction)
        const raw = await generateImage(openaiKey, prompt, {
          shape: "4:5",
          // Legible Hebrew glyphs are the whole point, so we pay for "high".
          quality: "high",
          references: direction.references,
        })
        // Fixed brand elements go in by code — same pixels on every slide.
        images[i] = await applyFixedElements(cropToCanvas(raw), direction.fixed, slideRole(slides![i]))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    )

    return NextResponse.json({ images })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[carousel/generate-ai]", msg)
    return NextResponse.json(
      { error: `יצירת קרוסלת ה-AI נכשלה: ${msg}` },
      { status: 500 },
    )
  }
}
