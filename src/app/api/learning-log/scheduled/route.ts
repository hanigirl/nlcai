import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { learnFromScheduledPosts } from "@/lib/scheduled-learning"

export const maxDuration = 60

/** Small resumable batches for posts already on the calendar. No GET writes. */
export async function POST() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const { data, error } = await supabase.from("scheduled_posts").select("core_post_id")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { core_post_id: string }[]
    const ids = [...new Set(rows.map((row) => row.core_post_id))]
    return NextResponse.json(await learnFromScheduledPosts(supabase, user.id, ids, 8))
  } catch (error) {
    console.error("[learning] scheduled backfill failed", error)
    return NextResponse.json({ error: "Could not learn from scheduled posts" }, { status: 500 })
  }
}
