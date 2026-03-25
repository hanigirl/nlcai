import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import {
  CORE_IDENTITY_PARSE_PROMPT,
  AUDIENCE_IDENTITY_PARSE_PROMPT,
} from "@/lib/agents/identity-parser"

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { type } = (await req.json()) as { type: "core" | "audience" }

    if (!type || !["core", "audience"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'core' or 'audience'" },
        { status: 400 }
      )
    }

    const table =
      type === "core" ? "core_identities" : "audience_identities"

    // Fetch raw_file_text
    const { data: row } = await supabase
      .from(table)
      .select("raw_file_text")
      .eq("user_id", user.id)
      .single()

    const rawText = (row as Record<string, string | null> | null)
      ?.raw_file_text

    if (!rawText) {
      return NextResponse.json(
        { error: "no_file_text" },
        { status: 400 }
      )
    }

    let anthropicApiKey: string
    try {
      anthropicApiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      return NextResponse.json(
        { error: "anthropic_not_connected" },
        { status: 400 }
      )
    }

    // Parse with AI
    const systemPrompt =
      type === "core"
        ? CORE_IDENTITY_PARSE_PROMPT
        : AUDIENCE_IDENTITY_PARSE_PROMPT

    const client = new Anthropic({ apiKey: anthropicApiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `${systemPrompt}\n\n--- הטקסט ---\n${rawText}`,
        },
      ],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    const raw = textBlock?.text ?? "{}"
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI returned no valid JSON" },
        { status: 500 }
      )
    }

    const parsed: Record<string, string> = JSON.parse(jsonMatch[0])

    // Build update — only fill fields that are currently empty
    if (type === "core") {
      const { data: current } = await supabase
        .from("core_identities")
        .select("*")
        .eq("user_id", user.id)
        .single()

      const cur = current as Record<string, string | null> | null

      const updates: Record<string, string> = {}
      const fieldMap: Record<string, string> = {
        niche: "niche",
        product_name: "productName",
        who_i_am: "whoIAm",
        who_i_serve: "whoIServe",
        how_i_sound: "howISound",
        slang_examples: "slangExamples",
        what_i_never_do: "whatINeverDo",
      }

      for (const [dbCol, parsedKey] of Object.entries(fieldMap)) {
        if (!cur?.[dbCol] && parsed[parsedKey]) {
          updates[dbCol] = parsed[parsedKey]
        }
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("core_identities")
          .update(updates as never)
          .eq("user_id", user.id)
      }

      return NextResponse.json({ parsed, updated: updates })
    } else {
      const { data: current } = await supabase
        .from("audience_identities")
        .select("*")
        .eq("user_id", user.id)
        .single()

      const cur = current as Record<string, string | null> | null

      const updates: Record<string, string> = {}
      const fieldMap: Record<string, string> = {
        location: "location",
        employment: "employment",
        education: "education",
        income: "income",
        behavioral: "behavioral",
        awareness_level: "awarenessLevel",
        daily_pains: "dailyPains",
        emotional_pains: "emotionalPains",
        unresolved_consequences: "unresolvedConsequences",
        fears: "fears",
        failed_solutions: "failedSolutions",
        limiting_beliefs: "limitingBeliefs",
        myths: "myths",
        daily_desires: "dailyDesires",
        emotional_desires: "emotionalDesires",
        small_wins: "smallWins",
        ideal_solution: "idealSolution",
        bottom_line: "bottomLine",
        cross_audience_quotes: "crossAudienceQuotes",
        ideal_solution_words: "idealSolutionWords",
        identity_statements: "identityStatements",
      }

      for (const [dbCol, parsedKey] of Object.entries(fieldMap)) {
        if (!cur?.[dbCol] && parsed[parsedKey]) {
          updates[dbCol] = parsed[parsedKey]
        }
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("audience_identities")
          .update(updates as never)
          .eq("user_id", user.id)
      }

      return NextResponse.json({ parsed, updated: updates })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Reparse identity error:", message)
    return NextResponse.json(
      { error: `Failed to reparse: ${message}` },
      { status: 500 }
    )
  }
}
