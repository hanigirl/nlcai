import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { validateApiKeyFormat, type KeyName } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"

// 10s is plenty — each live check is one tiny GET/POST. If a provider
// is genuinely slow, we'd rather time out and let the user retry than
// hold the connect button hostage.
export const maxDuration = 10

type Verdict =
  | { ok: true }
  | { ok: false; code: "format" | "invalid" | "credits" | "network"; message: string }

export async function POST(req: NextRequest) {
  // Must be logged in — the validation result determines what we'd save
  // for THIS user, and the endpoint shouldn't be open to key-stuffing
  // attacks against providers.
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    return NextResponse.json({ ok: false, code: "format", message: "Unauthorized" } satisfies Verdict, { status: 401 })
  }

  let body: { keyName?: KeyName; value?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: "format", message: "Bad request" } satisfies Verdict, { status: 400 })
  }

  const keyName = body.keyName
  const value = (body.value ?? "").trim()
  if (!keyName || !value) {
    return NextResponse.json({ ok: false, code: "format", message: "keyName and value required" } satisfies Verdict, { status: 400 })
  }

  // 1. Format gate — instant, free, catches the common "pasted wrong key" case.
  const formatErr = validateApiKeyFormat(keyName, value)
  if (formatErr) {
    return NextResponse.json({ ok: false, code: "format", message: formatErr } satisfies Verdict)
  }

  // 2. Live check — one tiny call per provider.
  if (keyName === "anthropic_api_key") {
    try {
      const client = new Anthropic({ apiKey: value, maxRetries: 0, timeout: 8000 })
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      })
      return NextResponse.json({ ok: true } satisfies Verdict)
    } catch (err) {
      const status = (err as { status?: number })?.status
      const msg = err instanceof Error ? err.message : String(err)
      if (status === 401) {
        return NextResponse.json({ ok: false, code: "invalid", message: "המפתח לא תקף. ודאי שהעתקת אותו נכון מ-console.anthropic.com." } satisfies Verdict)
      }
      if (status === 402 || /credit|insufficient/i.test(msg)) {
        return NextResponse.json({ ok: false, code: "credits", message: "אין יתרת קרדיטים בחשבון Anthropic שלך. תיכנסי ל-console.anthropic.com → Billing להוסיף יתרה." } satisfies Verdict)
      }
      return NextResponse.json({ ok: false, code: "network", message: `לא הצלחנו לאמת את המפתח: ${msg}` } satisfies Verdict)
    }
  }

  if (keyName === "apify_api_key") {
    try {
      // users/me returns 200 + user info for a valid token, 401 otherwise.
      const res = await fetch("https://api.apify.com/v2/users/me", {
        headers: { Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) return NextResponse.json({ ok: true } satisfies Verdict)
      if (res.status === 401) {
        return NextResponse.json({ ok: false, code: "invalid", message: "המפתח של Apify לא תקף. ודאי שהעתקת אותו מ-console.apify.com." } satisfies Verdict)
      }
      return NextResponse.json({ ok: false, code: "network", message: `Apify החזיר ${res.status}` } satisfies Verdict)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ ok: false, code: "network", message: `לא הצלחנו לאמת את המפתח: ${msg}` } satisfies Verdict)
    }
  }

  if (keyName === "openai_api_key") {
    // /v1/models is the cheapest authenticated GET — 200 for a valid key,
    // 401 for a bad one. No tokens are spent.
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) return NextResponse.json({ ok: true } satisfies Verdict)
      if (res.status === 401) {
        return NextResponse.json({ ok: false, code: "invalid", message: "המפתח של OpenAI לא תקף. ודאו שהעתקתם אותו נכון מ-platform.openai.com → API keys." } satisfies Verdict)
      }
      if (res.status === 429) {
        return NextResponse.json({ ok: false, code: "credits", message: "חשבון ה-OpenAI שלכם חרג מהמכסה או שאין בו יתרה. היכנסו ל-platform.openai.com → Billing." } satisfies Verdict)
      }
      return NextResponse.json({ ok: false, code: "network", message: `OpenAI החזיר ${res.status}` } satisfies Verdict)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ ok: false, code: "network", message: `לא הצלחנו לאמת את המפתח: ${msg}` } satisfies Verdict)
    }
  }

  if (keyName === "gemini_api_key") {
    // Listing models is the cheapest authenticated GET — 200 for a valid key,
    // 400/403 for a bad one. No tokens are spent.
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": value },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) return NextResponse.json({ ok: true } satisfies Verdict)
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, code: "invalid", message: "המפתח של Gemini לא תקף. ודאו שהעתקתם אותו מ-aistudio.google.com → API keys, ושה-API מופעל בפרויקט." } satisfies Verdict)
      }
      if (res.status === 429) {
        return NextResponse.json({ ok: false, code: "credits", message: "חשבון ה-Gemini שלכם חרג מהמכסה. היכנסו ל-aistudio.google.com לבדוק את המגבלות של התוכנית." } satisfies Verdict)
      }
      return NextResponse.json({ ok: false, code: "network", message: `Gemini החזיר ${res.status}` } satisfies Verdict)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ ok: false, code: "network", message: `לא הצלחנו לאמת את המפתח: ${msg}` } satisfies Verdict)
    }
  }

  if (keyName === "heygen_api_key") {
    // remaining_quota is the cheapest authenticated GET — 200 for a valid
    // token, 401 otherwise. No credits are spent.
    try {
      const res = await fetch("https://api.heygen.com/v2/user/remaining_quota", {
        headers: { "X-Api-Key": value, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) return NextResponse.json({ ok: true } satisfies Verdict)
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, code: "invalid", message: "המפתח של HeyGen לא תקף. ודאי שהעתקת אותו מ-app.heygen.com → Settings → API." } satisfies Verdict)
      }
      return NextResponse.json({ ok: false, code: "network", message: `HeyGen החזיר ${res.status}` } satisfies Verdict)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ ok: false, code: "network", message: `לא הצלחנו לאמת את המפתח: ${msg}` } satisfies Verdict)
    }
  }

  return NextResponse.json({ ok: false, code: "format", message: "Unknown keyName" } satisfies Verdict, { status: 400 })
}
