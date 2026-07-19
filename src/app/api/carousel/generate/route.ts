import { NextRequest, NextResponse } from "next/server"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { getTemplate, SLIDE_SIZE } from "@/lib/carousel-templates"
import type { SlideData } from "@/lib/carousel-templates"

// Source of truth for families/weights available to satori templates. A
// fontWeight used in template JSX that is NOT registered here silently
// snaps to the nearest registered weight — keep this map in sync with the
// carousel-design skill.
const FONT_FILES: Record<string, Record<number, string>> = {
  Rubik: {
    400: "Rubik-Regular.ttf",
    500: "Rubik-Medium.ttf",
    600: "Rubik-SemiBold.ttf",
    700: "Rubik-Bold.ttf",
    800: "Rubik-ExtraBold.ttf",
  },
  Heebo: {
    400: "Heebo-Regular.ttf",
    700: "Heebo-Bold.ttf",
    900: "Heebo-Black.ttf",
  },
}

// Fonts we fall back to Google Fonts for if the local file is missing.
// All other entries just get skipped when unavailable.
const REQUIRED = new Set(["Rubik:400", "Rubik:700"])

// Cache font data in module scope, keyed by "Family:weight"
const fontCache = new Map<string, ArrayBuffer>()

async function loadFont(
  family: string,
  weight: number,
): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`
  const cached = fontCache.get(key)
  if (cached) return cached

  const fs = await import("fs/promises")
  const path = await import("path")
  const localPath = path.join(
    process.cwd(),
    "public",
    "fonts",
    FONT_FILES[family][weight],
  )

  try {
    const buffer = await fs.readFile(localPath)
    const data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    )
    fontCache.set(key, data)
    return data
  } catch {
    if (!REQUIRED.has(key)) return null

    // Fallback: fetch from Google Fonts
    const res = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`,
    )
    const css = await res.text()
    const urlMatch = css.match(/src:\s*url\(([^)]+)\)/)
    if (!urlMatch)
      throw new Error(`Could not find font URL for ${family} ${weight}`)

    const fontRes = await fetch(urlMatch[1])
    const data = await fontRes.arrayBuffer()
    fontCache.set(key, data)
    return data
  }
}

async function loadFonts() {
  const entries = Object.entries(FONT_FILES).flatMap(([family, weights]) =>
    Object.keys(weights).map((w) => ({ family, weight: Number(w) })),
  )
  const loaded = await Promise.all(
    entries.map(async ({ family, weight }) => ({
      family,
      weight,
      data: await loadFont(family, weight),
    })),
  )
  return loaded
    .filter(
      (f): f is { family: string; weight: number; data: ArrayBuffer } =>
        f.data !== null,
    )
    .map((f) => ({
      name: f.family,
      data: f.data,
      weight: f.weight as 400 | 500 | 600 | 700 | 800 | 900,
      style: "normal" as const,
    }))
}

export async function POST(req: NextRequest) {
  try {
    const { slides, templateId = "default" } = (await req.json()) as {
      slides: SlideData[]
      templateId?: string
    }

    if (!slides || !Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json(
        { error: "slides array is required" },
        { status: 400 },
      )
    }

    const template = getTemplate(templateId)
    if (!template) {
      return NextResponse.json(
        { error: `Template "${templateId}" not found` },
        { status: 400 },
      )
    }
    if (template.kind === "ai" || !template.render) {
      return NextResponse.json(
        { error: `Template "${templateId}" is AI-based — use /api/carousel/generate-ai` },
        { status: 400 },
      )
    }

    const fonts = await loadFonts()

    const width = template.size?.width ?? SLIDE_SIZE
    const height = template.size?.height ?? SLIDE_SIZE

    const pngBuffers: string[] = []

    for (let i = 0; i < slides.length; i++) {
      const element = template.render(slides[i], i, slides.length)

      const svg = await satori(element as React.ReactElement, {
        width,
        height,
        fonts,
      })

      const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: width },
      })
      const pngData = resvg.render()
      const pngBuffer = pngData.asPng()
      pngBuffers.push(Buffer.from(pngBuffer).toString("base64"))
    }

    return NextResponse.json({ images: pngBuffers })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Carousel generation error:", msg)
    return NextResponse.json(
      { error: `Failed to generate carousel: ${msg}` },
      { status: 500 },
    )
  }
}
