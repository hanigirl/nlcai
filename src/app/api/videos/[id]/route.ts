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
    `https://api.heygen.com/v3/videos/${encodeURIComponent(id)}`,
    {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    }
  );

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.data) {
    return NextResponse.json(
      { error: data?.error?.message || "Failed to get video status" },
      { status: 400 }
    );
  }

  const video = data.data;

  // Same shape the pollers read on v1. v3 splits the failure into
  // failure_code / failure_message; folding it back into `error` keeps
  // `data.error?.message || data.error` working in every client.
  return NextResponse.json({
    status: video.status,
    video_url: video.video_url,
    thumbnail_url: video.thumbnail_url,
    duration: video.duration,
    error:
      video.status === "failed"
        ? { code: video.failure_code ?? null, message: video.failure_message || "Video generation failed" }
        : null,
  });
}
