import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";

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

  const { avatar_id, audio_url } = await request.json();

  if (!avatar_id || !audio_url) {
    return NextResponse.json(
      { error: "avatar_id and audio_url are required" },
      { status: 400 }
    );
  }

  const res = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id,
          },
          voice: {
            type: "audio",
            audio_url,
          },
        },
      ],
    }),
  });

  const data = await res.json();

  if (data.error) {
    return NextResponse.json(
      { error: data.error.message || "Failed to generate video" },
      { status: 400 }
    );
  }

  return NextResponse.json({ video_id: data.data.video_id });
}
