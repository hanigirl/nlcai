import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { imageHasBakedText } from "@/lib/baked-text"

/**
 * POST { imageBase64 } → { hasText: boolean | null }
 *
 * Asked once per carousel the user brings: the cover decides whether the
 * slides are bare pictures (caption them, offer the caption controls) or
 * finished designs (leave them alone). null = couldn't tell.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { imageBase64 } = (await req.json().catch(() => ({}))) as {
    imageBase64?: string
  }
  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 })
  }

  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return NextResponse.json({ hasText: null })
  }
  return NextResponse.json({ hasText: await imageHasBakedText(apiKey, imageBase64) })
}
