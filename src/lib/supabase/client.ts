import { createBrowserClient } from "@supabase/ssr";
import { EMBED_MARKER, embedCookieOptions } from "@/lib/phebe-demo";
import type { Database } from "./types";

export function createClient() {
  // Phebe's demo frame (Hani only, opted in): keep the sign-in cookies
  // SameSite=None while the marker lasts, so a token refresh inside the
  // frame doesn't turn them back to Lax. See lib/phebe-demo.ts.
  const embed =
    typeof document !== "undefined" &&
    document.cookie.split("; ").some((c) => c.startsWith(`${EMBED_MARKER}=`));
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: embedCookieOptions(embed) }
  );
}
