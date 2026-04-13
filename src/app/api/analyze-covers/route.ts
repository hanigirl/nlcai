import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { analyzeBrandStyle } from "@/lib/agents/brand-style-analyzer"

export async function POST(req: Request) {
  const supabase = await createClient()

  let apiKey: string
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 401 })
  }

  const { images } = await req.json()
  if (!images || !Array.isArray(images) || images.length < 3) {
    return NextResponse.json({ error: "At least 3 images required" }, { status: 400 })
  }

  try {
    const brandStyle = await analyzeBrandStyle(apiKey, images)

    // Save to user's profile
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from("users")
        .update({ brand_style: brandStyle } as never)
        .eq("id", user.id)
    }

    return NextResponse.json({ brand_style: brandStyle })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
