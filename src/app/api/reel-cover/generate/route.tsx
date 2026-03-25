import { NextRequest, NextResponse } from "next/server"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import type { BrandStyle } from "@/lib/supabase/types"

const COVER_WIDTH = 1080
const COVER_HEIGHT = 1920 // 9:16 aspect ratio

// Reuse font cache from carousel pipeline
let fontDataCache: ArrayBuffer | null = null
let boldFontCache: ArrayBuffer | null = null

async function loadFont(): Promise<ArrayBuffer> {
  if (fontDataCache) return fontDataCache
  const fs = await import("fs/promises")
  const path = await import("path")
  const localPath = path.join(process.cwd(), "public", "fonts", "Rubik-Regular.ttf")
  try {
    const buffer = await fs.readFile(localPath)
    fontDataCache = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return fontDataCache
  } catch {
    const res = await fetch("https://fonts.googleapis.com/css2?family=Rubik:wght@400;600;700&display=swap")
    const css = await res.text()
    const urlMatch = css.match(/src:\s*url\(([^)]+)\)/)
    if (!urlMatch) throw new Error("Could not find font URL")
    const fontRes = await fetch(urlMatch[1])
    fontDataCache = await fontRes.arrayBuffer()
    return fontDataCache
  }
}

async function loadBoldFont(): Promise<ArrayBuffer> {
  if (boldFontCache) return boldFontCache
  const fs = await import("fs/promises")
  const path = await import("path")
  const localPath = path.join(process.cwd(), "public", "fonts", "Rubik-Bold.ttf")
  try {
    const buffer = await fs.readFile(localPath)
    boldFontCache = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return boldFontCache
  } catch {
    const res = await fetch("https://fonts.googleapis.com/css2?family=Rubik:wght@700&display=swap")
    const css = await res.text()
    const urlMatch = css.match(/src:\s*url\(([^)]+)\)/)
    if (!urlMatch) throw new Error("Could not find bold font URL")
    const fontRes = await fetch(urlMatch[1])
    boldFontCache = await fontRes.arrayBuffer()
    return boldFontCache
  }
}

function getTextPositionStyles(position: BrandStyle["text_position"]) {
  switch (position) {
    case "center":
      return { justifyContent: "center", alignItems: "center" } as const
    case "bottom-center":
      return { justifyContent: "flex-end", alignItems: "center", paddingBottom: "120px" } as const
    case "top":
      return { justifyContent: "flex-start", alignItems: "center", paddingTop: "120px" } as const
    case "bottom-left":
      return { justifyContent: "flex-end", alignItems: "flex-start", paddingBottom: "120px", paddingLeft: "60px" } as const
    case "bottom-right":
      return { justifyContent: "flex-end", alignItems: "flex-end", paddingBottom: "120px", paddingRight: "60px" } as const
    case "top-left":
      return { justifyContent: "flex-start", alignItems: "flex-start", paddingTop: "120px", paddingLeft: "60px" } as const
    case "top-right":
      return { justifyContent: "flex-start", alignItems: "flex-end", paddingTop: "120px", paddingRight: "60px" } as const
    default:
      return { justifyContent: "flex-end", alignItems: "center", paddingBottom: "120px" } as const
  }
}

function getTextSize(size: BrandStyle["text_size"]): number {
  switch (size) {
    case "large": return 72
    case "medium": return 56
    case "small": return 44
    default: return 56
  }
}

function getFontWeight(weight: BrandStyle["font_weight"]): number {
  switch (weight) {
    case "bold": return 700
    case "light": return 400
    case "regular": return 400
    default: return 700
  }
}

function renderCover(
  thumbnailBase64: string,
  title: string,
  style: BrandStyle,
  variation: number,
): React.ReactElement {
  const positionStyles = getTextPositionStyles(style.text_position)
  const fontSize = getTextSize(style.text_size)
  const fontWeight = getFontWeight(style.font_weight)

  // Variation tweaks
  const opacityTweak = variation === 0 ? 0 : variation === 1 ? 0.1 : -0.1
  const overlayOpacity = Math.max(0, Math.min(1, style.overlay_opacity + opacityTweak))

  const overlayColor = style.overlay_color || "#000000"
  const r = parseInt(overlayColor.slice(1, 3), 16)
  const g = parseInt(overlayColor.slice(3, 5), 16)
  const b = parseInt(overlayColor.slice(5, 7), 16)

  return (
    <div style={{ display: "flex", width: COVER_WIDTH, height: COVER_HEIGHT, position: "relative" }}>
      {/* Background image */}
      <img
        src={thumbnailBase64}
        style={{ position: "absolute", top: 0, left: 0, width: COVER_WIDTH, height: COVER_HEIGHT, objectFit: "cover" }}
      />
      {/* Overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: COVER_WIDTH,
          height: COVER_HEIGHT,
          backgroundColor: `rgba(${r},${g},${b},${overlayOpacity})`,
        }}
      />
      {/* Text layer */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          top: 0,
          left: 0,
          width: COVER_WIDTH,
          height: COVER_HEIGHT,
          padding: "60px",
          ...positionStyles,
        }}
      >
        {style.has_text_background && style.text_background_color ? (
          <div
            style={{
              display: "flex",
              backgroundColor: style.text_background_color,
              padding: "24px 40px",
              borderRadius: "16px",
            }}
          >
            <span
              style={{
                color: style.text_color,
                fontSize,
                fontWeight,
                fontFamily: "Rubik",
                direction: style.text_direction,
                textAlign: style.text_direction === "rtl" ? "right" : "left",
                lineHeight: 1.4,
              }}
            >
              {title}
            </span>
          </div>
        ) : (
          <span
            style={{
              color: style.text_color,
              fontSize,
              fontWeight,
              fontFamily: "Rubik",
              direction: style.text_direction,
              textAlign: style.text_direction === "rtl" ? "right" : "left",
              lineHeight: 1.4,
              maxWidth: "900px",
            }}
          >
            {title}
          </span>
        )}
      </div>
    </div>
  ) as React.ReactElement
}

export async function POST(req: NextRequest) {
  try {
    const { thumbnail_url, title } = (await req.json()) as {
      thumbnail_url: string
      title: string
    }

    if (!thumbnail_url || !title) {
      return NextResponse.json({ error: "thumbnail_url and title are required" }, { status: 400 })
    }

    // Get user's brand style
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from("users")
      .select("brand_style")
      .eq("id", user.id)
      .single()

    const brandStyle = (userData as Record<string, unknown> | null)?.brand_style as BrandStyle | null
    if (!brandStyle) {
      return NextResponse.json({ error: "No brand style configured. Upload cover examples in Settings." }, { status: 400 })
    }

    // Fetch thumbnail and convert to base64
    const thumbRes = await fetch(thumbnail_url)
    const thumbBuffer = Buffer.from(await thumbRes.arrayBuffer())
    const thumbBase64 = `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`

    const [fontData, boldFontData] = await Promise.all([loadFont(), loadBoldFont()])

    // Generate 3 variations
    const covers: string[] = []
    for (let v = 0; v < 3; v++) {
      const element = renderCover(thumbBase64, title, brandStyle, v)

      const svg = await satori(element, {
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
        fonts: [
          { name: "Rubik", data: fontData, weight: 400, style: "normal" as const },
          { name: "Rubik", data: boldFontData, weight: 700, style: "normal" as const },
        ],
      })

      const resvg = new Resvg(svg, { fitTo: { mode: "width" as const, value: COVER_WIDTH } })
      const pngData = resvg.render()
      covers.push(Buffer.from(pngData.asPng()).toString("base64"))
    }

    return NextResponse.json({ covers })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Reel cover generation error:", msg)
    return NextResponse.json({ error: `Failed to generate cover: ${msg}` }, { status: 500 })
  }
}
