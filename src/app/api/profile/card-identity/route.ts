import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canCopyStructure } from "@/lib/feature-access"
import { saveCardIdentity } from "@/lib/card-identity"

/**
 * POST { name?, handle?, avatarUrl? } → { identity }
 * What she gave the AI panel for a card's personal elements (lib/card-identity)
 * — kept, so she isn't asked again. avatarUrl: her own storage only.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canCopyStructure(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; handle?: unknown; avatarUrl?: unknown }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const mine = base ? `${new URL(base).origin}/storage/v1/object/public/user-media/${user.id}/` : null
  const avatarUrl = typeof body.avatarUrl === "string" && mine && body.avatarUrl.startsWith(mine) ? body.avatarUrl : undefined
  try {
    const identity = await saveCardIdentity(supabase, user.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      handle: typeof body.handle === "string" ? body.handle : undefined,
      avatarUrl,
    })
    return NextResponse.json({ identity })
  } catch (err) {
    console.error("[profile/card-identity]", err)
    return NextResponse.json({ error: "save_failed", message: "לא הצלחתי לשמור את הפרטים. נסו שוב." }, { status: 500 })
  }
}
