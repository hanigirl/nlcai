import type { SupabaseClient } from "@supabase/supabase-js"
import { loadBrandFonts } from "@/lib/broll-animation/brief"

/**
 * The reel cover's font (Hani, 2026-11-07): the font her cover examples were
 * read as, else her visual language's primary font, else Rubik (null here —
 * the renderer's default). Loaded as font data for satori: a TTF / OTF / WOFF
 * file (satori can't read WOFF2), Google fonts through their TTF stylesheet.
 */
export type CoverFont = { name: string; data: ArrayBuffer }

const SATORI_OK = /\.(ttf|otf|woff)(\?|$)/i

async function fetchData(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

/** A Google font family at a heavy weight, as TTF (an old UA gets truetype URLs). */
async function googleFont(family: string): Promise<ArrayBuffer | null> {
  const name = encodeURIComponent(family).replace(/%20/g, "+")
  // Heaviest first; a family with one weight only answers the plain request.
  for (const q of [`${name}:wght@800`, `${name}:wght@700`, name]) {
    try {
      const css = await fetch(`https://fonts.googleapis.com/css2?family=${q}`, {
        headers: { "User-Agent": "Wget/1.21" },
        signal: AbortSignal.timeout(8000),
      })
      if (!css.ok) continue
      const url = /url\((https:[^)]+\.ttf)\)/.exec(await css.text())?.[1]
      if (url) return fetchData(url)
    } catch {
      // next
    }
  }
  return null
}

export async function loadCoverFont(
  supabase: SupabaseClient,
  userId: string,
  fromExamples?: string | null,
): Promise<CoverFont | null> {
  const wanted = fromExamples?.trim()
  if (wanted && !/^rubik$/i.test(wanted)) {
    const data = await googleFont(wanted)
    if (data) return { name: wanted, data }
  }
  const fonts = await loadBrandFonts(supabase, userId).catch(() => [])
  const primary = fonts.find((f) => f.role !== "secondary") ?? fonts[0]
  if (!primary || /^rubik$/i.test(primary.family)) return null
  const data = primary.kind === "google" ? await googleFont(primary.family) : SATORI_OK.test(primary.url) ? await fetchData(primary.url) : null
  return data ? { name: primary.family, data } : null
}
