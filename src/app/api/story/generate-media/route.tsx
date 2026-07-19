import { NextRequest, NextResponse } from "next/server"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"

// gpt-image-2 takes 30-120s per image; a long story fans out to up to 3
// frames run with limited concurrency, so leave generous headroom.
export const maxDuration = 300

// Instagram Story — 9:16 vertical.
const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 1920

// Committed to ONE image by default. We only split when the story text is
// long enough that fitting it all on one frame would shrink the type past
// comfortable legibility — and never past 3 frames (an IG story people
// actually tap through).
const MAX_STORY_FRAMES = 3

// Legibility thresholds, in Hebrew characters, tuned for a designed 9:16
// poster where the type must stay large. Below the first threshold the
// whole script fits one frame comfortably; each further band adds a frame.
const ONE_FRAME_MAX_CHARS = 220
const TWO_FRAME_MAX_CHARS = 460

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
 * The real story format body (see story-generator) is three blocks —
 * hook / content / CTA — separated by blank lines, with NO labels. Older
 * dummy text used `[מסך N]` labels, so we strip any such label defensively.
 *
 * We stay committed to ONE frame and only add frames (up to 3) when the
 * total text would be too dense for one legible 9:16 poster. When we do
 * split, we keep each block whole and group consecutive blocks so the
 * per-frame text is roughly balanced. A single over-long block (rare — the
 * hook and CTA are their own blocks) falls back to a sentence split so the
 * feature still relieves density instead of giving up.
 */
function splitStoryIntoFrames(body: string): string[] {
  const blocks = body
    .split(/\n\s*\n+/)
    .map((b) =>
      b
        // Drop a leading `[מסך N]` / `[screen N]`-style label if present.
        .replace(/^\s*\[[^\]]*\]\s*/g, "")
        .trim(),
    )
    .filter(Boolean)

  if (blocks.length === 0) return []

  const totalChars = blocks.reduce((n, b) => n + b.length, 0)
  const desiredFrames = Math.min(
    MAX_STORY_FRAMES,
    totalChars <= ONE_FRAME_MAX_CHARS
      ? 1
      : totalChars <= TWO_FRAME_MAX_CHARS
        ? 2
        : 3,
  )

  if (desiredFrames <= 1) return [blocks.join("\n\n")]

  // Enough blocks to hit the target by grouping whole blocks — the common
  // case (hook / content / CTA → 3 blocks).
  if (blocks.length >= desiredFrames) {
    return balanceBlocksIntoGroups(blocks, desiredFrames)
  }

  // Fewer blocks than frames (e.g. one giant paragraph). Sentence-split the
  // longest block repeatedly until we have enough pieces, then group.
  const pieces = [...blocks]
  while (pieces.length < desiredFrames) {
    let longest = 0
    for (let i = 1; i < pieces.length; i++) {
      if (pieces[i].length > pieces[longest].length) longest = i
    }
    const halves = splitBlockInHalf(pieces[longest])
    if (halves.length < 2) break // can't split further — bail with what we have
    pieces.splice(longest, 1, halves[0], halves[1])
  }
  return balanceBlocksIntoGroups(pieces, Math.min(desiredFrames, pieces.length))
}

/**
 * Group consecutive blocks into `groups` frames, keeping order and
 * balancing character counts greedily (each block joins the current frame
 * until doing so would overshoot the even per-frame target).
 */
function balanceBlocksIntoGroups(blocks: string[], groups: number): string[] {
  const total = blocks.reduce((n, b) => n + b.length, 0)
  const target = total / groups
  const frames: string[] = []
  let current: string[] = []
  let currentChars = 0
  for (let i = 0; i < blocks.length; i++) {
    const remainingBlocks = blocks.length - i
    const remainingSlots = groups - frames.length
    // Keep at least one block per remaining frame slot.
    const mustClose = remainingBlocks <= remainingSlots - 1
    if (
      current.length > 0 &&
      (mustClose ||
        (frames.length < groups - 1 && currentChars >= target * 0.9))
    ) {
      frames.push(current.join("\n\n"))
      current = []
      currentChars = 0
    }
    current.push(blocks[i])
    currentChars += blocks[i].length
  }
  if (current.length > 0) frames.push(current.join("\n\n"))
  return frames
}

/** Split one block near its middle, preferring a sentence boundary. */
function splitBlockInHalf(block: string): string[] {
  const sentences = block.split(/(?<=[.!?…])\s+/).filter(Boolean)
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2)
    return [
      sentences.slice(0, mid).join(" ").trim(),
      sentences.slice(mid).join(" ").trim(),
    ]
  }
  // No sentence boundary — split on the nearest space to the midpoint.
  const mid = Math.floor(block.length / 2)
  const left = block.lastIndexOf(" ", mid)
  const cut = left > 0 ? left : mid
  return [block.slice(0, cut).trim(), block.slice(cut).trim()].filter(Boolean)
}

/**
 * Palette / mood variants — the story has no template picker, so we rotate
 * the palette by the per-post generation index to give real variety on
 * regenerate. Each variant plugs into the SHARED premium design language
 * below (same as the approved AI carousel system: dark atmospheric canvas +
 * one accent gradient). The chosen palette is applied IDENTICALLY to every
 * frame of one generation, so a multi-frame story reads as one cohesive set.
 */
const PALETTE_VARIANTS = [
  "Palette: deep navy / charcoal canvas with a lavender→purple accent gradient. Cool, premium, modern.",
  "Palette: near-black canvas with a warm amber→gold accent gradient. Cinematic and rich.",
  "Palette: deep plum / aubergine canvas with a rose→coral accent gradient. Bold and confident.",
  "Palette: dark teal / midnight canvas with an aqua→emerald accent gradient. Fresh and striking.",
]

/**
 * Full-image prompt for one story frame — same approved design language as
 * the AI carousel (see carousel-design skill): a premium dark canvas, one
 * conceptual glassy 3D visual that makes THIS frame's message physical,
 * bold white Hebrew type with a gradient-highlighted key word, and (for a
 * cohesive set) an identical palette across frames. Story-specific: 9:16
 * full-bleed and the Instagram Story safe zone.
 *
 * `frameIndex`/`frameCount` steer the per-frame role and a subtle progress
 * indicator; `palette` is shared across all frames of a generation;
 * `niche` pulls the imagery into the creator's world; `context` anchors the
 * mood to the post.
 */
function buildStoryPrompt(
  frameText: string,
  frameIndex: number,
  frameCount: number,
  palette: string,
  niche: string | null,
  context: string,
): string {
  const role =
    frameCount === 1
      ? "This single frame carries the whole story — hook, message, and call-to-action — in a clear top-to-bottom hierarchy, the hook most dominant."
      : frameIndex === 0
        ? "This is the opening frame — the hook dominates and the visual is at its most striking, pulling the viewer in."
        : frameIndex === frameCount - 1
          ? "This is the closing frame — it lands the message and the call-to-action, warm and decisive."
          : `This is frame ${frameIndex + 1} of ${frameCount} — it carries the story forward.`

  const progress =
    frameCount > 1
      ? `- A small, subtle frame indicator "${frameIndex + 1}/${frameCount}" in a top corner, matching the palette (unobtrusive).`
      : null

  return [
    "Design a complete, polished vertical Instagram STORY image (9:16, full-bleed) in HEBREW.",
    "",
    "The frame contains exactly this Hebrew text, spelled EXACTLY as written, laid out right-to-left (RTL), and no other words. Do not translate, transliterate, paraphrase, reorder, or add anything:",
    `"""${frameText}"""`,
    "",
    role,
    "",
    "Design language (IDENTICAL across every frame of this story — same canvas, palette, material and type treatment):",
    "- One conceptual 3D-rendered translucent glass visual that makes THIS frame's message physical — a real object or scene embodying the idea. It frames or surrounds the text; imagery and text share the composition without crowding each other.",
    ...(niche
      ? [
          `- The creator's niche is: """${niche}""". Draw the visual's objects and metaphors from this niche's world, combined with what THIS frame says — the imagery should instantly feel like it belongs to this niche (its tools, environments, symbols and vibe), never generic stock decoration.`,
        ]
      : []),
    "- Canvas: rich and atmospheric with a subtle vignette and soft gradient lighting — premium, never flat, never busy.",
    "- Typography: bold, modern white Hebrew type with a clear hierarchy INSIDE the text — the single most important word or phrase is set in the accent gradient and one size step up; the rest stays clean and highly readable.",
    "- Texture: soft flowing gradient lines, gentle glow edges or light streaks as background accents.",
    "",
    palette,
    "",
    "Rules that always hold:",
    "- Correct Hebrew letterforms and right-to-left reading order; reproduce every character precisely.",
    "- High legibility: strong contrast between text and background.",
    "- INSTAGRAM STORY SAFE ZONE: keep ALL text and key elements within the central 62% of the height — leave a generous empty margin in the TOP ~14% and BOTTOM ~24% so the profile header and the reply bar never cover the text.",
    progress,
    "- The mood should relate to this post content (written in Hebrew): " +
      `"""${context}"""`,
    "",
    "Do NOT add any text other than the exact Hebrew lines above (and the tiny frame indicator if requested). No watermarks, no logos, no UI chrome, no borders, no signatures.",
  ]
    .filter(Boolean)
    .join("\n")
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
      size: "1024x1536", // closest documented portrait; center-cropped to 9:16
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

/**
 * Center-crop the model's 1024×1536 image to an exact 1080×1920 (9:16)
 * canvas — gpt-image-2 has no documented native 9:16 size.
 * `preserveAspectRatio="xMidYMid slice"` is the SVG equivalent of CSS
 * object-fit:cover, trimming ~8% off each side (inside the prompt's safe
 * zone, so the centered text is kept). No fonts / no text in this pass.
 */
function cropToCanvas(imageBase64: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}

export async function POST(req: NextRequest) {
  try {
    const { postId, variationIndex } = (await req.json().catch(() => ({}))) as {
      postId?: string
      variationIndex?: number
    }
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
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

    const frames = splitStoryIntoFrames(variant.body)
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
              "כדי לייצר סטורי עם AI צריך לחבר מפתח OpenAI בהגדרות → חיבורים → OpenAI.",
          },
          { status: 402 },
        )
      }
      throw err
    }

    const palette =
      PALETTE_VARIANTS[
        (((variationIndex ?? 0) % PALETTE_VARIANTS.length) +
          PALETTE_VARIANTS.length) %
          PALETTE_VARIANTS.length
      ]

    // The creator's niche pulls the conceptual imagery into their WORLD
    // (health niche → health objects/vibe; design niche → screens/tools)
    // — same rule as the AI carousel. Missing niche → context-only imagery
    // (the line is omitted, not sent empty).
    const { data: identityRow } = await supabase
      .from("core_identities")
      .select("niche")
      .eq("user_id", user.id)
      .single()
    const niche =
      ((identityRow as { niche?: string | null } | null)?.niche ?? "").trim() ||
      null

    // Theme context: title + hook carry the essence; the body is truncated
    // so a long post doesn't drown the composition instructions.
    const context = [post.title, post.hook_text, post.body?.slice(0, 500)]
      .filter(Boolean)
      .join("\n")

    const total = frames.length
    const images: string[] = new Array(total)

    // Simple concurrency pool — kinder to OpenAI rate limits than firing
    // all frames at once, much faster than fully sequential.
    let next = 0
    async function worker() {
      while (next < total) {
        const i = next++
        const prompt = buildStoryPrompt(
          frames[i],
          i,
          total,
          palette,
          niche,
          context,
        )
        const raw = await generateImage(openaiKey, prompt)
        images[i] = cropToCanvas(raw)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    )

    return NextResponse.json({ images, frameCount: total })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[story/generate-media]", msg)
    return NextResponse.json(
      { error: `יצירת הסטורי נכשלה: ${msg}` },
      { status: 500 },
    )
  }
}
