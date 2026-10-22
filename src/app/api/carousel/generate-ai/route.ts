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
import { loadBrandFonts } from "@/lib/broll-animation/brief"
import {
  composeCarousel,
  illustrationPrompt,
  renderCarousel,
  saveCarousel,
  slideHash,
  uploadIllustration,
  type CarouselBrief,
} from "@/lib/carousel-composition"
import { userExampleKind, type VisualLanguage } from "@/lib/visual-language/types"
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

/**
 * Her carousel usage examples — the template the layout copies one-to-one.
 * The ones she filed under "קרוסלה" in Settings; else the ones the analysis
 * recognised as carousel slides; else all of them.
 */
async function carouselExamples(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  vl: VisualLanguage | null | undefined,
): Promise<string[]> {
  const { data } = await supabase
    .from("user_media")
    .select("id, storage_path, metadata")
    .eq("user_id", userId)
    .eq("category", "brand_example")
    .order("created_at", { ascending: true })
  const rows = (data ?? []) as { id: string; storage_path: string; metadata: Record<string, unknown> | null }[]
  const filed = rows.filter((r) => userExampleKind(r.metadata) === "carousel")
  const carouselIds = new Set((vl?.example_kinds ?? []).filter((k) => k.kind === "carousel").map((k) => k.id))
  const recognised = rows.filter((r) => carouselIds.has(r.id))
  const picked = filed.length ? filed : recognised.length ? recognised : rows
  return picked
    .filter((r) => /\.(png|jpe?g|webp|gif)$/i.test(r.storage_path))
    .slice(0, 6)
    .map((r) => supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl)
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
    const { slides, templateId, postId } = (await req.json().catch(() => ({}))) as {
      slides?: SlideData[]
      templateId?: string
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

    // Laid out in code when she has a Claude key (lib/carousel-composition):
    // one stylesheet, her fonts, one type scale, identical grid and number on
    // every slide — the model only draws illustrations. Without a Claude key
    // the slides are drawn whole by the image model, as before.
    const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key").catch(() => null)
    if (anthropicKey) {
      const [fonts, { data: userRow }] = await Promise.all([
        loadBrandFonts(supabase, user.id),
        supabase.from("users").select("brand_colors, visual_language").eq("id", user.id).single(),
      ])
      const row = userRow as { brand_colors?: string[] | null; visual_language?: VisualLanguage | null } | null
      const palette =
        isBrandTemplate && row?.visual_language?.palette?.length
          ? row.visual_language.palette
          : (row?.brand_colors ?? []).map((hex, i) => ({ hex, role: i === 0 ? "primary brand colour" : "brand colour" }))
      const brief: CarouselBrief = {
        slides: slides!,
        fonts,
        palette,
        styleLines: direction.lines,
        reservedLines: reservedZoneLines(direction.fixed, "content", IMAGE_WIDTH, IMAGE_HEIGHT),
        examples: isBrandTemplate ? await carouselExamples(supabase, user.id, row?.visual_language) : [],
        pastedElements: direction.fixed.map((el) => el.name),
      }

      // Layout first: Opus decides which slides get an illustration at all
      // (type-led examples → none), then only those are drawn.
      const layout = await composeCarousel(anthropicKey, brief)
      const illustrations: string[] = new Array(total).fill("")
      const wanted = layout.illustrations.map((idea, i) => ({ idea: idea.trim(), i })).filter((x) => x.idea)
      let nextArt = 0
      async function artWorker() {
        while (nextArt < wanted.length) {
          const { idea, i } = wanted[nextArt++]
          const raw = await generateImage(openaiKey, illustrationPrompt(idea, slides![i], direction.lines), {
            shape: "1:1",
            quality: "medium",
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
          slideHashes: images.map((b64) => slideHash(Buffer.from(b64, "base64"))),
        }).catch((err) => console.error("[carousel/generate-ai] save composition", err))
      }
      return NextResponse.json({ images })
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
