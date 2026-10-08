import { createAdminClient } from "@/lib/supabase/admin"
import type { NoticeCode } from "@/lib/system-notice-copy"

/**
 * Raise / resolve home-page notices (see migration 039 and
 * components/system-notices.tsx). Server-only — uses the service role.
 *
 * Never throws: a notice is a courtesy on top of a failure that is already
 * being handled, so a problem here must not turn into a second failure.
 */

type Target = { audience: "admin"; userId?: undefined } | { audience: "user"; userId: string }

function openQuery(target: Target, code: NoticeCode) {
  const q = createAdminClient()
    .from("system_notices")
    .select("id")
    .eq("audience", target.audience)
    .eq("code", code)
    .is("resolved_at", null)
    .is("dismissed_at", null)
  return target.audience === "user" ? q.eq("user_id", target.userId) : q.is("user_id", null)
}

export async function raiseNotice(
  target: Target,
  code: NoticeCode,
  opts: { expiresInMs?: number } = {},
): Promise<void> {
  try {
    const expires_at = opts.expiresInMs
      ? new Date(Date.now() + opts.expiresInMs).toISOString()
      : null
    const { data } = await openQuery(target, code).maybeSingle<{ id: string }>()
    const db = createAdminClient()
    if (data) {
      await db.from("system_notices").update({ expires_at } as never).eq("id", data.id)
      return
    }
    await db.from("system_notices").insert({
      audience: target.audience,
      user_id: target.audience === "user" ? target.userId : null,
      code,
      expires_at,
    } as never)
  } catch (err) {
    console.error("[system-notices] raise failed", code, err)
  }
}

/** The thing works again — clear its open notice, if any. */
export async function resolveNotice(target: Target, code: NoticeCode): Promise<void> {
  try {
    let q = createAdminClient()
      .from("system_notices")
      .update({ resolved_at: new Date().toISOString() } as never)
      .eq("audience", target.audience)
      .eq("code", code)
      .is("resolved_at", null)
    q = target.audience === "user" ? q.eq("user_id", target.userId) : q.is("user_id", null)
    await q
  } catch (err) {
    console.error("[system-notices] resolve failed", code, err)
  }
}

/**
 * Report a Serper response. Serper answers 400 "Not enough credits" when the
 * app's account is empty (it did, for two weeks, silently); 401/402/403 are
 * a dead or unpaid key. Any of those raise the admin notice; a 2xx clears it.
 */
export async function reportSerperStatus(res: Response): Promise<void> {
  if (res.ok) return resolveNotice({ audience: "admin" }, "serper_credits")
  if ([400, 401, 402, 403].includes(res.status)) {
    const body = await res.clone().text().catch(() => "")
    console.error(`[serper] ${res.status}: ${body.slice(0, 200)}`)
    if (res.status !== 400 || /credit/i.test(body)) {
      await raiseNotice({ audience: "admin" }, "serper_credits")
    }
  }
}
