import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { canUsePreview } from "@/lib/scheduling-access"
import { getUserApiKey } from "@/lib/api-keys"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { forgetStyleRule, saveInstructionAsRule } from "@/lib/style-memory"

/**
 * The "לשמור לשפה הוויזואלית שלי" chip in the AI-edit panel (Hani, 2026-10-29).
 *
 * POST   { instruction, format } → { summary }   keep this edit as a standing preference
 * DELETE { summary }             → { removed }   undo: drop the rule she was just shown
 *
 * Rules live in lib/style-memory, the same store the AI edits already learn
 * into, so every generator picks them up the same way.
 */

const SOURCE: Record<string, string> = {
  b_roll: "b-roll",
  carousel: "carousel slide",
  story: "Instagram story frame",
  image_post: "single image post",
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canUsePreview(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as { instruction?: string; format?: string }
  const instruction = body.instruction?.trim()
  if (!instruction) return NextResponse.json({ error: "missing_instruction" }, { status: 400 })

  try {
    const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    const rule = await saveInstructionAsRule(
      supabase,
      user.id,
      anthropicKey,
      instruction,
      SOURCE[body.format ?? ""] ?? "design",
    )
    return NextResponse.json({ summary: rule.summary_he })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[visual-language/style-memory]", msg)
    if (msg === "anthropic_not_connected") {
      return NextResponse.json(
        { error: msg, message: "כדי לשמור לשפה הוויזואלית צריך לחבר מפתח Claude בהגדרות." },
        { status: 400 },
      )
    }
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canUsePreview(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as { summary?: string }
  if (!body.summary?.trim()) return NextResponse.json({ error: "missing_summary" }, { status: 400 })
  try {
    const removed = await forgetStyleRule(supabase, user.id, body.summary)
    return NextResponse.json({ removed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[visual-language/style-memory] undo", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
