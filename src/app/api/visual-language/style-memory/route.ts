import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { parseReferences } from "@/lib/ai-edit-references"
import {
  deleteStyleRule,
  listStyleRules,
  replaceStyleRules,
  toPreference,
  triageVisualMemory,
  updateStyleRule,
} from "@/lib/style-memory"
import { isRuleScope } from "@/lib/visual-memory"
import type { VisualFormat } from "@/lib/visual-language/types"

/**
 * The visual memory of the AI-edit chat (rules: lib/visual-memory).
 *
 * GET                                               → { preferences }   Settings → העדפות ויזואליות
 * POST   { action: "triage", instruction, format, explicit?, previousInstruction?, references? }
 *                                                   → TriageResult      every chat message + the save chip
 * POST   { action: "replace", replaceIds, proposal } → { id, summary, scope }   "באופן רוחבי"
 * PATCH  { id, summary_he }                         → { preference }    edit in the settings tab
 * DELETE { id }                                     → { removed }       "ביטול" in the chat, or the tab
 */

const FORMATS: VisualFormat[] = ["carousel", "story", "image_post", "b_roll"]

function errorResponse(e: unknown, where: string) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(`[visual-language/style-memory] ${where}`, msg)
  if (msg === "anthropic_not_connected") {
    return NextResponse.json(
      { error: msg, message: "כדי לעבוד עם ההעדפות הוויזואליות צריך לחבר מפתח Claude בהגדרות." },
      { status: 400 },
    )
  }
  if (isInvalidClaudeKey(msg)) {
    return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
  }
  return NextResponse.json({ error: msg, message: "משהו השתבש בהעדפות הוויזואליות. נסו שוב." }, { status: 500 })
}

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const rules = await listStyleRules(supabase, user.id)
    return NextResponse.json({ preferences: rules.map(toPreference) })
  } catch (e) {
    return errorResponse(e, "list")
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    action?: string
    instruction?: string
    format?: string
    explicit?: boolean
    previousInstruction?: string
    references?: unknown
    replaceIds?: unknown
    proposal?: { rule?: string; summary_he?: string; scope?: string }
  }

  if (body.action === "replace") {
    const ids = Array.isArray(body.replaceIds) ? body.replaceIds.filter((x): x is string => typeof x === "string") : []
    const p = body.proposal
    if (!ids.length || !p?.rule?.trim() || !p.summary_he?.trim() || !isRuleScope(p.scope)) {
      return NextResponse.json({ error: "replaceIds and proposal are required" }, { status: 400 })
    }
    try {
      const rule = await replaceStyleRules(supabase, user.id, ids, {
        rule: p.rule,
        summary_he: p.summary_he,
        scope: p.scope,
      })
      return NextResponse.json({ id: rule.id, summary: rule.summary_he, scope: rule.scope })
    } catch (e) {
      return errorResponse(e, "replace")
    }
  }

  const instruction = body.instruction?.trim()
  const format = FORMATS.find((f) => f === body.format)
  if (!instruction || !format) {
    return NextResponse.json({ error: "instruction and format are required" }, { status: 400 })
  }
  try {
    const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    const result = await triageVisualMemory(supabase, user.id, anthropicKey, {
      instruction,
      format,
      explicit: body.explicit === true,
      previousInstruction: body.previousInstruction?.trim() || undefined,
      refs: parseReferences(body.references),
    })
    return NextResponse.json(result)
  } catch (e) {
    return errorResponse(e, "triage")
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { id?: string; summary_he?: string }
  const text = body.summary_he?.trim()
  if (!body.id || !text) return NextResponse.json({ error: "id and summary_he are required" }, { status: 400 })
  try {
    const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    const rule = await updateStyleRule(supabase, user.id, anthropicKey, body.id, text.slice(0, 400))
    if (!rule) return NextResponse.json({ error: "not_found", message: "ההעדפה הזו כבר לא קיימת." }, { status: 404 })
    return NextResponse.json({ preference: toPreference(rule) })
  } catch (e) {
    return errorResponse(e, "update")
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { id?: string }
  if (!body.id) return NextResponse.json({ error: "missing_id" }, { status: 400 })
  try {
    const removed = await deleteStyleRule(supabase, user.id, body.id)
    return NextResponse.json({ removed })
  } catch (e) {
    return errorResponse(e, "delete")
  }
}
