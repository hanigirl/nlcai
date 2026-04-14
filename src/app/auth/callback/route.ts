import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // If caller passed ?next=... respect it.
      if (explicitNext) return NextResponse.redirect(`${origin}${explicitNext}`);

      // Otherwise route by onboarding state: no core_identity → /onboarding, else /
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
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
