import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { CanvaError, exportDesignPng, isCanvaConfigured, resolveCanvaDesignId } from "@/lib/canva"

// Export a Canva design (page 1, PNG) and store it in Supabase Storage — the
// Canva counterpart of /api/media/from-drive. The copy is the point: Canva's
// export URL dies after 24h, ours doesn't, so the post keeps its image even
// if the user later disconnects Canva or deletes the design.
//
// `not_connected` is an expected answer, not a failure: the panel turns it
// into the "חיבור לקנבה" button.

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string }
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isCanvaConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 })
  }

  const designId = await resolveCanvaDesignId(url.trim())
  if (!designId) {
    return NextResponse.json({ error: "invalid_canva_link" }, { status: 400 })
  }

  try {
    const bytes = await exportDesignPng(user.id, designId)
    const storagePath = `${user.id}/image/${crypto.randomUUID()}.png`
    const { error: uploadError } = await supabase.storage
      .from("user-media")
      .upload(storagePath, bytes, { contentType: "image/png" })
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }
    const publicUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl
    return NextResponse.json({ url: publicUrl, kind: "image" })
  } catch (err) {
    if (err instanceof CanvaError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.code === "not_connected" ? 401 : 400 },
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[media/from-canva]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
