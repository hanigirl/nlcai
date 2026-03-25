import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import type { FormatAgentInput } from "./types"

export interface FormatRouteConfig {
  buildPrompt: (input: FormatAgentInput) => string
  parseResponse?: (text: string) => string
  maxTokens?: number
  dummyText: string
  useDummy?: boolean
}

export function createFormatRoute(config: FormatRouteConfig) {
  const {
    buildPrompt,
    parseResponse = (text: string) => text,
    maxTokens = 1024,
    dummyText,
    useDummy = false,
  } = config

  return async function POST(req: NextRequest) {
    try {
      if (useDummy) {
        return NextResponse.json({ text: dummyText })
      }

      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }

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

      const { corePostText } = await req.json()

      if (!corePostText) {
        return NextResponse.json({ error: "corePostText is required" }, { status: 400 })
      }

      const [{ data: coreIdentity }, { data: audienceIdentity }] = await Promise.all([
        supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
        supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      ])

      const prompt = buildPrompt({ corePostText, coreIdentity, audienceIdentity })

      const client = new Anthropic({ apiKey })
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      })

      const textBlock = message.content.find((b) => b.type === "text")
      const text = parseResponse(textBlock?.text ?? "")

      return NextResponse.json({ text })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error("Format generation error:", msg)
      return NextResponse.json({ error: `Failed to generate format: ${msg}` }, { status: 500 })
    }
  }
}
