import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { examplesInLanguage } from "@/lib/feature-access"
import { checkExampleFit } from "@/lib/agents/example-fit"
import { loadImageForModels } from "@/lib/visual-language/image-input"
import type { VisualLanguage } from "@/lib/visual-language/types"

export const maxDuration = 30

/**
 * Settings → שפה ויזואלית → דוגמאות לשימוש: right after an upload, is this
 * example in her language? (lib/agents/example-fit, gated
 * EXAMPLES_IN_LANGUAGE_EMAILS). The verdict is kept on the example's
 * metadata. No analysed language yet, a link, or a check slower than 10s →
 * { fit: null }: nothing is marked and the next analysis decides.
 *
 * POST { id } → { fit: "ok" | "mismatch" | null, reason?: string, ms: number }
 */
export async function POST(req: Request) {
  const started = Date.now()
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!examplesInLanguage(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 })

  const [{ data: row }, { data: me }] = await Promise.all([
    supabase
      .from("user_media")
      .select("id, storage_path, metadata")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("category", "brand_example")
      .maybeSingle(),
    supabase.from("users").select("brand_colors, visual_language").eq("id", user.id).single(),
  ])
  const example = row as { id: string; storage_path: string; metadata: Record<string, unknown> | null } | null
  if (!example) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const profile = me as { brand_colors?: string[] | null; visual_language?: VisualLanguage | null } | null
  const language = profile?.visual_language
  const skip = () => NextResponse.json({ fit: null, ms: Date.now() - started })
  // Nothing to compare with yet — her examples will shape the language.
  if (!language || language.status !== "ok" || !language.style_spec?.trim()) return skip()
  if (example.storage_path.startsWith("url:") || typeof example.metadata?.url === "string") return skip()

  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return skip()
  }
  const image = await loadImageForModels(
    supabase.storage.from("user-media").getPublicUrl(example.storage_path).data.publicUrl,
  ).catch(() => null)
  if (!image) return skip()

  const verdict = await checkExampleFit(apiKey, { colors: profile?.brand_colors ?? [], language, image })
  if (!verdict) return skip()

  const fit = verdict.fits ? "ok" : "mismatch"
  const { error } = await supabase
    .from("user_media")
    .update({ metadata: { ...(example.metadata ?? {}), fit, fit_reason: verdict.reason_he } } as never)
    .eq("id", example.id)
  if (error) console.error("[visual-language][check-example]", error)
  return NextResponse.json({ fit, reason: verdict.reason_he || undefined, ms: Date.now() - started })
}
