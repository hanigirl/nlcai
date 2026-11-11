import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserApiKey } from "@/lib/api-keys"
import { deriveNicheVisualLanguage } from "@/lib/agents/visual-language-analyzer"
import { loadExampleForModels, loadImageForModels, type ModelImage } from "@/lib/visual-language/image-input"
import { stripLookWords } from "@/lib/visual-language/composition-only"
import { canOwnMediaText, examplesInLanguage } from "@/lib/feature-access"
import { loadBrandFonts } from "@/lib/broll-animation/brief"
import type { BrandFont } from "@/lib/broll-animation/compose"
import { measureElement, type FixedElement } from "@/lib/visual-language/fixed-elements"
import sharp from "sharp"
import { loadStyleRules, styleRuleLines } from "@/lib/style-memory"
import {
  userExampleKind,
  type ExampleKind,
  type MediaStyle,
  type NicheVisualLanguage,
  type VisualFormat,
  type VisualLanguage,
} from "@/lib/visual-language/types"
import { guardedFetch } from "@/lib/server-fetch"

/**
 * Which visual language an AI image follows, in priority order:
 *
 * 1. brand — the user's analysed visual language (Settings → Media), when
 *    the analysis found a clear, unified one. Her graphic elements and her
 *    finished examples of this format (דוגמאות לשימוש) ride along as
 *    reference images.
 * 2. niche — no usable brand language: a language derived from her niche
 *    (cached per niche). Her brand colours, if she set any, still apply.
 * 3. niche-direct — same intent, but there's no Claude key to derive and
 *    cache a brief, so the image model is told to choose from the niche.
 * 4. none — no niche either: a clean, content-led look.
 *
 * Never the old universal dark-neon-3D canvas.
 */

export interface DesignDirection {
  source: "brand" | "niche" | "niche-direct" | "none"
  /** Prompt lines describing the language. */
  lines: string[]
  /** Brand elements to attach as reference images (brand source only). */
  references: ModelImage[]
  /**
   * Brand elements with a fixed spot — never sent to the model; the route
   * reserves their zone in the prompt and pastes them in afterwards.
   */
  fixed: FixedElement[]
}

// Each reference image costs input tokens on every frame; four covers a
// logo + a few recurring marks.
const MAX_REFERENCES = 4

// Her finished posts of the format being generated — the look to match.
// Read from the DB on every generation, so a new upload applies at once,
// before she re-runs the analysis.
export const MAX_FORMAT_EXAMPLES = 3

/**
 * The formats whose examples ride along as image-model references here.
 * Carousel is left out on purpose: the carousel layout engine already gets
 * her carousel examples attached directly (carouselExamples in
 * /api/carousel/generate-ai), and these prompt lines also reach prompts that
 * carry no images. b_roll's background stays text-free and reference-free;
 * its examples go to the Opus composition instead (api/b-roll/generate-media).
 */
const FORMAT_EXAMPLE_KIND: Partial<Record<VisualFormat, ExampleKind>> = {
  story: "story",
  image_post: "feed_post",
}

const FORMAT_NAMES: Record<VisualFormat, string> = {
  story: "Instagram stories",
  carousel: "carousel slides",
  image_post: "single-image feed posts",
  b_roll: "b-roll reel frames",
}

/** A random order (Fisher–Yates). */
export function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Up to `max` of her examples of one kind (Settings → דוגמאות לשימוש): the
 * ones she filed under its tab first, then older unfiled ones the last
 * analysis recognised as that kind. Links (site screenshots) never count.
 */
export async function loadBrandExamples(
  supabase: SupabaseClient,
  userId: string,
  kind: ExampleKind,
  exampleKinds: VisualLanguage["example_kinds"],
  max = MAX_FORMAT_EXAMPLES,
  /**
   * She has brand colours: the examples go out in grayscale (composition
   * only). Left out, it's read from her brand colours. Hani + Nataliya only
   * (lib/feature-access canOwnMediaText).
   */
  gray?: boolean,
): Promise<ModelImage[]> {
  const { data: u } = await supabase.from("users").select("brand_colors, email").eq("id", userId).single()
  const me = u as { brand_colors?: string[] | null; email?: string | null } | null
  if (gray === undefined) gray = canOwnMediaText(me?.email) && (me?.brand_colors ?? []).length > 0
  // A different pick every time (Hani, 2026-11-11): the structure is taken
  // from her examples at random, so uneven examples give uneven results.
  const random = examplesInLanguage(me?.email)
  const { data, error } = await supabase
    .from("user_media")
    .select("id, storage_path, metadata")
    .eq("user_id", userId)
    .eq("category", "brand_example")
    .order("created_at", { ascending: true })
  if (error) console.error("[visual-language][format-examples]", error)
  const rows = ((data ?? []) as { id: string; storage_path: string; metadata: Record<string, unknown> | null }[])
    .filter((r) => !r.storage_path.startsWith("url:") && typeof r.metadata?.url !== "string")
  const recognised = new Set((exampleKinds ?? []).filter((k) => k.kind === kind).map((k) => k.id))
  const filed = rows.filter((r) => userExampleKind(r.metadata) === kind)
  const unfiled = rows.filter((r) => !userExampleKind(r.metadata) && recognised.has(r.id))
  const picked = (random ? shuffled([...filed, ...unfiled]) : [...filed, ...unfiled]).slice(0, max)
  const images = await Promise.all(
    picked.map((r) =>
      loadExampleForModels(supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl, gray).catch(
        (err) => {
          console.error("[visual-language][format-example]", r.id, err)
          return null
        },
      ),
    ),
  )
  return images.filter((x): x is ModelImage => x !== null)
}

/**
 * Her brand colours (Settings → brand colours) are the palette. Her usage
 * examples and her analysed language set the layout and style, never the
 * colours: an example made in other colours used to pull the whole piece
 * into them (Nataliya, 2026-11-09). With no brand colours, the examples'
 * colours apply as before.
 */
export function brandColourLines(colors: string[]): string[] {
  if (!colors.length) return []
  return [
    `BRAND COLOURS — authoritative: ${colors.join(", ")} (in priority order; the first is her main colour). Build every designed surface — background, text boxes and plates, highlights, accents, text colour — from these, plus white, black and lighter / darker tints of them. This overrides any other colour named in the description above or seen in the attached example images: the examples set the layout and style, never the palette. Where an example uses a colour that isn't one of these, give that role to the brand colour that fits it. Photographic imagery may keep its natural colours, graded to sit with this palette; her attached brand elements (logo, marks) keep their own colours.`,
  ]
}

/**
 * The palette a layout engine (carousel, b-roll / animated frames) designs
 * with: her brand colours when she set any — keeping the role the analysis
 * gave each one — never a colour the analysis lifted from her examples.
 */
export function brandPalette(
  colors: string[] | null | undefined,
  analysed: { hex: string; role: string }[] | null | undefined,
): { hex: string; role: string }[] {
  const brand = colors ?? []
  if (!brand.length) return analysed ?? []
  const roleOf = new Map((analysed ?? []).map((p) => [p.hex.toLowerCase(), p.role]))
  return brand.map((hex, i) => {
    const rank = i === 0 ? "primary brand colour" : "brand colour"
    const role = roleOf.get(hex.toLowerCase())
    return { hex, role: role ? `${rank} — ${role}` : rank }
  })
}

/**
 * Fonts always come from her brand fonts, never from her examples (Hani,
 * 2026-11-09). The image model can't load a font file, so it gets the name
 * and the character to aim for.
 */
export function brandFontLine(fonts: BrandFont[]): string {
  const primary = fonts.find((f) => f.role === "primary") ?? fonts[0]
  const accent = fonts.find((f) => f !== primary)
  if (!primary) {
    return "TYPEFACE — a clean, highly readable Hebrew typeface. Never copy the typeface of an attached example image."
  }
  return `BRAND FONTS — authoritative: set all text in her brand typeface "${primary.family}"${accent ? ` (her accent typeface "${accent.family}" only for a short highlighted word)` : ""}. Never copy the typeface of an attached example image.`
}

/**
 * Layout variety for regenerate. The language (palette, type, imagery
 * style) stays fixed — only the arrangement changes between attempts.
 */
const COMPOSITIONS = [
  "Composition: type-led — the Hebrew headline is the hero, set large, with one supporting visual element drawn from the visual language.",
  "Composition: image-led — one strong visual fills most of the frame; the text sits on a calm, clear area of it.",
  "Composition: framed — the text sits inside a shape, card or frame drawn from the visual language, with the visual around it.",
  "Composition: asymmetric editorial — text aligned to the right edge (RTL), the visual offset to the left, generous whitespace.",
]

export function pickComposition(variationIndex: number | undefined): string {
  const n = COMPOSITIONS.length
  return COMPOSITIONS[(((variationIndex ?? 0) % n) + n) % n]
}

/** The closing "no extras" rule — allows her own elements when attached. */
export function noExtrasRule(direction: DesignDirection): string {
  return direction.references.length
    ? "No watermarks, no UI chrome, no borders, no signatures, and no logos or marks other than the attached brand elements."
    : "No watermarks, no logos, no UI chrome, no borders, no signatures."
}

function toneLine(tone: "dark" | "light"): string {
  return tone === "dark"
    ? "Make it a DARK design: a deep, rich background colour that belongs to this world, with light readable text — not neon, not sci-fi."
    : "Make it a LIGHT design: a light, airy background with dark readable text."
}

/** "חדש לגמרי" — a blank page; her brief is the whole direction. */
const BLANK_DIRECTION: DesignDirection = {
  source: "none",
  lines: [
    "VISUAL LANGUAGE — none fixed. Start from a blank page: design this piece entirely from the creator's own direction below. Do not borrow any brand palette, logo or house style; where her direction is silent, choose what best serves the content — calm, readable, premium; avoid dark neon gradients and glossy 3D glass objects.",
  ],
  references: [],
  fixed: [],
}

/**
 * The direction plus her standing preferences (lib/style-memory) — the ones
 * saved for this format or for every format.
 */
export async function resolveDesignDirection(
  supabase: SupabaseClient,
  userId: string,
  opts: { format: VisualFormat; allowReferences?: boolean; style?: MediaStyle },
): Promise<DesignDirection> {
  // She picked the niche language (or its dark / light variant) to get away
  // from her brand: her standing preferences came from brand edits and
  // "override" everything, so they'd pull it straight back (Hani, 2026-10-29).
  // "חדש לגמרי": nothing of hers — no language, colours, elements or standing
  // preferences. The brief (lib/media-brief) is added on top by the route.
  if (opts.style === "blank") return BLANK_DIRECTION
  const nicheChosen = !!opts.style && opts.style !== "brand"
  const [direction, rules] = await Promise.all([
    resolveBaseDirection(supabase, userId, opts),
    nicheChosen ? Promise.resolve([]) : loadStyleRules(supabase, userId),
  ])
  const extra = styleRuleLines(rules, opts.format)
  return extra.length ? { ...direction, lines: [...direction.lines, "", ...extra] } : direction
}

async function resolveBaseDirection(
  supabase: SupabaseClient,
  userId: string,
  opts: { format: VisualFormat; allowReferences?: boolean; style?: MediaStyle },
): Promise<DesignDirection> {

  const [{ data: userRow }, { data: identityRow }] = await Promise.all([
    supabase
      .from("users")
      .select("brand_colors, visual_language, niche_visual_language, email")
      .eq("id", userId)
      .single(),
    supabase
      .from("core_identities")
      .select("niche, who_i_am, who_i_serve")
      .eq("user_id", userId)
      .maybeSingle(),
  ])

  const row = userRow as {
    brand_colors?: string[] | null
    visual_language?: VisualLanguage | null
    niche_visual_language?: NicheVisualLanguage | null
    email?: string | null
  } | null
  // Hani + Nataliya only (lib/feature-access, 2026-11-10): her brand colours
  // and fonts win over her usage examples. Everyone else: unchanged.
  const brandWins = canOwnMediaText(row?.email)
  const identity = identityRow as {
    niche?: string | null
    who_i_am?: string | null
    who_i_serve?: string | null
  } | null

  const colors = row?.brand_colors ?? []
  const vl = row?.visual_language
  const niche = identity?.niche?.trim() || null

  // 1. Her own visual language — unless she picked the niche language or a
  // dark / light niche variant.
  if ((!opts.style || opts.style === "brand") && vl?.status === "ok" && vl.style_spec?.trim()) {
    const { references: loaded, fixed } =
      opts.allowReferences === false
        ? { references: [], fixed: [] }
        : await loadElements(supabase, userId, vl, opts.format)
    const references = loaded.map((r) => r.image)
    // Her analysed language is written from her examples. Colours come from
    // her brand colours (when she set any) and fonts from her brand fonts,
    // so the description's colour and font words are left out (Hani,
    // 2026-11-09) — its composition stays.
    const look = { colours: brandWins && colors.length > 0, fonts: brandWins }
    const lines = [
      "VISUAL LANGUAGE — this is the creator's own brand. Follow it faithfully; it overrides any generic style habit:",
      stripLookWords(vl.style_spec.trim(), look),
    ]
    const formatSpec = stripLookWords(vl.formats?.[opts.format]?.trim() ?? "", look)
    if (formatSpec) {
      lines.push("", `How this language works in this format: ${formatSpec}`)
    }
    if (loaded.length) {
      lines.push(
        "",
        "Attached reference images are the creator's real brand elements. Reproduce each one exactly as it is (same shape, colours and proportions — never redraw or restyle it), and only where its note says it belongs; it's fine to leave one out of this image. One exception: if an element would sit on a background of similar tone and get lost (a dark mark on a dark area, a light one on a light area), render its opposite-tone version — same shape, only light↔dark flipped — so it stays clearly visible:",
        ...loaded.map((r, i) => `- Reference image ${i + 1}: ${r.note}`),
      )
    }
    // Her own finished examples of this format — appended after the
    // element references so their numbering stays put. Skipped where the
    // caller wants no references (text-free backgrounds).
    const exampleKind = FORMAT_EXAMPLE_KIND[opts.format]
    const examples =
      opts.allowReferences === false || !exampleKind
        ? []
        : await loadBrandExamples(supabase, userId, exampleKind, vl.example_kinds, MAX_FORMAT_EXAMPLES, brandWins && colors.length > 0)
    if (examples.length) {
      const first = references.length + 1
      references.push(...examples)
      const range =
        examples.length === 1
          ? `Reference image ${first} is`
          : `Reference images ${first}–${references.length} are`
      lines.push(
        "",
        !brandWins
          ? `${range} FINISHED ${FORMAT_NAMES[opts.format]} the creator made in her own style — this is exactly how her ${FORMAT_NAMES[opts.format]} should look. Design this image as the next one in that series: same palette and background treatment, same typography character and hierarchy, same layout devices, graphic elements, density and overall feel. Do NOT copy their text, photos or subject — this image has its own content.`
          : colors.length
          ? `${range} FINISHED ${FORMAT_NAMES[opts.format]} the creator made, shown in grayscale on purpose. They set the COMPOSITION only: layout, where each element sits, the text hierarchy (headline / body sizes and weights), how much text there is and the ratio of picture to text. Design this image as the next one in that series. Do NOT copy their text, photos, subject or typeface, and take no colour from them — the colours are her BRAND COLOURS below.`
          : `${range} FINISHED ${FORMAT_NAMES[opts.format]} the creator made in her own style. They set the composition — layout, where each element sits, the text hierarchy, how much text there is and the ratio of picture to text — and, since she has no brand colours, the palette and background treatment too. Design this image as the next one in that series. Do NOT copy their text, photos, subject or typeface — this image has its own content.`,
      )
    }
    // Last, so it wins over her analysed language (which may name colours
    // it read off the examples) and over the examples themselves.
    const colourLines = brandWins ? brandColourLines(colors) : []
    if (colourLines.length) lines.push("", ...colourLines)
    // Examples ride along as images: say outright the type isn't theirs.
    if (brandWins && examples.length) lines.push("", brandFontLine(await loadBrandFonts(supabase, userId)))
    return { source: "brand", lines, references, fixed }
  }

  // Brand colours only when she didn't ask for the niche look on purpose.
  const colorLine = colors.length && !(opts.style && opts.style !== "brand")
    ? `The creator's brand colours are ${colors.join(", ")} — build the palette around them.`
    : null

  // "כהה" / "בהיר" — the niche language on a dark or light canvas. Never
  // the old glass-3D neon look: dark means dark FOR HER WORLD (kids'
  // education → deep navy with playful toys), not sci-fi.
  const tone = opts.style === "ai-dark" ? "dark" : opts.style === "ai-light" ? "light" : null

  // 2. Derived from the niche (cached until the niche changes).
  if (niche) {
    let cached = row?.niche_visual_language ?? null
    // Caches from before tone variants existed lack them — refresh once.
    if (!cached || cached.niche !== niche || (tone && !cached[`${tone}_spec`])) {
      cached = (await deriveAndCacheNiche(supabase, userId, niche, identity)) ?? cached
      if (cached && cached.niche !== niche) cached = null
    }
    const spec = cached ? (tone ? cached[`${tone}_spec`] : cached.style_spec) : undefined
    if (cached && spec?.trim()) {
      return {
        source: "niche",
        lines: [
          tone
            ? `VISUAL LANGUAGE — a ${tone.toUpperCase()} design fitted to the creator's niche (${niche}). Follow it consistently; no neon, no glossy 3D glass objects unless it says so:`
            : `VISUAL LANGUAGE — chosen to suit the creator's niche (${niche}). Follow it consistently; do NOT fall back to dark neon gradients or glossy 3D glass objects unless it says so:`,
          spec.trim(),
          ...(colorLine ? [colorLine] : []),
        ],
        references: [],
        fixed: [],
      }
    }
    // 3. No Claude key / derivation failed — let the image model choose.
    return {
      source: "niche-direct",
      lines: [
        `VISUAL LANGUAGE — the creator's niche is """${niche}""". Choose the visual language a thoughtful brand designer would give this niche so her audience instantly feels it belongs to that world (e.g. a doctor → clean, calm whites and clinical blues with subtle tech motifs; parent guidance → soft pastels, rounded shapes, gentle illustration). Do NOT default to dark neon gradients or glossy 3D glass objects unless the niche truly calls for it.`,
        ...(tone ? [toneLine(tone)] : []),
        ...(colorLine ? [colorLine] : []),
      ],
      references: [],
      fixed: [],
    }
  }

  // 4. Nothing to go on.
  return {
    source: "none",
    lines: [
      "VISUAL LANGUAGE — clean, modern and content-led: let the post's subject suggest the palette and imagery. Calm, readable, premium; avoid dark neon gradients and glossy 3D glass objects.",
      ...(tone ? [toneLine(tone)] : []),
      ...(colorLine ? [colorLine] : []),
    ],
    references: [],
    fixed: [],
  }
}

/**
 * Her graphic elements for this format, split in two:
 * - fixed (a placement for this format) → loaded at full quality for
 *   compositing; the model never sees them.
 * - free → reference images the model may use where her note says.
 * Elements whose placement names other formats only are left out entirely.
 */
async function loadElements(
  supabase: SupabaseClient,
  userId: string,
  vl: VisualLanguage,
  format: VisualFormat,
): Promise<{ references: { image: ModelImage; note: string }[]; fixed: FixedElement[] }> {
  const all = vl.elements ?? []
  if (!all.length) return { references: [], fixed: [] }
  const { data } = await supabase
    .from("user_media")
    .select("id, storage_path, metadata")
    .eq("user_id", userId)
    .eq("category", "element")
    .in("id", all.map((e) => e.id))
  const rows = (data ?? []) as {
    id: string
    storage_path: string
    metadata: { alt_storage_path?: string } | null
  }[]
  const publicUrl = (path: string) => supabase.storage.from("user-media").getPublicUrl(path).data.publicUrl
  const urlFor = (id: string) => {
    const r = rows.find((x) => x.id === id)
    return r ? publicUrl(r.storage_path) : null
  }
  const fetchPng = async (url: string) => {
    const res = await guardedFetch(url)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    // Full resolution, transparency kept (SVG rasterised).
    return sharp(Buffer.from(await res.arrayBuffer()), { density: 300 }).png().toBuffer()
  }

  const fixedEls = all.filter(
    (e) => e.placement && (e.placement.formats as string[]).includes(format),
  )
  const freeEls = all.filter((e) => !e.placement).slice(0, MAX_REFERENCES)

  const [fixed, references] = await Promise.all([
    Promise.all(
      fixedEls.map(async (el): Promise<FixedElement | null> => {
        const url = urlFor(el.id)
        if (!url) return null
        try {
          const png = await fetchPng(url)
          const meta = await sharp(png).metadata()
          // Her opposite-tone version, if she uploaded one. Resized to the
          // original's box at paste time, so a slightly different canvas
          // size still lands on the same pixels.
          const altPath = rows.find((x) => x.id === el.id)?.metadata?.alt_storage_path
          const alt = altPath
            ? await fetchPng(publicUrl(altPath)).catch((err) => {
                console.error("[visual-language][fixed-element-alt]", el.id, err)
                return undefined
              })
            : undefined
          return {
            name: el.name,
            png,
            alt,
            aspect: (meta.height ?? 1) / (meta.width ?? 1),
            placement: el.placement!,
            ...(await measureElement(png)),
          }
        } catch (err) {
          console.error("[visual-language][fixed-element]", el.id, err)
          return null
        }
      }),
    ),
    Promise.all(
      freeEls.map(async (el) => {
        const url = urlFor(el.id)
        if (!url) return null
        try {
          return { image: await loadImageForModels(url), note: `${el.name} — ${el.usage}` }
        } catch (err) {
          console.error("[visual-language][reference]", el.id, err)
          return null
        }
      }),
    ),
  ])
  return {
    fixed: fixed.filter((x): x is FixedElement => x !== null),
    // Failed loads drop out, so notes stay aligned with the attached images.
    references: references.filter((x): x is { image: ModelImage; note: string } => x !== null),
  }
}

async function deriveAndCacheNiche(
  supabase: SupabaseClient,
  userId: string,
  niche: string,
  identity: { who_i_am?: string | null; who_i_serve?: string | null } | null,
): Promise<NicheVisualLanguage | null> {
  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return null
  }
  try {
    const out = await deriveNicheVisualLanguage(apiKey, {
      niche,
      whoIAm: identity?.who_i_am,
      whoIServe: identity?.who_i_serve,
    })
    const value: NicheVisualLanguage = {
      niche,
      summary_he: out.summary_he,
      style_spec: out.style_spec,
      dark_spec: out.dark_spec,
      light_spec: out.light_spec,
      generated_at: new Date().toISOString(),
    }
    const { error } = await supabase
      .from("users")
      .update({ niche_visual_language: value } as never)
      .eq("id", userId)
    if (error) console.error("[visual-language][niche-cache]", error)
    return value
  } catch (err) {
    console.error("[visual-language][niche-derive]", err)
    return null
  }
}
