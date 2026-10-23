import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";

const HEYGEN = "https://api.heygen.com/v3";

export async function POST(request: Request) {
  const supabase = await createClient();

  let apiKey: string;
  try {
    apiKey = await getUserApiKey(supabase, "heygen_api_key");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "heygen_not_connected") {
      return NextResponse.json({ error: "heygen_not_connected" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  // avatar_type is still sent by every client but no longer matters: v3 takes
  // a video avatar and a photo avatar the same way, by look id.
  const { avatar_id, audio_url } = await request.json();

  if (!avatar_id || !audio_url) {
    return NextResponse.json(
      { error: "avatar_id and audio_url are required" },
      { status: 400 }
    );
  }

  const engine = await pickEngine(apiKey, avatar_id);

  const res = await fetch(`${HEYGEN}/videos`, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "avatar",
      avatar_id,
      audio_url,
      ...(engine ? { engine: { type: engine } } : {}),
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.data?.video_id) {
    return NextResponse.json(
      { error: data?.error?.message || "Failed to generate video" },
      { status: 400 }
    );
  }

  return NextResponse.json({ video_id: data.data.video_id });
}

/**
 * v2 rendered every avatar on the legacy Avatar III engine. v3 defaults to
 * Avatar IV, a different model with its own per-second rate, so the
 * migration asks for v3's Avatar III whenever the look supports it and keeps
 * the videos users get, and what HeyGen bills them, as close to v2 as v3
 * allows. A look that doesn't list it, or a lookup that fails, falls back to
 * HeyGen's default.
 */
async function pickEngine(apiKey: string, lookId: string): Promise<"avatar_iii" | null> {
  try {
    const res = await fetch(`${HEYGEN}/avatars/looks/${encodeURIComponent(lookId)}`, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const engines = (data?.data?.supported_api_engines ?? []) as string[];
    return engines.includes("avatar_iii") ? "avatar_iii" : null;
  } catch {
    return null;
  }
}
