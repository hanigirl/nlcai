import { NextRequest, NextResponse } from "next/server"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { getTemplate } from "@/lib/carousel-templates"
import type { SlideData } from "@/lib/carousel-templates"

const SLIDE_SIZE = 1080

// Cache font data in module scope
let fontDataCache: ArrayBuffer | null = null

async function loadFont(): Promise<ArrayBuffer> {
  if (fontDataCache) return fontDataCache

  // Try loading local font first
  const fs = await import("fs/promises")
  const path = await import("path")
  const localPath = path.join(process.cwd(), "public", "fonts", "Rubik-Regular.ttf")

  try {
    const buffer = await fs.readFile(localPath)
    fontDataCache = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    )
    return fontDataCache
  } catch {
    // Fallback: fetch from Google Fonts
    const res = await fetch(
      "https://fonts.googleapis.com/css2?family=Rubik:wght@400;600;700&display=swap",
    )
    const css = await res.text()
    const urlMatch = css.match(/src:\s*url\(([^)]+)\)/)
    if (!urlMatch) throw new Error("Could not find font URL in Google Fonts CSS")

    const fontRes = await fetch(urlMatch[1])
    fontDataCache = await fontRes.arrayBuffer()
    return fontDataCache
  }
}

// Cache bold font data
let boldFontCache: ArrayBuffer | null = null

async function loadBoldFont(): Promise<ArrayBuffer> {
  if (boldFontCache) return boldFontCache

  const fs = await import("fs/promises")
  const path = await import("path")
  const localPath = path.join(process.cwd(), "public", "fonts", "Rubik-Bold.ttf")

  try {
    const buffer = await fs.readFile(localPath)
    boldFontCache = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    )
    return boldFontCache
  } catch {
    // Fallback: fetch bold weight from Google Fonts
    const res = await fetch(
      "https://fonts.googleapis.com/css2?family=Rubik:wght@700&display=swap",
    )
    const css = await res.text()
    const urlMatch = css.match(/src:\s*url\(([^)]+)\)/)
    if (!urlMatch) throw new Error("Could not find bold font URL")

    const fontRes = await fetch(urlMatch[1])
    boldFontCache = await fontRes.arrayBuffer()
    return boldFontCache
  }
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

    const [fontData, boldFontData] = await Promise.all([
      loadFont(),
      loadBoldFont(),
    ])

    const pngBuffers: string[] = []

    for (let i = 0; i < slides.length; i++) {
      const element = template.render(slides[i], i, slides.length)

      const svg = await satori(element as React.ReactElement, {
        width: SLIDE_SIZE,
        height: SLIDE_SIZE,
        fonts: [
          {
            name: "Rubik",
            data: fontData,
            weight: 400,
            style: "normal",
          },
          {
            name: "Rubik",
            data: boldFontData,
            weight: 700,
            style: "normal",
          },
        ],
      })

      const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: SLIDE_SIZE },
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
