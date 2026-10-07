import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { analyzeVisualLanguage } from "@/lib/agents/visual-language-analyzer"
import {
  loadImageForModels,
  screenshotWebsite,
  type ModelImage,
} from "@/lib/visual-language/image-input"
import {
  MAX_BRAND_ELEMENTS,
  MAX_BRAND_EXAMPLES,
  visualLanguageSignature,
  type VisualLanguage,
} from "@/lib/visual-language/types"

// Website screenshots + an Opus vision call over up to 14 images.
export const maxDuration = 300

/**
 * Settings → Media → שפה ויזואלית → "ניתוח השפה הוויזואלית".
 *
 * Reads the user's saved inputs from the DB (never from the request body),
 * asks Claude whether they form one visual language, and stores the result
 * on users.visual_language — including the "inconsistent" verdict, so the
 * warning survives a reload and generators know to fall back to the niche.
 */
export async function POST() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return NextResponse.json(
      {
        error: "anthropic_not_connected",
        message: "כדי לנתח את השפה הוויזואלית צריך לחבר מפתח Claude בהגדרות ← חיבורים ← Claude.",
      },
      { status: 402 },
    )
  }

  const [{ data: userRow }, { data: mediaRows }, { data: identityRow }] = await Promise.all([
    supabase.from("users").select("brand_colors").eq("id", user.id).single(),
    supabase
      .from("user_media")
      .select("id, category, file_name, storage_path, metadata, created_at")
      .eq("user_id", user.id)
      .in("category", ["element", "brand_example"])
      .order("created_at", { ascending: true }),
    supabase.from("core_identities").select("niche").eq("user_id", user.id).maybeSingle(),
  ])

  const colors = ((userRow as { brand_colors?: string[] } | null)?.brand_colors ?? []).slice(0, 3)
  const rows = (mediaRows ?? []) as {
    id: string
    category: string
    file_name: string
    storage_path: string
    metadata: Record<string, unknown> | null
  }[]
  const elementRows = rows.filter((r) => r.category === "element").slice(0, MAX_BRAND_ELEMENTS)
  const exampleRows = rows.filter((r) => r.category === "brand_example").slice(0, MAX_BRAND_EXAMPLES)

  if (!colors.length && !elementRows.length && !exampleRows.length) {
    return NextResponse.json(
      { error: "no_inputs", message: "הוסיפו לפחות צבע מותג, אלמנט או דוגמה לפני הניתוח." },
      { status: 400 },
    )
  }

  const publicUrl = (path: string) =>
    supabase.storage.from("user-media").getPublicUrl(path).data.publicUrl
  const description = (r: { metadata: Record<string, unknown> | null }) =>
    typeof r.metadata?.description === "string" ? r.metadata.description : ""

  const unreadableLinks: string[] = []

  const [elements, examples] = await Promise.all([
    Promise.all(
      elementRows.map(async (r) => {
        try {
          return { id: r.id, description: description(r), image: await loadImageForModels(publicUrl(r.storage_path)) }
        } catch (err) {
          console.error("[visual-language][element]", r.id, err)
          return null
        }
      }),
    ),
    Promise.all(
      exampleRows.map(async (r) => {
        const link = typeof r.metadata?.url === "string" ? r.metadata.url : null
        if (link) {
          const shot = await screenshotWebsite(link)
          if (!shot) {
            unreadableLinks.push(link)
            return null
          }
          return { label: `screenshot of ${link}`, image: shot.image, palette: shot.palette }
        }
        try {
          return { label: r.file_name, image: await loadImageForModels(publicUrl(r.storage_path)) }
        } catch (err) {
          console.error("[visual-language][example]", r.id, err)
          return null
        }
      }),
    ),
  ])

  const okElements = elements.filter(
    (e): e is { id: string; description: string; image: ModelImage } => e !== null,
  )
  const okExamples = examples.filter(
    (e): e is { label: string; image: ModelImage; palette?: string[] } => e !== null,
  )

  let result
  try {
    result = await analyzeVisualLanguage(apiKey, {
      colors,
      elements: okElements,
      examples: okExamples,
      niche: (identityRow as { niche?: string | null } | null)?.niche ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[visual-language][analyze]", msg)
    return NextResponse.json({ error: "analyze_failed", message: `הניתוח נכשל: ${msg}` }, { status: 500 })
  }

  // Only keep element instructions for elements that actually exist.
  const elementIds = new Set(okElements.map((e) => e.id))
  const visualLanguage: VisualLanguage = {
    status: result.consistent && result.style_spec.trim() ? "ok" : "inconsistent",
    summary_he: result.summary_he,
    issues_he: result.consistent ? [] : result.issues_he,
    style_spec: result.style_spec,
    palette: result.palette,
    elements: result.elements.filter((e) => elementIds.has(e.id)),
    inputs_signature: visualLanguageSignature({
      colors,
      elements: elementRows.map((r) => ({ id: r.id, description: description(r) })),
      examples: exampleRows.map((r) => ({ id: r.id })),
    }),
    ...(unreadableLinks.length ? { unreadable_links: unreadableLinks } : {}),
    analyzed_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from("users")
    .update({ visual_language: visualLanguage } as never)
    .eq("id", user.id)
  if (error) {
    console.error("[visual-language][save]", error)
    return NextResponse.json({ error: "save_failed", message: "הניתוח הצליח אבל לא נשמר. נסו שוב." }, { status: 500 })
  }

  return NextResponse.json({ visual_language: visualLanguage })
}
