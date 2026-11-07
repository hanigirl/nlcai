import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { canTalkingHeadAi } from "@/lib/feature-access"
import { TALKING_HEAD_MODEL, captionLines, transcribeVideo } from "@/lib/transcribe"
import { talkingHeadVideoUrl, transcriptionContext } from "@/lib/talking-head-video"
import { loadTalkingHeadTemplate } from "@/lib/talking-head-template"
import { originalFor } from "@/lib/talking-head-original"
import { MAX_TALKING_HEAD_SECONDS, probeSeconds, tooLongMessage } from "@/lib/talking-head-captions"

/**
 * POST { postId, url?, request? } → { moments: { id, at, quote, element }[] }
 *
 * The plan before the paid edit of "כתוביות + אלמנטים תומכים" (Hani,
 * 2026-11-07): her speech, transcribed (lib/transcribe), and the ~3 moments
 * worth highlighting — each with its time from the transcript and the
 * element it gets (card / highlight / animation). She fixes, deletes or adds
 * in the panel; only "אישור" runs the edit. Her template ("איך לייצר סרטון
 * דיבור למצלמה") is read here too. Hani + Nataliya only.
 */
export const maxDuration = 300

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`

export async function POST(req: NextRequest) {
  try {
    const { postId, url, request } = (await req.json().catch(() => ({}))) as { postId?: string; url?: string; request?: string }
    if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 })
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!canTalkingHeadAi(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })
    const { data: post } = await supabase.from("core_posts").select("id").eq("id", postId).eq("user_id", user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    const current = url?.trim() || (await talkingHeadVideoUrl(supabase, postId))
    if (!current) return NextResponse.json({ error: "no_video", message: "אין כאן סרטון. העלו או חברו את הסרטון ונסו שוב." }, { status: 400 })
    // Planned on her ORIGINAL, and too long a clip is said so up front.
    const videoUrl = await originalFor(supabase, user.id, postId, current)
    const seconds = await probeSeconds(videoUrl)
    if (seconds !== null && seconds > MAX_TALKING_HEAD_SECONDS + 0.5) {
      return NextResponse.json({ error: "too_long", message: tooLongMessage(seconds) }, { status: 422 })
    }
    let openaiKey: string
    let claudeKey: string
    try {
      ;[openaiKey, claudeKey] = await Promise.all([
        getUserApiKey(supabase, "openai_api_key"),
        getUserApiKey(supabase, "anthropic_api_key"),
      ])
    } catch {
      return NextResponse.json(
        { error: "keys_missing", message: "כדי לתכנן את העריכה צריך לחבר מפתחות OpenAI ו-Claude בהגדרות ← חיבורים." },
        { status: 400 },
      )
    }

    const transcript = await transcribeVideo(openaiKey, videoUrl, await transcriptionContext(supabase, user.id, postId))
    const lines = captionLines(transcript.words)
    if (!lines.length) return NextResponse.json({ error: "no_speech", message: "לא שמעתי דיבור בסרטון, אז אין מה להדגיש." }, { status: 422 })
    const template = await loadTalkingHeadTemplate(supabase, user.id)

    const client = new Anthropic({ apiKey: claudeKey })
    const message = await client.messages.create({
      model: TALKING_HEAD_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            "A creator's talking-head video (Hebrew). Her speech, line by line, with start times in seconds:",
            ...lines.map((l, i) => `${i}. [${l.start.toFixed(1)}s] ${l.text}`),
            "",
            `Her request: ${request?.trim() || "captions, plus supporting elements on the key moments"}`,
            template ? `Her standing instructions for every talking-head video: ${template}` : "",
            "",
            "Pick the 3 moments (2–4 if the speech clearly calls for it) most worth highlighting — a key claim, a number, a list, a question to the viewer, the call to action. For each: the line index it starts on, a short quote of HER exact words (Hebrew, 2–8 words), and the element: \"card\" (a card with the point or list), \"highlight\" (the words emphasised in her brand colour), or \"animation\" (a short animated graphic).",
            'Also "captions": true when she wants her speech as running captions (she asks for captions, or for "everything"), false when she only asks for elements.',
            'Answer with JSON only: {"captions": true|false, "moments":[{"line":0,"quote":"...","element":"card"|"highlight"|"animation"}]}',
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    })
    const text = message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    const parsed = json
      ? (JSON.parse(json) as { captions?: unknown; moments?: { line?: unknown; quote?: unknown; element?: unknown }[] })
      : null
    const moments = (parsed?.moments ?? [])
      .map((m, k) => {
        const i = typeof m.line === "number" ? Math.max(0, Math.min(lines.length - 1, Math.round(m.line))) : 0
        const element = m.element === "highlight" || m.element === "animation" ? m.element : "card"
        return { id: `m${k + 1}`, at: fmt(lines[i].start), quote: typeof m.quote === "string" ? m.quote.trim() : lines[i].text, element }
      })
      .filter((m) => m.quote)
      .slice(0, 4)
    if (!moments.length) throw new Error("plan_empty")
    // "כתוביות + אלמנטים תומכים" always has captions; her own prompt, as she said.
    const captions = /כתוביות/.test(request ?? "") || parsed?.captions === true
    return NextResponse.json({ moments, captions })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[talking-head/plan]", msg)
    const message = msg === "no_audio" ? "בסרטון הזה אין פס קול, אז אין מה לתכנן." : "התכנון לא הצליח הפעם. נסו שוב."
    return NextResponse.json({ error: msg, message }, { status: 500 })
  }
}
