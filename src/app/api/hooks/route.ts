import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildHookGeneratorPrompt, parseHooks } from "@/lib/agents/hook-generator"
import { DUMMY_HOOKS } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"

const USE_DUMMY = false

export async function POST(req: NextRequest) {
  try {
    if (USE_DUMMY) {
      const { count = 3 } = await req.json()
      return NextResponse.json({ hooks: DUMMY_HOOKS.slice(0, count) })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { idea, userResponse, productName, count = 3 } = await req.json()

    if (!idea) {
      return NextResponse.json(
        { error: "idea is required" },
        { status: 400 }
      )
    }

    // Fetch core identity & audience identity
    const [{ data: coreIdentity }, { data: audienceIdentity }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      fetchLearningInsights(supabase, user.id, "hook"),
    ])

    let apiKey: string
    try {
      apiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "anthropic_not_connected") {
        return NextResponse.json({ error: "anthropic_not_connected" }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const prompt = buildHookGeneratorPrompt({
      idea,
      userResponse,
      productName,
      coreIdentity,
      audienceIdentity,
      count,
      learningInsights,
    })

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: count > 5 ? 2048 : 1024,
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const hooks = parseHooks(textBlock?.text ?? "", count)

    return NextResponse.json({ hooks })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Hook generation error:", message)
    return NextResponse.json(
      { error: `Failed to generate hooks: ${message}` },
      { status: 500 }
    )
  }
}
