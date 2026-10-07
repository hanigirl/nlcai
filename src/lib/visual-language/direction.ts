import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserApiKey } from "@/lib/api-keys"
import { deriveNicheVisualLanguage } from "@/lib/agents/visual-language-analyzer"
import { loadImageForModels, type ModelImage } from "@/lib/visual-language/image-input"
import { measureElement, type FixedElement } from "@/lib/visual-language/fixed-elements"
import sharp from "sharp"
import type {
  MediaStyle,
  NicheVisualLanguage,
  VisualFormat,
  VisualLanguage,
} from "@/lib/visual-language/types"

/**
 * Which visual language an AI image follows, in priority order:
 *
 * 1. brand — the user's analysed visual language (Settings → Media), when
 *    the analysis found a clear, unified one. Her graphic elements ride along
 *    as reference images.
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

export async function resolveDesignDirection(
  supabase: SupabaseClient,
  userId: string,
  opts: { format: VisualFormat; allowReferences?: boolean; style?: MediaStyle },
): Promise<DesignDirection> {

  const [{ data: userRow }, { data: identityRow }] = await Promise.all([
    supabase
      .from("users")
      .select("brand_colors, visual_language, niche_visual_language")
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
  } | null
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
    const lines = [
      "VISUAL LANGUAGE — this is the creator's own brand. Follow it faithfully; it overrides any generic style habit:",
      vl.style_spec.trim(),
    ]
    const formatSpec = vl.formats?.[opts.format]?.trim()
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
    return { source: "brand", lines, references, fixed }
  }

  const colorLine = colors.length
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
    const res = await fetch(url)
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
