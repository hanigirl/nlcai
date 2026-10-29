import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { isInvalidClaudeKey } from "@/lib/claude-credits"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { stripDashes } from "@/lib/strip-dashes"
import { buildFormatCopyRefinerPrompt } from "@/lib/agents/format-copy-refiner"
import { isCopyFormat, type CopyRefineTurn } from "@/lib/format-copy-refine"

/**
 * POST /api/format/refine — "עריכה עם AI" on one format's copy.
 *
 * Same contract as /api/core-post/refine (reply + full revised text), scoped
 * to a format so the prompt keeps that format's shape. Output goes through
 * stripDashes like every other text-producing route.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { format, currentText, hook, messages } = (await req.json()) as {
      format?: string
      currentText?: string
      hook?: string
      messages?: CopyRefineTurn[]
    }

    if (!format || !isCopyFormat(format) || !currentText || !Array.isArray(messages)) {
      return NextResponse.json({ error: "format, currentText and messages are required" }, { status: 400 })
    }

    const apiMessages = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
      .map((m) => ({ role: m.role, content: m.content }))
    if (apiMessages.length === 0 || apiMessages[apiMessages.length - 1].role !== "user") {
      return NextResponse.json({ error: "last message must be from the user" }, { status: 400 })
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

    const [{ data: coreIdentity }, { data: audienceIdentity }, learningInsights] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      fetchLearningInsights(supabase, user.id, "core_post"),
    ])

    const system = buildFormatCopyRefinerPrompt({
      format,
      currentText,
      hook,
      coreIdentity,
      audienceIdentity,
      learningInsights,
    })

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system,
      messages: apiMessages,
    })

    const raw = message.content.find((b) => b.type === "text")?.text?.trim() ?? ""
    let reply = ""
    let revisedText = ""
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim())
      reply = typeof parsed.reply === "string" ? parsed.reply.trim() : ""
      revisedText = typeof parsed.revisedText === "string" ? parsed.revisedText.trim() : ""
    } catch {
      reply = raw
    }
    if (!reply && !revisedText) return NextResponse.json({ error: "empty_response" }, { status: 502 })

    return NextResponse.json({ reply: stripDashes(reply), revisedText: stripDashes(revisedText) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Format copy refine error:", msg)
    const isKeyInvalid = isInvalidClaudeKey(msg)
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
    const isOverloaded = /overloaded|529|503/.test(msg)
    const errCode = isKeyInvalid
      ? "anthropic_key_invalid"
      : isCredits
        ? "credits_exhausted"
        : isOverloaded
          ? "anthropic_overloaded"
          : `Failed to refine format copy: ${msg}`
    return NextResponse.json(
      { error: errCode },
      { status: isKeyInvalid ? 400 : isCredits ? 402 : isOverloaded ? 503 : 500 },
    )
  }
}
