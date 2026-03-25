import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";

export async function GET() {
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

  // Fetch avatars and voices in parallel
  const [avatarsRes, voicesRes] = await Promise.all([
    fetch("https://api.heygen.com/v2/avatars", {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    }),
    fetch("https://api.heygen.com/v2/voices", {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    }),
  ]);

  if (!avatarsRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch avatars from HeyGen" },
      { status: avatarsRes.status }
    );
  }

  const avatarsData = await avatarsRes.json();
  const allAvatars = avatarsData?.data?.avatars ?? [];

  // Custom avatars have hex UUID IDs
  const customAvatars = allAvatars.filter(
    (a: { avatar_id: string }) => /^[0-9a-f]{32}$/.test(a.avatar_id)
  );

  // Deduplicate by avatar_id
  const seen = new Set<string>();
  const uniqueAvatars = customAvatars.filter((a: { avatar_id: string }) => {
    if (seen.has(a.avatar_id)) return false;
    seen.add(a.avatar_id);
    return true;
  });

  // Get custom voices (non-stock ones with custom-looking IDs)
  let voices: { voice_id: string; name: string; language: string }[] = [];
  if (voicesRes.ok) {
    const voicesData = await voicesRes.json();
    const allVoices = voicesData?.data?.voices ?? [];
    // Filter to custom voices (hex IDs) and ElevenLabs-style IDs
    voices = allVoices.filter(
      (v: { voice_id: string }) =>
        /^[0-9a-f]{32}$/.test(v.voice_id) || /^[A-Za-z0-9]{20,}$/.test(v.voice_id)
    );
  }

  return NextResponse.json({ avatars: uniqueAvatars, voices });
}
