import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canPreviewMediaCredits } from "@/lib/owner"

// "Does this user have an OpenAI key on file?" — a boolean, nothing more. The
// key itself never leaves the server (the media panel only needs to know
// whether to offer AI generation at all).
//
// Why the panel asks up front instead of just letting the request fail: the
// OpenAI key is optional in onboarding, so a student can arrive at the media
// panel with no image model connected. Without this check they'd press
// "יצירת תמונה עם AI", wait, and get an error toast — the button was never
// going to work. With it, they get the "connect credits" card instead.
export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The "connect credits" card is limited to one reviewer for now. Everyone
  // else gets `previewEnabled: false` and the panel behaves exactly as it did
  // before this feature existed — so we don't even need to read their key.
  const previewEnabled = canPreviewMediaCredits(user.email)
  if (!previewEnabled) {
    return NextResponse.json({ connected: true, previewEnabled: false })
  }

  const { data, error } = await supabase
    .from("users")
    .select("openai_api_key")
    .eq("id", user.id)
    .maybeSingle<{ openai_api_key: string | null }>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const key = data?.openai_api_key
  return NextResponse.json({
    connected: typeof key === "string" && key.trim().length > 0,
    previewEnabled: true,
  })
}
