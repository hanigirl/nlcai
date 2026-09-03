import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { buildCorePostPrompt } from "@/lib/agents/core-post-generator"
import { DUMMY_CORE_POST } from "@/lib/agents/dummy-data"
import { fetchLearningInsights } from "@/lib/learning-insights"
import { fetchBusinessSourceInsights } from "@/lib/business-source-insights"
import { detectAddressGender } from "@/lib/detect-addressing"
import { getAuthUser } from "@/lib/auth-user"
import { stripDashes } from "@/lib/strip-dashes"

const USE_DUMMY = false

export async function POST(req: NextRequest) {
  try {
    if (USE_DUMMY) {
      return NextResponse.json({ post: DUMMY_CORE_POST })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { hook, userResponse, productName: productNameInput, productId, triggerWord } = await req.json()

    if (!hook || !userResponse) {
      return NextResponse.json(
        { error: "hook and userResponse are required" },
        { status: 400 }
      )
    }

    const [{ data: coreIdentity }, { data: audienceIdentity }, learningInsights, businessSourceInsights, productLookup] = await Promise.all([
      supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
      supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
      fetchLearningInsights(supabase, user.id, "core_post"),
      fetchBusinessSourceInsights(supabase, user.id),
      productId
        ? supabase
            .from("products")
            .select("name, type, page_summary")
            .eq("id", productId)
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null as { name: string; type: string | null; page_summary: string | null } | null }),
    ])

    const productRow = (productLookup && "data" in productLookup ? productLookup.data : null) as
      | { name: string; type: string | null; page_summary: string | null }
      | null
    const productName = productNameInput || productRow?.name
    const productSummary = productRow?.page_summary ?? undefined
    const productType = productRow?.type ?? undefined

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

    // Detect the draft's addressing gender in code — as a prompt priority the
    // model ignores it and "corrects" the draft toward the audience's gender.
    const addressGender = await detectAddressGender(apiKey, userResponse)

    const prompt = buildCorePostPrompt({
      hook,
      userResponse,
      productName,
      productSummary,
      productType,
      triggerWord,
      coreIdentity,
      audienceIdentity,
      learningInsights,
      businessSourceInsights,
      addressGender,
    })

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = message.content.find((b) => b.type === "text")
    // Prompt rule 7 asks for no long dashes; this makes sure of it.
    const post = stripDashes(textBlock?.text?.trim() ?? "")

    return NextResponse.json({ post })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Core post generation error:", msg)
    const isCredits = /credit|billing|insufficient_quota|payment|402/.test(msg)
    const isOverloaded = /overloaded|529|503/.test(msg)
    const errCode = isCredits
      ? "credits_exhausted"
      : isOverloaded
        ? "anthropic_overloaded"
        : `Failed to generate post: ${msg}`
    return NextResponse.json(
      { error: errCode },
      { status: isCredits ? 402 : isOverloaded ? 503 : 500 },
    )
  }
}
