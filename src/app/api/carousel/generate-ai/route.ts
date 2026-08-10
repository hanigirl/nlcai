import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getTemplate } from "@/lib/carousel-templates"
import type { SlideData } from "@/lib/carousel-templates"
import { getAuthUser } from "@/lib/auth-user"

// gpt-image-2 takes 30-120s per image; several slides run with limited
// concurrency, so leave generous headroom.
export const maxDuration = 300

const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 1350

// Each slide is one gpt-image-2 call on the user's key — cap so a runaway
// slide count can't burn through their credit in one click.
const MAX_AI_SLIDES = 10

// Parallel OpenAI image calls per carousel (rate-limit friendly).
const CONCURRENCY = 3

/**
 * AI carousel generation — gpt-image-2 (BYOK — users.openai_api_key)
 * renders each slide as a COMPLETE designed image including the Hebrew
 * text, following the template's locked `aiStyleSpec` so all slides read
 * as one series. Same model + crop approach as image-post/generate-media.
 *
 * The route is pure: returns base64 PNGs in the same `{ images }` shape as
 * /api/carousel/generate, so preview / ZIP / persistence reuse one path.
 */

/**
 * The shared AI-carousel design language — reverse-engineered from
 * ChatGPT-designed carousels Hani approved (see the carousel-design
 * skill): real conceptual imagery + strong typography, one system.
 * Templates contribute only palette/contrast via `styleSpec`.
 */
function buildSlidePrompt(
  styleSpec: string,
  slide: SlideData,
  index: number,
  total: number,
  topic: string,
  niche: string | null,
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
    "Design language (IDENTICAL across every slide of this series):",
    "- One conceptual 3D-rendered translucent glass visual that makes THIS slide's message physical — a real object or scene embodying the idea (e.g. fanned phone screens for designing screens, building bricks for building blocks, flowing waves for an abstract statement). It frames or surrounds the text; imagery and text share the composition without crowding each other.",
    ...(niche
      ? [
          `- The creator's niche is: """${niche}""". Draw the visual's objects and metaphors from this niche's world, combined with what THIS slide says — the imagery should instantly feel like it belongs to this niche (its tools, environments, symbols and vibe), never generic stock decoration.`,
        ]
      : []),
    "- Canvas: rich and atmospheric with a subtle vignette and soft gradient lighting — premium, never flat, never busy.",
    "- Typography: bold, modern Hebrew type with a clear hierarchy INSIDE the text — the single most important word or phrase of this slide is set in the accent gradient and one size step up; the rest stays clean and highly readable.",
    "- Texture: soft flowing gradient lines, gentle glow edges or light streaks as background accents.",
    `- A small circular badge with the number ${index + 1} in a bottom corner.`,
    "",
    styleSpec,
    "",
    "Keep all text within the central 70% of the height (generous top/bottom margins). No watermarks, logos, borders, or extra words.",
  ].join("\n")
}

async function generateImage(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // gpt-image-2 — ~99% character-level text accuracy across scripts;
      // legible Hebrew glyphs are the whole point, so we pay for "high"
      // (same reasoning as image-post/generate-media).
      model: "gpt-image-2",
      prompt,
      size: "1024x1536", // closest documented portrait; center-cropped to 4:5
      quality: "high",
      n: 1,
    }),
  })

  const json = (await res.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string }>
    error?: { message?: string }
  } | null

  if (!res.ok || !json?.data?.[0]?.b64_json) {
    const detail = json?.error?.message || `OpenAI החזיר ${res.status}`
    // Billing/quota failures get actionable Hebrew instead of raw API text.
    if (/billing|quota|insufficient/i.test(detail)) {
      throw new Error(
        "מפתח ה-OpenAI שלכם הגיע לתקרת החיוב. היכנסו ל-platform.openai.com → Billing כדי להוסיף קרדיט או להעלות את התקרה, ונסו שוב.",
      )
    }
    throw new Error(detail)
  }
  return json.data[0].b64_json
}

/** Center-crop 1024×1536 → exact 1080×1350, same as image-post. */
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

    const template = templateId ? getTemplate(templateId) : undefined
    if (!template || template.kind !== "ai" || !template.aiStyleSpec) {
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

    const styleSpec = template.aiStyleSpec
    const total = slides.length
    const images: string[] = new Array(total)

    // The carousel's topic anchors every slide's imagery to the content;
    // the creator's niche anchors it to their WORLD (health niche → health
    // objects/environments/vibe). Both feed every slide prompt.
    const topic = slides[0]?.title ?? ""
    const { data: identityRow } = await supabase
      .from("core_identities")
      .select("niche")
      .eq("user_id", user.id)
      .single()
    const niche =
      ((identityRow as { niche?: string | null } | null)?.niche ?? "").trim() ||
      null

    // Simple concurrency pool — kinder to OpenAI rate limits than firing
    // all slides at once, much faster than fully sequential.
    let next = 0
    async function worker() {
      while (next < total) {
        const i = next++
        const prompt = buildSlidePrompt(
          styleSpec,
          slides![i],
          i,
          total,
          topic,
          niche,
        )
        const raw = await generateImage(openaiKey, prompt)
        images[i] = cropToCanvas(raw)
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
