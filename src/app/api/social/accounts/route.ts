import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getSocialPublisher, SocialPublishError } from "@/lib/social"
import { isProviderInstalled } from "@/lib/social/highlevel-auth"

/**
 * The connected-accounts list, and the two ways it changes.
 *
 * GET    — what this user has connected.
 * POST   — finish a connect, given the account id the popup handed back.
 * DELETE — disconnect.
 *
 * All three are user-scoped through RLS: the publisher only ever reads and
 * writes rows belonging to the signed-in caller.
 */

function fail(err: unknown, where: string) {
  if (err instanceof SocialPublishError) {
    return NextResponse.json(
      {
        error: err.code,
        message: err.userActionable ? err.message : "משהו השתבש. ננסה שוב עוד רגע.",
      },
      { status: err.userActionable ? 400 : 500 },
    )
  }
  console.error(`[api/social/accounts][${where}]`, err)
  return NextResponse.json({ error: "request_failed" }, { status: 500 })
}

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const [accounts, ready] = await Promise.all([
      getSocialPublisher(supabase).listAccounts(user.id),
      isProviderInstalled(),
    ])
    // `ready` lets the UI say "not switched on yet" instead of offering a
    // button that cannot work.
    return NextResponse.json({ accounts, ready })
  } catch (err) {
    return fail(err, "GET")
  }
}

/**
 * Finish the connect.
 *
 * The popup posts back an `accountId` — the provider's handle on the account
 * the user just authorised. Passing it here attaches that account to her
 * workspace and mirrors it into our own table.
 *
 * Idempotent: re-running it for an account she already has updates the
 * existing row rather than adding a second one. That is what makes the
 * reconnect path work — a connection that lapsed comes back through exactly
 * this call and flips itself back to `connected`.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { accountId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : ""
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 })
  }

  try {
    const account = await getSocialPublisher(supabase).finishConnect(
      user.id,
      "instagram",
      accountId,
    )
    return NextResponse.json({ account })
  } catch (err) {
    return fail(err, "POST")
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = req.nextUrl.searchParams.get("id")?.trim()
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  try {
    await getSocialPublisher(supabase).disconnect(user.id, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err, "DELETE")
  }
}
