"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { COVER_FALLBACK_COLOR, cleanBrandColors, defaultCoverColor } from "@/lib/cover-brand-color"

/**
 * Her brand colours for the cover picker, read once per page load.
 *
 * `enabled=false` (production today, until a variant ships) returns an empty
 * list and never queries — so the cover keeps defaulting to black exactly as
 * before. `ready` flips once the read settles, so a caller can wait for it
 * before baking the first cover.
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

export function useCoverBrandColors(enabled: boolean): { colors: string[]; ready: boolean } {
  const [colors, setColors] = useState<string[]>([])
  const [ready, setReady] = useState(!enabled)
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
 * Design review gate: the brand default runs only under ?thcover=a|b, so the
 * page without the param stays exactly as in production. Returns the variant
 * or null.
 */
export function readThCoverVariant(params: URLSearchParams | { get(k: string): string | null }): "a" | "b" | null {
  const v = params.get("thcover")
  return v === "a" || v === "b" ? v : null
}

/** The cover's default pill colour for this page: brand under review, else black. */
export function useCoverDefaultColor(): string {
  const params = useSearchParams()
  const { colors } = useCoverBrandColors(readThCoverVariant(params) !== null)
  return colors.length ? defaultCoverColor(colors) : COVER_FALLBACK_COLOR
}
