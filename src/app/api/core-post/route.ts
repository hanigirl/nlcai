import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildCorePostPrompt } from "@/lib/agents/core-post-generator"
import { DUMMY_CORE_POST } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"

const USE_DUMMY = false

export async function POST(req: NextRequest) {
  try {
    if (USE_DUMMY) {
      return NextResponse.json({ post: DUMMY_CORE_POST })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { hook, userResponse, productName } = await req.json()

    if (!hook || !userResponse) {
      return NextResponse.json(
        { error: "hook and userResponse are required" },
        { status: 400 }
      )
    }

    const [{ data: coreIdentity }, { data: audienceIdentity }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      fetchLearningInsights(supabase, user.id, "core_post"),
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

    const prompt = buildCorePostPrompt({
      hook,
      userResponse,
      productName,
      coreIdentity,
      audienceIdentity,
      learningInsights,
    })

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const post = textBlock?.text?.trim() ?? ""

    return NextResponse.json({ post })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Core post generation error:", msg)
    return NextResponse.json(
      { error: `Failed to generate post: ${msg}` },
      { status: 500 }
    )
  }
}
