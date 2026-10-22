import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { AccountChoiceRequired, getSocialPublisher, SocialPublishError } from "@/lib/social"
import { isProviderInstalled } from "@/lib/social/highlevel-auth"
import { cancelSlots, countQueuedForAccount, resumeAfterConnect } from "@/lib/social/bridge"

// Disconnect cancels every queued post at the provider; reconnect re-queues
// the ones that failed for want of a connection. Both can be several calls.
export const maxDuration = 60

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
    // A non-actionable error is the one the user is told nothing about, which
    // makes it exactly the one we must write down. Skipping this log cost an
    // afternoon on 2026-10-08: the screen said "something went wrong" and the
    // provider's own words — the only thing that identified the fault — were
    // thrown away on the way out.
    if (!err.userActionable) {
      console.error(`[api/social/accounts][${where}] ${err.code}: ${err.message}`)
    }
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
    const [listed, ready] = await Promise.all([
      getSocialPublisher(supabase).listAccounts(user.id),
      isProviderInstalled(),
    ])
    // How many queued posts hang on each account — so "disconnect" can say
    // what it is about to cancel before she clicks it.
    const accounts = await Promise.all(
      listed.map(async (a) => ({
        ...a,
        queuedCount: await countQueuedForAccount(supabase, user.id, a.id),
      })),
    )
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

  let body: { accountId?: unknown; originId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : ""
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 })
  }

  // Set on the second call, after she picked one of several accounts.
  const originId = typeof body.originId === "string" && body.originId.trim() ? body.originId.trim() : undefined

  try {
    const account = await getSocialPublisher(supabase).finishConnect(
      user.id,
      "instagram",
      accountId,
      originId,
    )
    // Slots that failed only because the connection was down get another go:
    // reconnecting should restore the queue, not just turn the badge green.
    const resumed = await resumeAfterConnect(supabase, user.id)
    return NextResponse.json({ account, resumed })
  } catch (err) {
    // Several accounts behind one login: hand the list to the modal, which
    // calls back with the one she chose.
    if (err instanceof AccountChoiceRequired) {
      return NextResponse.json({ error: "choose_account", choose: err.options }, { status: 409 })
    }
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
    // Every post queued on this account leaves the provider's queue first.
    // Disconnecting while they stay queued would leave them going out from
    // an account she believes she unplugged.
    const { cancelled, stuck } = await cancelSlots(supabase, user.id, { socialAccountId: id })
    if (stuck.length > 0) {
      return NextResponse.json(
        {
          error: "cancel_failed",
          message: `לא הצלחנו לבטל ${stuck.length === 1 ? "פוסט אחד" : `${stuck.length} פוסטים`} בתור, ולכן החשבון עדיין מחובר. אפשר לנסות שוב.`,
          cancelled,
        },
        { status: 502 },
      )
    }
    await getSocialPublisher(supabase).disconnect(user.id, id)
    return NextResponse.json({ ok: true, cancelled })
  } catch (err) {
    return fail(err, "DELETE")
  }
}
