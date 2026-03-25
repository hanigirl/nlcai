import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const res = await fetch(
    `https://api.heygen.com/v1/video_status.get?video_id=${id}`,
    {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    }
  );

  const data = await res.json();

  if (data.code !== 100) {
    return NextResponse.json(
      { error: data.message || "Failed to get video status" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    status: data.data.status,
    video_url: data.data.video_url,
    thumbnail_url: data.data.thumbnail_url,
    duration: data.data.duration,
    error: data.data.error,
  });
}
