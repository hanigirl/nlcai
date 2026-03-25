import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { CoreIdentityInsert } from "@/lib/supabase/types"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("core_identities")
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

  const row: CoreIdentityInsert = {
    user_id: user.id,
    who_i_am: (body.whoIAm as string) ?? "",
    who_i_serve: (body.whoIServe as string) ?? "",
    how_i_sound: (body.howISound as string) ?? "",
    slang_examples: (body.slangExamples as string) ?? "",
    what_i_never_do: (body.whatINeverDo as string) ?? "",
    product_name: (body.productName as string) ?? "",
    niche: (body.niche as string) ?? "",
  }

  const { data, error } = await supabase
    .from("core_identities")
    .upsert(row as never, { onConflict: "user_id" })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ identity: data })
}
