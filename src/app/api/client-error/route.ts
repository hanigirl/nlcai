import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Catch-all sink for client-side React crashes. Called from error.tsx and
// global-error.tsx on mount so we get the stack trace + the user's email
// in Vercel logs even when the user doesn't click anything. Returns 200
// no matter what — the last thing we want is for the error reporter
// itself to throw and trigger another loop.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { message, stack, digest, url, userAgent } = body as {
      message?: string
      stack?: string
      digest?: string
      url?: string
      userAgent?: string
    }

    // Best-effort identify the user — non-fatal if no session.
    let email: string | null = null
    let userId: string | null = null
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      email = user?.email ?? null
      userId = user?.id ?? null
    } catch { /* ignore — we still want to log the crash */ }

    // console.error lands in Vercel function logs with a [client-error] tag
    // we can grep. Single line so the log search/preview stays readable.
    console.error("[client-error]", JSON.stringify({
      message: message?.slice(0, 500) ?? null,
      digest: digest ?? null,
      url: url ?? null,
      userAgent: userAgent?.slice(0, 200) ?? null,
      email,
      userId,
      stack: stack?.split("\n").slice(0, 20).join("\n") ?? null,
    }))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[client-error] reporter itself failed:", err)
    return NextResponse.json({ ok: false })
  }
}
