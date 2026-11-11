"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { buildBrandTemplate, type TemplateConfig } from "@/lib/carousel-templates"
import type { VisualLanguage } from "@/lib/visual-language/types"

/**
 * The per-user "השפה הוויזואלית שלך" carousel template, or null when she has
 * no consistent visual language. Its tile shows one of her own carousel
 * examples when the analysis recognised one; otherwise a mini-mock in her
 * colours.
 */
export function useBrandCarouselTemplate(): TemplateConfig | null {
  return useBrandCarouselTemplateState().template
}

/**
 * Same, plus whether it's still being looked up — so a picker can hold a
 * place for it instead of looking like she has no visual language.
 */
export function useBrandCarouselTemplateState(): { template: TemplateConfig | null; loading: boolean } {
  const [template, setTemplate] = useState<TemplateConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    getCurrentUser(supabase).then(async ({ data: { user } }) => {
      if (!user) {
        if (!cancelled) setLoading(false)
        return
      }
      const { data, error } = await supabase
        .from("users")
        .select("visual_language")
        .eq("id", user.id)
        .single()
      if (error) console.error("[brand-carousel-template]", error)
      const vl = (data as { visual_language?: VisualLanguage | null } | null)?.visual_language
      if (!vl || vl.status !== "ok") {
        if (!cancelled) setLoading(false)
        return
      }

      let thumbnailUrl: string | undefined
      // A carousel she filed herself (Settings → דוגמאות לשימוש) beats the
      // analysis's guess, which may predate the filing.
      const { data: filed } = await supabase
        .from("user_media")
        .select("storage_path")
        .eq("user_id", user.id)
        .eq("category", "brand_example")
        .eq("metadata->>kind", "carousel")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      const carouselExampleId = vl.example_kinds?.find((k) => k.kind === "carousel")?.id
      if (filed || carouselExampleId) {
        const { data: row } = filed
          ? { data: filed }
          : await supabase
              .from("user_media")
              .select("storage_path")
              .eq("id", carouselExampleId!)
              .maybeSingle()
        const path = (row as { storage_path?: string } | null)?.storage_path
        if (path && !path.startsWith("url:")) {
          thumbnailUrl = supabase.storage.from("user-media").getPublicUrl(path).data.publicUrl
        }
      }

      if (cancelled) return
      setTemplate(
        buildBrandTemplate({
          thumbnailUrl,
          preview: vl.preview
            ? {
                bg: vl.preview.bg,
                accent: vl.preview.accent,
                titleColor: vl.preview.title,
                bodyColor: vl.preview.body,
              }
            : undefined,
        }),
      )
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { template, loading }
}
