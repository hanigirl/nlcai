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
  const [template, setTemplate] = useState<TemplateConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    getCurrentUser(supabase).then(async ({ data: { user } }) => {
      if (!user) return
      const { data, error } = await supabase
        .from("users")
        .select("visual_language")
        .eq("id", user.id)
        .single()
      if (error) console.error("[brand-carousel-template]", error)
      const vl = (data as { visual_language?: VisualLanguage | null } | null)?.visual_language
      if (!vl || vl.status !== "ok") return

      let thumbnailUrl: string | undefined
      const carouselExampleId = vl.example_kinds?.find((k) => k.kind === "carousel")?.id
      if (carouselExampleId) {
        const { data: row } = await supabase
          .from("user_media")
          .select("storage_path")
          .eq("id", carouselExampleId)
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
    })
    return () => {
      cancelled = true
    }
  }, [])

  return template
}
