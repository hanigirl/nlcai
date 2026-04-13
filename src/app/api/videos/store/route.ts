import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Downloads a video from a URL and stores it in Supabase Storage
export async function POST(req: NextRequest) {
  try {
    const { video_url } = await req.json()
    if (!video_url) {
      return NextResponse.json({ error: "video_url is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Download the video
    const res = await fetch(video_url)
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to download video" }, { status: 400 })
    }

    const videoBuffer = await res.arrayBuffer()
    const storagePath = `${user.id}/video/${crypto.randomUUID()}.mp4`

    const { error: uploadError } = await supabase.storage
      .from("user-media")
      .upload(storagePath, videoBuffer, { contentType: "video/mp4" })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const publicUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl

    return NextResponse.json({ url: publicUrl, storage_path: storagePath })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
