"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { COVER_FALLBACK_COLOR, cleanBrandColors, defaultCoverColor } from "@/lib/cover-brand-color"
import { usePreviewAccess } from "@/lib/use-scheduling-access"

/**
 * Her brand colours for the talking-head cover, read once per page load
 * (`users.brand_colors`, the colours she set in Settings → שפה ויזואלית).
 * `ready` flips once the read settles, so a caller can wait for it before
 * adopting the default.
 */
let cache: Promise<string[]> | null = null

function loadBrandColors(): Promise<string[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data: { user } } = await getCurrentUser(supabase)
    if (!user) return []
    const { data, error } = await supabase.from("users").select("brand_colors").eq("id", user.id).single()
    if (error) {
      console.error("[cover-brand-colors][load]", error)
      return []
    }
    return cleanBrandColors((data as { brand_colors?: unknown } | null)?.brand_colors)
  })().catch((err) => {
    console.error("[cover-brand-colors][load]", err)
    cache = null
    return []
  })
  return cache
}

/** `enabled: false` (outside Hani's preview batch) reads nothing and stays not-ready. */
export function useCoverBrandColors(enabled = true): { colors: string[]; ready: boolean } {
  const [colors, setColors] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadBrandColors().then((c) => {
      if (!alive) return
      setColors(c)
      setReady(true)
    })
    return () => { alive = false }
  }, [enabled])
  return { colors, ready }
}

/**
 * The cover's default pill colour: her primary brand colour, else black.
 * Outside the preview batch (and while the gate loads): black, as before.
 */
export function useCoverDefaultColor(): string {
  const preview = usePreviewAccess() === true
  const { colors } = useCoverBrandColors(preview)
  return preview && colors.length ? defaultCoverColor(colors) : COVER_FALLBACK_COLOR
}
