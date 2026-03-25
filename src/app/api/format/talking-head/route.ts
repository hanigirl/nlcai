import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { corePostText } = await req.json()

    if (!corePostText) {
      return NextResponse.json({ error: "corePostText is required" }, { status: 400 })
    }

    return NextResponse.json({ text: corePostText })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Talking head error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
