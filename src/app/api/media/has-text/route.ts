import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { imageHasBakedText } from "@/lib/baked-text"
import { qaFixes1112 } from "@/lib/feature-access"

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

  // The rule (Hani, 2026-11-12, gated until launch): her media ALWAYS gets
  // the script's text — text already on her picture is hers to avoid
  // ("אנחנו רק נוסיף טקסט" says so up front). No guess, which once skipped
  // a whole set.
  if (qaFixes1112(user.email)) return NextResponse.json({ hasText: false })

  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return NextResponse.json({ hasText: null })
  }
  return NextResponse.json({ hasText: await imageHasBakedText(apiKey, imageBase64) })
}
