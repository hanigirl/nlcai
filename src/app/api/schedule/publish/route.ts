import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { refreshPublishStates, slotKey, syncSlot } from "@/lib/social/bridge"

/**
 * The calendar's line to the publish queue, for the things a board write
 * doesn't cover.
 *
 * POST { action: "refresh" }
 *   What happened since: outcomes of slots whose time passed (published with
 *   a link, failed with a reason, or "יצא לפרסום"), content edited after it
 *   was queued, lapsed connections. Called when the calendar opens.
 *
 * POST { action: "retry", corePostId, format }
 *   The card's "לנסות שוב" / "לשלוח לתזמון". Same path as a board write.
 *
 * POST { action: "update", corePostId, format }
 *   The card's "לעדכן": replace the provider's stale copy with the current
 *   caption and media.
 *
 * Answers `{ publish: { "<corePostId>:<format>": PublishState } }`.
 */

export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { action?: unknown; corePostId?: unknown; format?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (body.action === "refresh") {
    const publish = await refreshPublishStates(supabase, user.id)
    return NextResponse.json({ publish })
  }

  const corePostId = typeof body.corePostId === "string" ? body.corePostId : ""
  const format = typeof body.format === "string" ? body.format.trim() : ""
  if (!UUID_RE.test(corePostId) || !format) {
    return NextResponse.json({ error: "corePostId and format are required" }, { status: 400 })
  }

  if (body.action === "retry" || body.action === "update") {
    const state = await syncSlot(
      supabase,
      user.id,
      corePostId,
      format,
      body.action === "update" ? "update" : "sync",
    )
    return NextResponse.json({ publish: { [slotKey(corePostId, format)]: state } })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
