import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");
  const isOnboardingRoute = path.startsWith("/onboarding");

  // Not logged in and not on auth pages → redirect to login
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Logged in and on login page → bounce to the correct landing based on
  // onboarding state. Trusts the flag here — the self-heal below will catch
  // any drift on the next navigation.
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = user.user_metadata?.onboarding_completed ? "/" : "/onboarding";
    return NextResponse.redirect(url);
  }

  // Onboarding gate, with self-heal for flag/data drift.
  //
  // Why: `user_metadata.onboarding_completed` is a routing cache, not the
  // source of truth. The actual truth is whether the user has a row in
  // `core_identities` (same signal `auth/callback` uses post-login). The
  // flag can drift in two directions:
  //   - flag=false but data exists → user already onboarded; previous
  //     reset script or a metadata wipe left them stranded. Heal it.
  //   - flag=false AND no data → genuine new user; route to /onboarding.
  //
  // The DB check fires ONLY when the flag is missing/false, so the 99%
  // hot path (returning user, flag=true) pays zero extra latency.
  if (user && !user.user_metadata?.onboarding_completed && !isAuthRoute) {
    const { data: identity } = await supabase
      .from("core_identities")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (identity) {
      // Drift: data says "onboarded", flag says otherwise. Backfill the
      // flag so the next request hits the fast path. Even if updateUser
      // fails (network blip, stale token), we still let the request
      // through — the next navigation will retry the heal. Failing
      // closed here would lock onboarded users out of the app, which is
      // worse than a temporarily stale flag.
      console.log("[proxy] onboarding self-heal", { userId: user.id });
      await supabase.auth.updateUser({
        data: { onboarding_completed: true },
      });
      // If they were heading to /onboarding, send them home instead.
      // Otherwise let the request continue to its original destination.
      if (isOnboardingRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
      }
    } else if (!isOnboardingRoute) {
      // Genuine new user — needs to finish onboarding before anything else.
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, sitemap.xml, robots.txt
     * - API routes
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api).*)",
  ],
};
