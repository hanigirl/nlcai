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

    const zip = new JSZip()
    images.forEach((base64, i) => {
      const slideNum = String(i + 1).padStart(2, "0")
      zip.file(`slide-${slideNum}.png`, base64, { base64: true })
    })

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
