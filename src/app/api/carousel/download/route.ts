import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"

export async function POST(req: NextRequest) {
  try {
    const { images } = (await req.json()) as { images: string[] }

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "images array is required" },
        { status: 400 },
      )
    }

    // A saved carousel reaches the panel as storage URLs (the post loads them
    // that way, and the AI edit panel hands them back that way), a fresh
    // generation as base64. Zipping a URL string "as base64" produced a broken
    // archive, so URLs are fetched — only from our own storage, never an
    // arbitrary host.
    const storageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : null
    const zip = new JSZip()
    for (const [i, item] of images.entries()) {
      const slideNum = String(i + 1).padStart(2, "0")
      if (/^https?:/.test(item)) {
        if (!storageOrigin || new URL(item).origin !== storageOrigin) {
          return NextResponse.json({ error: "unsupported image url" }, { status: 400 })
        }
        const res = await fetch(item)
        if (!res.ok) throw new Error(`slide ${i + 1}: status ${res.status}`)
        // A video slide (Hani, 2026-11-06) goes in as the mp4 itself.
        const isVideo =
          /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(item) || (res.headers.get("content-type") ?? "").startsWith("video/")
        zip.file(`slide-${slideNum}.${isVideo ? "mp4" : "png"}`, await res.arrayBuffer())
      } else {
        zip.file(`slide-${slideNum}.png`, item.replace(/^data:[^,]*,/, ""), { base64: true })
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" })

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="carousel.zip"',
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Failed to create ZIP: ${msg}` },
      { status: 500 },
    )
  }
}
