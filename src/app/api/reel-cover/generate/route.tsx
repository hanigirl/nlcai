import { NextRequest, NextResponse } from "next/server"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import type { BrandStyle } from "@/lib/supabase/types"

const COVER_WIDTH = 1080
const COVER_HEIGHT = 1920 // 9:16 aspect ratio

const DEFAULT_BRAND_STYLE: BrandStyle = {
  font_name: "Rubik",
  font_size_px: 72,
  font_weight: "bold",
  text_color: "#FFFFFF",
  text_position: "bottom-center",
  text_size: "large",
  text_direction: "rtl",
  text_shadow: true,
  text_shadow_color: "rgba(0,0,0,0.5)",
  line_height: 1.0,
  letter_spacing: 0,
  text_align: "center",
  avg_words_per_line: 2,
  overlay_style: "gradient",
  overlay_opacity: 0.3,
  overlay_color: "#000000",
  overlay_gradient_direction: "bottom-to-top",
  overlay_gradient_from: "#000000",
  overlay_gradient_to: "#000000",
  has_text_background: false,
  has_recurring_elements: false,
}

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

// Satori reverses Hebrew characters — reverse them back per word
function fixWordForSatori(word: string): string {
  return [...word].reverse().join("")
}

function hexToRgb(hex: string) {
  const c = hex.replace("#", "")
  return {
    r: parseInt(c.slice(0, 2), 16) || 0,
    g: parseInt(c.slice(2, 4), 16) || 0,
    b: parseInt(c.slice(4, 6), 16) || 0,
  }
}

function getGradientDirection(dir?: string): string {
  switch (dir) {
    case "bottom-to-top": return "to top"
    case "top-to-bottom": return "to bottom"
    case "left-to-right": return "to right"
    case "right-to-left": return "to left"
    default: return "to top"
  }
}

function renderCover(
  title: string,
  style: BrandStyle,
  variation: number,
  thumbnailBase64?: string,
): React.ReactElement {
  const positionStyles = getTextPositionStyles(style.text_position)
  const fontSize = style.font_size_px || getTextSize(style.text_size)
  const fontWeight = getFontWeight(style.font_weight)
  const isRtl = style.text_direction === "rtl"
  const words = title.split(" ")

  const overlayOpacity = style.overlay_opacity
  const { r, g, b } = hexToRgb(style.overlay_color || "#000000")

  // Text shadow
  const textShadow = style.text_shadow
    ? `2px 2px 8px ${style.text_shadow_color || "rgba(0,0,0,0.6)"}`
    : undefined

  // Word spacing based on font size
  const wordGap = Math.max(10, Math.round(fontSize * 0.22))

  // Overlay rendering
  const renderOverlay = () => {
    if (style.overlay_style === "none" || !thumbnailBase64) return null

    if (style.overlay_style === "gradient" && style.overlay_gradient_from) {
      const fromRgb = hexToRgb(style.overlay_gradient_from)
      const toRgb = hexToRgb(style.overlay_gradient_to || style.overlay_gradient_from)
      const dir = getGradientDirection(style.overlay_gradient_direction)
      return (
        <div
          style={{
            position: "absolute", top: 0, left: 0,
            width: COVER_WIDTH, height: COVER_HEIGHT,
            backgroundImage: `linear-gradient(${dir}, rgba(${fromRgb.r},${fromRgb.g},${fromRgb.b},${overlayOpacity}) 0%, rgba(${toRgb.r},${toRgb.g},${toRgb.b},0) 100%)`,
          }}
        />
      )
    }

    return (
      <div
        style={{
          position: "absolute", top: 0, left: 0,
          width: COVER_WIDTH, height: COVER_HEIGHT,
          backgroundColor: `rgba(${r},${g},${b},${overlayOpacity})`,
        }}
      />
    )
  }

  // Text background (pill/box)
  const textBgStyle = style.has_text_background && style.text_background_color
    ? {
        backgroundColor: style.text_background_color,
        padding: "24px 40px",
        borderRadius: `${style.text_background_border_radius ?? 16}px`,
        opacity: style.text_background_opacity ?? 1,
      }
    : {}

  const hasTextBg = style.has_text_background && style.text_background_color

  return (
    <div style={{ display: "flex", width: COVER_WIDTH, height: COVER_HEIGHT, position: "relative" }}>
      {/* Background */}
      {thumbnailBase64 ? (
        <img
          src={thumbnailBase64}
          style={{ position: "absolute", top: 0, left: 0, width: COVER_WIDTH, height: COVER_HEIGHT, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            position: "absolute", top: 0, left: 0,
            width: COVER_WIDTH, height: COVER_HEIGHT,
            backgroundImage: "linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          }}
        />
      )}

      {/* Overlay */}
      {renderOverlay()}

      {/* Text layer */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          top: 0, left: 0,
          width: COVER_WIDTH,
          height: COVER_HEIGHT,
          padding: "60px",
          ...positionStyles,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            flexDirection: isRtl ? "row-reverse" : "row",
            maxWidth: "900px",
            justifyContent: (style.text_align || "center") === "center" ? "center" : (style.text_align === "left" ? "flex-end" : "flex-start"),
            ...textBgStyle,
          }}
        >
          {words.map((w, i) => (
            <span
              key={i}
              style={{
                color: style.text_color,
                fontSize,
                fontWeight,
                fontFamily: "Rubik",
                lineHeight: style.line_height || 1.0,
                letterSpacing: `${style.letter_spacing ?? 0}em`,
                marginLeft: isRtl ? `${wordGap}px` : "0",
                marginRight: isRtl ? "0" : `${wordGap}px`,
                ...(textShadow ? { textShadow } : {}),
              }}
            >
              {isRtl ? fixWordForSatori(w) : w}
            </span>
          ))}
        </div>
        {/* Accent underline if accent color exists and no text background */}
        {!hasTextBg && style.accent_color && (
          <div
            style={{
              width: "120px",
              height: "6px",
              backgroundColor: style.accent_color,
              borderRadius: "3px",
              marginTop: "16px",
              ...(isRtl ? { alignSelf: "flex-end" } : {}),
            }}
          />
        )}
      </div>
    </div>
  ) as React.ReactElement
}

export async function POST(req: NextRequest) {
  try {
    const { thumbnail_url, title } = (await req.json()) as {
      thumbnail_url?: string
      title: string
    }

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user's brand style — required
    const { data: userData } = await supabase
      .from("users")
      .select("brand_style")
      .eq("id", user.id)
      .single()

    const brandStyle = (userData as Record<string, unknown> | null)?.brand_style as BrandStyle | null
    if (!brandStyle) {
      return NextResponse.json({ error: "no_brand_style" }, { status: 400 })
    }
    const style = brandStyle

    // Fetch thumbnail if provided (supports data URLs and regular URLs)
    let thumbBase64: string | undefined
    if (thumbnail_url) {
      if (thumbnail_url.startsWith("data:")) {
        thumbBase64 = thumbnail_url
      } else {
        try {
          const thumbRes = await fetch(thumbnail_url)
          if (thumbRes.ok) {
            const thumbBuffer = Buffer.from(await thumbRes.arrayBuffer())
            thumbBase64 = `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`
          }
        } catch {
          // Continue without thumbnail
        }
      }
    }

    const [fontData, boldFontData] = await Promise.all([loadFont(), loadBoldFont()])

    // Generate 1 cover
    const covers: string[] = []
    {
      const element = renderCover(title, style, 0, thumbBase64)

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
