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
  }

  // Path B — PKCE code exchange (OAuth providers, same-device signups)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return routeByOnboardingState(supabase, origin, explicitNext);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
