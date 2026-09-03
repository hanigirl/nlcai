import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Onboarding gate. Two jobs:
//   1. Send anonymous users to /login.
//   2. Send logged-in users with incomplete identity data back to /onboarding
//      on any protected route, regardless of the user_metadata flag.
//
// The `onboarding_completed` flag in user_metadata is a routing cache only —
// the real source of truth is whether the DB has content in the critical
// identity fields. The flag can drift (legacy users, reset scripts, partial
// rows from earlier flows), so we always re-check the DB on protected routes.
// /onboarding, /settings, and /auth are recovery surfaces — incomplete users
// must be able to reach them to finish their setup.
// Who is asking, resolved the cheap way. `getUser()` phones the Auth server on
// every call — measured at 350-500ms on this project (see lib/auth-user.ts),
// and this middleware runs on every page navigation, so that was the floor
// on how fast a menu click could possibly feel. `getClaims()` verifies the
// JWT locally against the project's public keys instead, and still refreshes
// an expired session through the cookie adapter above. Same trade-off the API
// layer already made: a revoked-but-unexpired token is trusted until it
// expires, and RLS on every table means it gets nothing it shouldn't anyway.
// Falls back to `getUser()` if claims can't be read, so a bad token still
// gets the authoritative answer rather than a lockout.
type MiddlewareUser = { id: string; onboardingCompleted: boolean };

async function resolveUser(
  supabase: ReturnType<typeof createServerClient>,
): Promise<MiddlewareUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as
      | { sub?: string; user_metadata?: { onboarding_completed?: boolean } }
      | undefined;
    if (!error && claims?.sub) {
      return {
        id: claims.sub,
        onboardingCompleted: claims.user_metadata?.onboarding_completed === true,
      };
    }
  } catch {
    // fall through to the network check
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    id: user.id,
    onboardingCompleted: user.user_metadata?.onboarding_completed === true,
  };
}

export async function middleware(request: NextRequest) {
  // Domain cutover (Hani 2026-06-09): nextlevelappai.com is the canonical home.
  // Permanently (301) redirect the legacy Vercel alias to it, preserving the
  // path + query string. Only the exact production alias is matched — branch /
  // preview deployments (nlcai-git-*.vercel.app, nlcai-*.vercel.app) keep
  // working so pre-release builds are still testable. Runs before any auth/DB
  // work so it's a cheap first hop.
  if (request.headers.get("host") === "nlcai.vercel.app") {
    const url = new URL(request.url);
    url.protocol = "https";
    url.host = "nextlevelappai.com";
    return NextResponse.redirect(url, 301);
  }

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

  const user = await resolveUser(supabase);

  const path = request.nextUrl.pathname;

  // Component preview routes (/test/*) render a single component in isolation
  // so it can be reviewed without an account that happens to be in the right
  // state. Public on local dev only — in production they stay behind auth like
  // every other page, so this is a local convenience, not a hole.
  if (process.env.NODE_ENV !== "production" && path.startsWith("/test/")) {
    return supabaseResponse;
  }

  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");
  const isOnboardingRoute = path.startsWith("/onboarding");
  const isSettingsRoute = path.startsWith("/settings");
  // Owner-only admin tools (e.g. /admin/allowlist). These are gated by
  // isAdminEmail at the API layer, and they aren't content surfaces — so they
  // must NOT require a complete content profile. Without this, the owner gets
  // bounced to /onboarding before ever reaching the tool.
  const isAdminRoute = path.startsWith("/admin");

  // Routes that bypass the profile-completeness check. Everything outside this
  // list requires a complete profile.
  const isRecoveryRoute =
    isOnboardingRoute || isSettingsRoute || isAuthRoute || isAdminRoute;

  // Anonymous → /login (except already on auth)
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (!user) return supabaseResponse;

  // Logged in + on /login → bounce home. The home-page request will re-enter
  // this middleware and run the completeness check below; an incomplete user
  // ends up at /onboarding after one extra redirect.
  if (path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = user.onboardingCompleted ? "/" : "/onboarding";
    return NextResponse.redirect(url);
  }

  // Recovery routes: let through, don't run the DB check (avoids redirect
  // loops on /onboarding itself, and /settings is where incomplete users
  // fix their data).
  if (isRecoveryRoute) return supabaseResponse;

  // Protected route — verify identity completeness against the DB. The flag
  // alone isn't trusted because it can drift; the same audit script that
  // surfaced our two broken users would otherwise miss this on the routing
  // path too.
  const [coreRes, audRes] = await Promise.all([
    supabase
      .from("core_identities")
      .select("who_i_am, niche, how_i_sound")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("audience_identities")
      .select("daily_pains, emotional_pains, fears, daily_desires, emotional_desires")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const hasText = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0;

  const core = coreRes.data as
    | { who_i_am: string | null; niche: string | null; how_i_sound: string | null }
    | null;
  const aud = audRes.data as
    | {
        daily_pains: string | null;
        emotional_pains: string | null;
        fears: string | null;
        daily_desires: string | null;
        emotional_desires: string | null;
      }
    | null;

  const styleComplete =
    !!core &&
    [core.who_i_am, core.niche, core.how_i_sound].every(hasText);
  const audienceComplete =
    !!aud &&
    [
      aud.daily_pains,
      aud.emotional_pains,
      aud.fears,
      aud.daily_desires,
      aud.emotional_desires,
    ].every(hasText);

  if (!styleComplete || !audienceComplete) {
    console.log("[middleware] incomplete profile redirect", {
      userId: user.id,
      styleComplete,
      audienceComplete,
    });
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    return NextResponse.redirect(url);
  }

  // Data is complete; sync the flag if it's stale so future navigations can
  // skip the DB roundtrip once we add a fast-path optimization. Fire-and-
  // forget — a failed write just means the next request also pays the DB
  // cost, which is fine.
  if (!user.onboardingCompleted) {
    console.log("[middleware] onboarding flag self-heal", { userId: user.id });
    void supabase.auth.updateUser({
      data: { onboarding_completed: true },
    });
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
     * - anything with a file extension (images, fonts, videos under /public).
     *   Before this the auth check ran for every logo and banner PNG on a
     *   page — a dozen Supabase round trips per screen for files that are
     *   public anyway.
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api|.*\\..*).*)",
  ],
};
