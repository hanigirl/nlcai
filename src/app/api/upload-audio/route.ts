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

  const buffer = Buffer.from(await file.arrayBuffer());

  // Upload directly to HeyGen's asset endpoint
  const res = await fetch("https://upload.heygen.com/v1/asset", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "video/webm",
    },
    body: buffer,
  });

  const data = await res.json();

  if (data.code !== 100 || !data.data?.url) {
    return NextResponse.json(
      { error: data.message || "Failed to upload audio to HeyGen" },
      { status: 400 }
    );
  }

  return NextResponse.json({ url: data.data.url });
}
