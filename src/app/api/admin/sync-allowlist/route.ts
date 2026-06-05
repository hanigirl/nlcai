import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"

// Google Sheet → DB sync for the signup allowlist.
//
// A small Apps Script bound to the sheet POSTs the FULL email column here on
// every edit (+ an hourly safety run). We mirror that list into
// public.allowed_emails: add new ones, remove ones no longer in the sheet.
//
// Auth: the caller is a Google Apps Script, not a logged-in user, so there's
// no Supabase session. We gate on a shared secret (ALLOWLIST_SYNC_SECRET) sent
// in the x-sync-secret header. The same value lives in the Apps Script.
//
// This route lives under /api, which middleware excludes from the auth gate,
// so it's reachable without a session — the secret is the only gate.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Owners are ALWAYS kept, even if removed from (or absent in) the sheet, so a
// cleared/typo'd sheet can never lock the owner out. Keep in sync with the
// seed in migration 023 and src/lib/owner.ts.
const PROTECTED_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  // 1. Gate on the shared secret.
  const expected = process.env.ALLOWLIST_SYNC_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: "ALLOWLIST_SYNC_SECRET not configured" },
      { status: 500 }
    )
  }
  const provided = req.headers.get("x-sync-secret")
  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // 2. Parse + normalize the incoming list.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const rawEmails = (body as { emails?: unknown })?.emails
  if (!Array.isArray(rawEmails)) {
    return NextResponse.json(
      { error: "Body must be { emails: string[] }" },
      { status: 400 }
    )
  }

  const incoming = [
    ...new Set(
      rawEmails
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.toLowerCase().trim())
        .filter((e) => EMAIL_RE.test(e))
    ),
  ]

  // Safety valve: a full mirror with an empty list would wipe everyone. That's
  // almost always a glitch (cleared sheet, bad fetch), not intent — refuse it.
  if (incoming.length === 0) {
    return NextResponse.json(
      {
        error:
          "Refusing to sync an empty allowlist (safety guard). No valid emails received.",
      },
      { status: 400 }
    )
  }

  // Always keep the owners.
  const desired = new Set([...incoming, ...PROTECTED_EMAILS])

  // 3. Mirror into the table. allowed_emails isn't in the (hand-written)
  // Database types, so use an untyped view of the admin client for it.
  let db: SupabaseClient
  try {
    db = createAdminClient() as unknown as SupabaseClient
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    )
  }

  const { data: existingRows, error: selErr } = await db
    .from("allowed_emails")
    .select("email")
  if (selErr) {
    return NextResponse.json(
      { error: `Failed to read allowed_emails: ${selErr.message}` },
      { status: 500 }
    )
  }
  const existing = new Set(
    ((existingRows ?? []) as { email: string }[]).map((r) => r.email)
  )

  const toAdd = [...desired].filter((e) => !existing.has(e))
  const toRemove = [...existing].filter((e) => !desired.has(e))

  if (toAdd.length > 0) {
    const { error: addErr } = await db
      .from("allowed_emails")
      .upsert(
        toAdd.map((email) => ({ email, note: "google-sheet" })),
        { onConflict: "email" }
      )
    if (addErr) {
      return NextResponse.json(
        { error: `Failed to add emails: ${addErr.message}` },
        { status: 500 }
      )
    }
  }

  if (toRemove.length > 0) {
    const { error: delErr } = await db
      .from("allowed_emails")
      .delete()
      .in("email", toRemove)
    if (delErr) {
      return NextResponse.json(
        { error: `Failed to remove emails: ${delErr.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    total: desired.size,
    added: toAdd.length,
    removed: toRemove.length,
  })
}
