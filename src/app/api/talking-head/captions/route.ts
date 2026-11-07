import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { canTalkingHeadAi } from "@/lib/feature-access"
import { captionLines, transcribeVideo } from "@/lib/transcribe"
import { talkingHeadVideoUrl } from "@/lib/talking-head-video"
import { burnCaptionLines, captionFonts, captionPlateColor, renderCaptionLines } from "@/lib/talking-head-captions"

/**
 * POST { postId, url? } → { url, lines }
 *
 * "רק כתוביות" (Hani, 2026-11-07): her speech, transcribed word by word
 * (lib/transcribe — her OpenAI key), split into 2–5-word lines, burned onto
 * her video each exactly while she says it — in her visual language's font,
 * else Rubik, on a plate in her main brand colour (black without one). Her
 * footage is untouched under the layer. The new video is stored next to her
 * own (user-media/<uid>/video/…, so it stays "her media") and returned; the
 * page makes it the post's video. Hani + Nataliya only.
 */
export const maxDuration = 800

export async function POST(req: NextRequest) {
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const stamp = crypto.randomUUID()
  const work = path.join(os.tmpdir(), `th-captions-${stamp}`)
  try {
    const { postId, url } = (await req.json().catch(() => ({}))) as { postId?: string; url?: string }
    if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 })
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!canTalkingHeadAi(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })
    const { data: post } = await supabase.from("core_posts").select("id").eq("id", postId).eq("user_id", user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    const videoUrl = url?.trim() || (await talkingHeadVideoUrl(supabase, postId))
    if (!videoUrl) return NextResponse.json({ error: "no_video", message: "אין כאן סרטון. העלו או חברו את הסרטון ונסו שוב." }, { status: 400 })

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
    const lines = captionLines(transcript.words)
    if (!lines.length) return NextResponse.json({ error: "no_speech", message: "לא שמעתי דיבור בסרטון, אז אין כתוביות להוסיף." }, { status: 422 })

    await fs.mkdir(work, { recursive: true })
    const [fonts, plate] = await Promise.all([captionFonts(supabase, user.id), captionPlateColor(supabase, user.id)])
    const pngs = await renderCaptionLines(lines, fonts, plate)
    const pngPaths = await Promise.all(
      pngs.map(async (png, i) => {
        const p = path.join(work, `l${i}.png`)
        await fs.writeFile(p, png)
        return p
      }),
    )
    const sharp = (await import("sharp")).default
    const blank = path.join(work, "blank.png")
    await sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(blank)
    const input = path.join(work, "in.mp4")
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`video_fetch_failed ${res.status}`)
    await fs.writeFile(input, Buffer.from(await res.arrayBuffer()))
    const output = path.join(work, "out.mp4")
    await burnCaptionLines(input, pngPaths, lines, blank, path.join(work, "list.txt"), output)

    const storagePath = `${user.id}/video/captioned-th-${stamp}.mp4`
    const { error: upErr } = await supabase.storage.from("user-media").upload(storagePath, await fs.readFile(output), { contentType: "video/mp4" })
    if (upErr) throw new Error(upErr.message)
    const publicUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl
    return NextResponse.json({ url: publicUrl, lines: lines.map(({ text, start, end }) => ({ text, start, end })) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[talking-head/captions]", msg)
    const message =
      msg === "no_audio"
        ? "בסרטון הזה אין פס קול, אז אין מה לתמלל."
        : msg.startsWith("video_fetch_failed")
          ? "לא הצלחתי לטעון את הסרטון. אם הוא בדרייב, בדקו שהוא משותף ל״כל מי שיש לו הקישור״."
          : "הוספת הכתוביות לא הצליחה הפעם. נסו שוב."
    return NextResponse.json({ error: msg, message }, { status: 500 })
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}
