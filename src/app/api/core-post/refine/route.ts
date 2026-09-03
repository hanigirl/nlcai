import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildRefinerSystemPrompt } from "@/lib/agents/core-post-refiner"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { fetchBusinessSourceInsights } from "@/lib/business-source-insights"
import { getAuthUser } from "@/lib/auth-user"
import { stripDashes } from "@/lib/strip-dashes"

interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { currentPost, messages, hook } = (await req.json()) as {
      currentPost?: string
      messages?: ChatTurn[]
      hook?: string
    }

    if (!currentPost || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "currentPost and messages are required" },
        { status: 400 },
      )
    }

    const [
      { data: coreIdentity },
      { data: audienceIdentity },
      learningInsights,
      businessSourceInsights,
    ] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      fetchLearningInsights(supabase, user.id, "core_post"),
      fetchBusinessSourceInsights(supabase, user.id),
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

    const system = buildRefinerSystemPrompt({
      currentPost,
      hook,
      coreIdentity,
      audienceIdentity,
      learningInsights,
      businessSourceInsights,
    })

    // Only forward clean user/assistant turns to the model — drop any local
    // intro/placeholder bubble the client seeded the thread with.
    const apiMessages = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
      .map((m) => ({ role: m.role, content: m.content }))

    if (apiMessages.length === 0 || apiMessages[apiMessages.length - 1].role !== "user") {
      return NextResponse.json(
        { error: "last message must be from the user" },
        { status: 400 },
      )
    }

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system,
      messages: apiMessages,
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const raw = textBlock?.text?.trim() ?? ""

    // The model is instructed to return strict JSON. Be defensive: strip any
    // stray code fences and parse; on failure, treat the whole text as the
    // conversational reply and leave the post unchanged so the user still
    // gets an answer instead of a hard error.
    let reply = ""
    let revisedPost = ""
    try {
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()
      const parsed = JSON.parse(cleaned)
      reply = typeof parsed.reply === "string" ? parsed.reply.trim() : ""
      revisedPost =
        typeof parsed.revisedPost === "string" ? parsed.revisedPost.trim() : ""
    } catch {
      reply = raw
      revisedPost = ""
    }

    if (!reply && !revisedPost) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 })
    }

    // Same guarantee as the generator: no long dashes reach the post.
    return NextResponse.json({ reply: stripDashes(reply), revisedPost: stripDashes(revisedPost) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Core post refine error:", msg)
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
    const isOverloaded = /overloaded|529|503/.test(msg)
    const errCode = isCredits
      ? "credits_exhausted"
      : isOverloaded
        ? "anthropic_overloaded"
        : `Failed to refine post: ${msg}`
    return NextResponse.json(
      { error: errCode },
      { status: isCredits ? 402 : isOverloaded ? 503 : 500 },
    )
  }
}
