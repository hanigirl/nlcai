import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  recordLearningInsight,
  type LearningContentType,
  type LearningOutcome,
  type LearningSource,
} from "@/lib/learning-insights"
import { getAuthUser } from "@/lib/auth-user"
import { isTrivialEdit } from "@/lib/learning-diff"

const CONTENT_TYPES: LearningContentType[] = ["hook", "core_post"]
const SOURCES: LearningSource[] = ["manual_edit", "chat_instruction"]
const OUTCOMES: LearningOutcome[] = ["accepted", "rejected"]

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { originalText, editedText, contentType, source, outcome, instruction } =
      await req.json() as {
        originalText?: string
        editedText?: string
        contentType?: LearningContentType
        source?: LearningSource
        outcome?: LearningOutcome
        instruction?: string
      }

    if (!originalText || !editedText || !contentType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }
    if (!CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json({ error: "Invalid contentType" }, { status: 400 })
    }
    if (source && !SOURCES.includes(source)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 })
    }
    if (outcome && !OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 })
    }

    // Skip if only whitespace changes
    if (originalText.trim() === editedText.trim()) {
      return NextResponse.json({ insight: null })
    }
    // Same filter the browser applies, in case a caller bypasses it: a comma
    // or a dropped blank line is not a preference. Chat verdicts are exempt —
    // the instruction is the signal there, not the size of the diff.
    if ((source ?? "manual_edit") !== "chat_instruction" && isTrivialEdit(originalText, editedText)) {
      return NextResponse.json({ insight: null, skipped: "trivial" })
    }

    let apiKey: string
    try {
      apiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      return NextResponse.json({ error: "anthropic_not_connected" }, { status: 400 })
    }

    const result = await recordLearningInsight(supabase, apiKey, {
      userId: user.id,
      contentType,
      originalText,
      editedText,
      source: source ?? "manual_edit",
      outcome: outcome ?? null,
      instruction: instruction?.trim() || null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Learning log error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** What the AI has learned about the current user — newest first. */
export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("learning_logs")
    .select("id, insight, content_type, source, outcome, instruction, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(300)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ insights: data ?? [] })
}
