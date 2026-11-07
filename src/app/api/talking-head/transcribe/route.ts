import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { canTranscribe, captionLines, transcribeVideo } from "@/lib/transcribe"

// Download + ffmpeg audio extraction + one Whisper call (a minute of speech
// takes seconds; a long clip more).
export const maxDuration = 300

/**
 * Word-level transcript of her talking-head video, for synced captions in
 * the talking-head AI edit (lib/transcribe). Hani + Nataliya for now.
 *
 * POST { postId, url? } → { words: {text,start,end}[], lines: CaptionLine[], text, duration }
 * `url` defaults to the post's talking-head video.
 */
export async function POST(req: NextRequest) {
  try {
    const { postId, url } = (await req.json().catch(() => ({}))) as { postId?: string; url?: string }
    if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 })
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!canTranscribe(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })

    const { data: post } = await supabase.from("core_posts").select("id").eq("id", postId).eq("user_id", user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    let videoUrl = url?.trim() || null
    if (!videoUrl) {
      const { data: variant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", postId)
        .eq("format", "talking_head")
        .maybeSingle()
      const { data: asset } = variant
        ? await supabase
            .from("media_assets")
            .select("url")
            .eq("format_variant_id", (variant as { id: string }).id)
            .eq("asset_type", "video")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null }
      videoUrl = (asset as { url: string | null } | null)?.url ?? null
    }
    if (!videoUrl) {
      return NextResponse.json({ error: "no_video", message: "אין כאן סרטון לתמלל. העלו או חברו את הסרטון ונסו שוב." }, { status: 400 })
    }

    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch {
      return NextResponse.json(
        { error: "openai_not_connected", message: "כדי לתמלל את הסרטון לכתוביות צריך לחבר מפתח OpenAI בהגדרות ← חיבורים." },
        { status: 400 },
      )
    }

    const transcript = await transcribeVideo(openaiKey, videoUrl)
    return NextResponse.json({ ...transcript, lines: captionLines(transcript.words) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[talking-head/transcribe]", msg)
    const message =
      msg === "no_audio"
        ? "בסרטון הזה אין פס קול, אז אין מה לתמלל."
        : msg === "audio_too_long"
          ? "הסרטון ארוך מדי לתמלול בבת אחת (עד כ-25 דקות)."
          : msg.startsWith("video_fetch_failed")
            ? "לא הצלחתי לטעון את הסרטון. אם הוא בדרייב, בדקו שהוא משותף ל״כל מי שיש לו הקישור״."
            : "התמלול לא הצליח הפעם. נסו שוב."
    return NextResponse.json({ error: msg, message }, { status: 500 })
  }
}
