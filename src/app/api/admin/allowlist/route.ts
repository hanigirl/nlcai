import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient, isAdminEmail } from "@/lib/supabase/admin"
import { getAuthUser } from "@/lib/auth-user"

// In-app management of the signup allowlist (public.allowed_emails).
// Owner-only — same gate as the other /api/admin routes.
//
//   GET    → list every allowed email
//   POST   → bulk-add from a pasted blob or an array
//   DELETE → remove one email
//
// allowed_emails isn't in the (hand-written) Database types, so we talk to it
// through an untyped view of the service-role client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Owners can never be removed — keeps the owner from locking herself out.
// Keep in sync with migration 023's seed and src/lib/owner.ts.
const PROTECTED_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

async function requireOwner() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user || !isAdminEmail(user.email)) return null
  return user
}

function adminDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient
}

export async function GET() {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let db: SupabaseClient
  try {
    db = adminDb()
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    )
  }

  const { data, error } = await db
    .from("allowed_emails")
    .select("email, note, created_at")
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: `Failed to read allowed_emails: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    emails: data ?? [],
    protected: PROTECTED_EMAILS,
  })
}

export async function POST(req: NextRequest) {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Accept either a pasted blob ({ text }) or an explicit array ({ emails }).
  const { text, emails } = body as { text?: unknown; emails?: unknown }
  const rawTokens: string[] = []
  if (typeof text === "string") {
    // Split on anything that isn't part of an email — newlines, commas,
    // semicolons, spaces, tabs — so a pasted spreadsheet column just works.
    rawTokens.push(...text.split(/[\s,;]+/))
  }
  if (Array.isArray(emails)) {
    rawTokens.push(...emails.filter((e): e is string => typeof e === "string"))
  }
  if (rawTokens.length === 0) {
    return NextResponse.json(
      { error: "Provide { text } (pasted list) or { emails: string[] }" },
      { status: 400 }
    )
  }

  const normalized = rawTokens
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 0)
  const valid = [...new Set(normalized.filter((e) => EMAIL_RE.test(e)))]
  const invalid = [...new Set(normalized.filter((e) => !EMAIL_RE.test(e)))]

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "No valid email addresses found in the input.", invalid },
      { status: 400 }
    )
  }

  let db: SupabaseClient
  try {
    db = adminDb()
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    )
  }

  const { error } = await db
    .from("allowed_emails")
    .upsert(
      valid.map((email) => ({ email, note: "admin" })),
      { onConflict: "email" }
    )

  if (error) {
    return NextResponse.json(
      { error: `Failed to add emails: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, added: valid.length, invalid })
}

export async function DELETE(req: NextRequest) {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const email = (body as { email?: unknown }).email
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 })
  }
  const target = email.toLowerCase().trim()

  if (PROTECTED_EMAILS.includes(target)) {
    return NextResponse.json(
      { error: "This is a protected owner email and can't be removed." },
      { status: 400 }
    )
  }

  let db: SupabaseClient
  try {
    db = adminDb()
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    )
  }

  const { error } = await db.from("allowed_emails").delete().eq("email", target)
  if (error) {
    return NextResponse.json(
      { error: `Failed to remove email: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, removed: target })
}

// PUT — import every email found in a shared Google Sheet. We read the sheet's
// CSV export server-side and pull out anything that looks like an email
// (column position / header language doesn't matter — phones and names don't
// match the email shape). The sheet must be shared as "anyone with the link
// can view". Existing entries are left untouched; only new emails are added.
export async function PUT(req: NextRequest) {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const sheetUrl = (body as { sheetUrl?: unknown }).sheetUrl
  if (typeof sheetUrl !== "string" || !sheetUrl.trim()) {
    return NextResponse.json({ error: "sheetUrl is required" }, { status: 400 })
  }

  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!idMatch) {
    return NextResponse.json(
      { error: "זה לא נראה כמו קישור תקין ל-Google Sheet." },
      { status: 400 }
    )
  }
  const sheetId = idMatch[1]
  const gidMatch = sheetUrl.match(/[#&?]gid=([0-9]+)/)
  const exportUrl =
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv` +
    (gidMatch ? `&gid=${gidMatch[1]}` : "")

  let csv: string
  try {
    const res = await fetch(exportUrl, { redirect: "follow" })
    csv = await res.text()
    // A private sheet redirects to an HTML login/permission page instead of CSV.
    if (!res.ok || /<html|<!doctype html/i.test(csv.slice(0, 200))) {
      return NextResponse.json(
        {
          error:
            "לא הצלחנו לקרוא את הגיליון. ודאי שהוא משותף כ-\"כל מי שיש לו הקישור — צפייה\".",
        },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json(
      { error: "שגיאה בהורדת הגיליון מ-Google." },
      { status: 502 }
    )
  }

  const matches = csv.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []
  const found = [
    ...new Set(
      matches.map((e) => e.toLowerCase().trim()).filter((e) => EMAIL_RE.test(e))
    ),
  ]
  if (found.length === 0) {
    return NextResponse.json(
      { error: "לא נמצאו כתובות מייל בגיליון." },
      { status: 400 }
    )
  }

  let db: SupabaseClient
  try {
    db = adminDb()
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    )
  }

  // Figure out which are genuinely new (so we can report it back).
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
  const toAdd = found.filter((e) => !existing.has(e))

  if (toAdd.length > 0) {
    const { error: addErr } = await db
      .from("allowed_emails")
      .upsert(
        toAdd.map((email) => ({ email, note: "sheet-import" })),
        { onConflict: "email" }
      )
    if (addErr) {
      return NextResponse.json(
        { error: `Failed to add emails: ${addErr.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    found: found.length,
    added: toAdd.length,
    alreadyPresent: found.length - toAdd.length,
  })
}
