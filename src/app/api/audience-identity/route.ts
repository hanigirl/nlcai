import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { AudienceIdentityInsert } from "@/lib/supabase/types"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("audience_identities")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ identity: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()

  const row: AudienceIdentityInsert = {
    user_id: user.id,
    location: (body.location as string) ?? "",
    employment: (body.employment as string) ?? "",
    education: (body.education as string) ?? "",
    income: (body.income as string) ?? "",
    behavioral: (body.behavioral as string) ?? "",
    awareness_level: (body.awarenessLevel as string) ?? "",
    daily_pains: (body.dailyPains as string) ?? "",
    emotional_pains: (body.emotionalPains as string) ?? "",
    unresolved_consequences: (body.unresolvedConsequences as string) ?? "",
    fears: (body.fears as string) ?? "",
    failed_solutions: (body.failedSolutions as string) ?? "",
    limiting_beliefs: (body.limitingBeliefs as string) ?? "",
    myths: (body.myths as string) ?? "",
    daily_desires: (body.dailyDesires as string) ?? "",
    emotional_desires: (body.emotionalDesires as string) ?? "",
    small_wins: (body.smallWins as string) ?? "",
    ideal_solution: (body.idealSolution as string) ?? "",
    bottom_line: (body.bottomLine as string) ?? "",
    cross_audience_quotes: (body.crossAudienceQuotes as string) ?? "",
    ideal_solution_words: (body.idealSolutionWords as string) ?? "",
    identity_statements: (body.identityStatements as string) ?? "",
  }

  const { data, error } = await supabase
    .from("audience_identities")
    .upsert(row as never, { onConflict: "user_id" })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ identity: data })
}
