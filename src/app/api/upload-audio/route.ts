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

  const formData = await request.formData();
  const file = formData.get("audio") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  // v3 takes the file as multipart `file`. The browser recorder hands us
  // webm; a blob that arrived untyped reaches us as application/octet-stream,
  // which HeyGen won't accept as audio, so label it webm again.
  const name = file.name || "recording.webm";
  const typed = /^(audio|video)\//.test(file.type)
    ? file
    : new File([file], name, { type: "audio/webm" });
  const upload = new FormData();
  upload.append("file", typed, name);

  const res = await fetch("https://api.heygen.com/v3/assets", {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: upload,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.data?.url) {
    return NextResponse.json(
      { error: data?.error?.message || "Failed to upload audio to HeyGen" },
      { status: 400 }
    );
  }

  return NextResponse.json({ url: data.data.url, asset_id: data.data.asset_id });
}
