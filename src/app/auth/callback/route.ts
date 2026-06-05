import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

async function routeByOnboardingState(
  supabase: SupabaseClient,
  origin: string,
  explicitNext: string | null,
): Promise<NextResponse> {
  if (explicitNext) return NextResponse.redirect(`${origin}${explicitNext}`);
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: identity } = await supabase
      .from("core_identities")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const destination = identity ? "/" : "/onboarding";
    return NextResponse.redirect(`${origin}${destination}`);
  }
  return NextResponse.redirect(`${origin}/`);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const explicitNext = searchParams.get("next");

  const supabase = await createClient();

  // Path A — token_hash / OTP flow (cross-device email confirmation, magic links, password reset)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return routeByOnboardingState(supabase, origin, explicitNext);
    // Disambiguate common failure modes for better messaging.
    const msg = error.message.toLowerCase();
    if (msg.includes("expired")) return NextResponse.redirect(`${origin}/login?error=expired`);
    if (msg.includes("invalid") || msg.includes("already")) return NextResponse.redirect(`${origin}/login?error=used`);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Path B — PKCE code exchange (OAuth providers, same-device signups)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return routeByOnboardingState(supabase, origin, explicitNext);
    // A new Google user whose email isn't on the allowlist is rejected by the
    // BEFORE INSERT trigger on auth.users, which surfaces here as GoTrue's
    // "Database error saving new user". The only DB write during this exchange
    // is the user row, and the only thing that blocks it is our allowlist
    // trigger — so treat that signature as "not allowed" and show the friendly
    // message instead of a generic auth error.
    const msg = error.message.toLowerCase();
    if (msg.includes("database error") || msg.includes("not allowed")) {
      return NextResponse.redirect(`${origin}/login?error=notallowed`);
    }
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
