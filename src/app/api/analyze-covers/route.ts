import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: Request) {
  const supabase = await createClient();

  let apiKey: string;
  try {
    apiKey = await getUserApiKey(supabase, "anthropic_api_key");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const { images } = await req.json();
  if (!images || !Array.isArray(images) || images.length < 3) {
    return NextResponse.json({ error: "At least 3 images required" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });

  // Build content blocks with all images
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const img of images.slice(0, 6)) {
    // img is a data URL like "data:image/png;base64,..."
    const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) continue;
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: match[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: match[2],
      },
    });
  }

  content.push({
    type: "text",
    text: `Analyze these reel/post cover images and extract the consistent visual style. Return ONLY a JSON object with these exact fields:

{
  "overlay_style": "solid" | "gradient" | "semi-transparent" | "blur",
  "overlay_opacity": number between 0 and 1,
  "overlay_color": hex color string,
  "text_color": hex color string,
  "text_position": "center" | "bottom-center" | "top" | "bottom-left" | "bottom-right" | "top-left" | "top-right",
  "text_size": "large" | "medium" | "small",
  "font_weight": "bold" | "light" | "regular",
  "text_direction": "rtl" | "ltr",
  "has_text_background": boolean,
  "text_background_color": hex color string or null,
  "accent_color": hex color string or null
}

Look at the CONSISTENT patterns across all images. Focus on:
- How text overlays are styled (color, position, size)
- The background treatment behind text (dark overlay, gradient, etc)
- Text direction (Hebrew = RTL)
- Any accent colors or decorative elements

Return ONLY valid JSON, no markdown, no explanation.`,
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let brandStyle;
    try {
      // Try to extract JSON from possible markdown wrapping
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      brandStyle = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Failed to parse style analysis", raw: text }, { status: 500 });
    }

    // Save to user's profile
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("users")
        .update({ brand_style: brandStyle } as never)
        .eq("id", user.id);
    }

    return NextResponse.json({ brand_style: brandStyle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
