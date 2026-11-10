import { extractDriveFileId } from "@/lib/drive-media"
import { after, NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { canBlendBRoll, canEditOwnBRollCaption, driveInBRoll, canUseEditAgent } from "@/lib/feature-access"
import { loadComposition } from "@/lib/broll-animation/store"
import { isOwnMediaUrl } from "@/lib/own-media"
import { scriptTextFor } from "@/lib/script-text"
import { parseReferences } from "@/lib/ai-edit-references"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { runBRollAgent, type BRollAgentOutcome, type ChatTurn } from "@/lib/edit-agent/broll-agent"
import { runOwnBRollAgent } from "@/lib/edit-agent/own-broll-agent"

/**
 * The AI edit chat as an agent, on the server (Hani, 2026-11-10; lib/edit-agent).
 *
 *   GET  ?postId&format          → { messages, job } — the conversation and its latest run
 *   POST { postId, format, text, images }   → starts a run, returns { jobId }
 *   POST { postId, format, action: "new" }  → archives the conversation ("שיחה חדשה")
 *
 * The run continues after the response (next/server `after`), writes its
 * progress to ai_edit_jobs and its reply into the conversation
 * (ai_chat_threads) — a reload, a closed tab or another device sees it.
 *
 * IRON RULE: her own media (Google Drive / her computer) is never edited
 * here — only a b-roll the engine made (it has a stored composition).
 */

// The run: thinking + stills (~1–4 min) and the full render (~4–5 min).
export const maxDuration = 800

export interface AgentMessage {
  role: "user" | "assistant"
  text: string
  images?: string[]
  /** A question's buttons — pressing one sends its action. */
  options?: { label: string; action: string }[]
  error?: boolean
  at: string
}

const isVideoLike = (url: string) => !/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(url)
const keyFor = (postId: string, format: string) => `agent:${postId}:${format}`
// ai_chat_threads / ai_edit_jobs aren't in the generated types yet.
const untyped = (c: unknown) => c as SupabaseClient

async function loadThread(db: SupabaseClient, userId: string, chatKey: string) {
  const { data } = await db
    .from("ai_chat_threads")
    .select("id, messages")
    .eq("user_id", userId)
    .eq("chat_key", chatKey)
    .is("archived_at", null)
    .maybeSingle()
  return data as { id: string; messages: AgentMessage[] } | null
}

async function appendMessages(db: SupabaseClient, userId: string, chatKey: string, add: AgentMessage[]) {
  const row = await loadThread(db, userId, chatKey)
  if (row) {
    await db
      .from("ai_chat_threads")
      .update({ messages: [...(row.messages ?? []), ...add], updated_at: new Date().toISOString() })
      .eq("id", row.id)
  } else {
    await db.from("ai_chat_threads").insert({ user_id: userId, chat_key: chatKey, messages: add })
  }
}

/** Her pictures → her storage (ai-chat/), so the conversation keeps them as URLs. */
async function storeImages(db: SupabaseClient, userId: string, dataUrls: string[]): Promise<string[]> {
  const out: string[] = []
  for (const d of dataUrls) {
    const m = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(d)
    if (!m) continue
    const path = `${userId}/ai-chat/${crypto.randomUUID()}.${m[1] === "jpeg" ? "jpg" : m[1]}`
    const { error } = await db.storage.from("user-media").upload(path, Buffer.from(m[2], "base64"), { contentType: `image/${m[1]}` })
    if (!error) out.push(db.storage.from("user-media").getPublicUrl(path).data.publicUrl)
  }
  return out
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const postId = req.nextUrl.searchParams.get("postId") ?? ""
  const format = req.nextUrl.searchParams.get("format") ?? ""
  if (!postId || !format) return NextResponse.json({ error: "postId and format are required" }, { status: 400 })
  const chatKey = keyFor(postId, format)
  const db = untyped(supabase)
  const [thread, { data: job }] = await Promise.all([
    loadThread(db, user.id, chatKey),
    db
      .from("ai_edit_jobs")
      .select("id, status, progress, outcome, updated_at")
      .eq("user_id", user.id)
      .eq("chat_key", chatKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  return NextResponse.json({ messages: thread?.messages ?? [], job: job ?? null })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    postId?: string
    format?: string
    text?: string
    images?: unknown
    /** Per image (same order): a Drive video's link when that picture is its frame. */
    videos?: unknown
    action?: string
  }
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canUseEditAgent(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })
  const postId = body.postId ?? ""
  const format = body.format ?? ""
  if (!postId || format !== "b_roll") return NextResponse.json({ error: "b_roll only for now" }, { status: 400 })
  const chatKey = keyFor(postId, format)
  const db = untyped(supabase)
  const admin = untyped(createAdminClient())

  // The post must be hers.
  const { data: post } = await supabase.from("core_posts").select("id").eq("id", postId).eq("user_id", user.id).maybeSingle()
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

  if (body.action === "new") {
    await db
      .from("ai_chat_threads")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("chat_key", chatKey)
      .is("archived_at", null)
    return NextResponse.json({ ok: true })
  }

  const text = body.text?.trim() ?? ""
  const attached = parseReferences(body.images)
  if (!text && !attached.length) return NextResponse.json({ error: "text is required" }, { status: 400 })

  // One run at a time per conversation (a stale one older than 15 min is over).
  const { data: running } = await admin
    .from("ai_edit_jobs")
    .select("id, updated_at")
    .eq("user_id", user.id)
    .eq("chat_key", chatKey)
    .eq("status", "running")
    .gte("updated_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1)
    .maybeSingle()
  if (running) return NextResponse.json({ error: "busy", message: "אני עוד עובד על הבקשה הקודמת. רגע, ואז נמשיך." }, { status: 409 })

  const { data: variant } = await supabase
    .from("format_variants")
    .select("id, body")
    .eq("core_post_id", postId)
    .eq("format", "b_roll")
    .maybeSingle()
  const v = variant as { id: string; body: string | null } | null
  const { data: asset } = v
    ? await supabase
        .from("media_assets")
        .select("url")
        .eq("format_variant_id", v.id)
        .in("asset_type", ["video", "image"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }
  const mediaUrl = (asset as { url: string | null } | null)?.url ?? null
  // Her own b-roll: the improved chat, caption look only (gated, Hani 2026-11-10).
  const ownCaption = !!mediaUrl && isOwnMediaUrl(mediaUrl) && canEditOwnBRollCaption(user.email)
  const clipUrl = mediaUrl && isVideoLike(mediaUrl) ? mediaUrl : null
  // IRON RULE: her own media is not the composition agent's.
  const composition = clipUrl && !isOwnMediaUrl(clipUrl) ? await loadComposition(supabase, clipUrl) : null

  const herImages = await storeImages(admin, user.id, attached)
  const now = () => new Date().toISOString()
  const userMsg: AgentMessage = { role: "user", text, ...(herImages.length ? { images: herImages } : {}), at: now() }
  const earlier = (await loadThread(db, user.id, chatKey))?.messages ?? []
  await appendMessages(admin, user.id, chatKey, [userMsg])

  const refuse = async (reply: string) => {
    await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: reply, at: now() }])
    return NextResponse.json({ refused: true })
  }
  if (!ownCaption && (!clipUrl || !composition)) {
    return refuse(
      clipUrl && isOwnMediaUrl(clipUrl)
        ? "זה בי-רול מהמדיה שלכם, ובו אני לא נוגע. הצ׳אט עובד רק על בי-רול שנוצר בשפה הוויזואלית שלכם."
        : "אין עדיין בי-רול שנוצר בשפה הוויזואלית שלכם בפוסט הזה. צרו אחד, ואז נעבוד עליו יחד.",
    )
  }

  let anthropicKey: string
  try {
    anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
  } catch {
    return refuse("כדי שאוכל לעבוד צריך לחבר מפתח Claude בהגדרות.")
  }
  const openaiKey = await getUserApiKey(supabase, "openai_api_key").catch(() => null)

  const { data: jobRow } = await admin
    .from("ai_edit_jobs")
    .insert({ user_id: user.id, post_id: postId, format, chat_key: chatKey, progress: "מתחיל..." })
    .select("id")
    .single()
  const jobId = (jobRow as { id: string } | null)?.id
  if (!jobId) return NextResponse.json({ error: "job_failed" }, { status: 500 })

  const history: ChatTurn[] = earlier
    .filter((m) => !m.error)
    .map((m) => ({ role: m.role, text: m.text, images: m.images?.length }))
  const setJob = async (patch: Record<string, unknown>): Promise<void> => {
    await admin.from("ai_edit_jobs").update({ ...patch, updated_at: now() }).eq("id", jobId)
  }

  const videoRefs: (string | null)[] = Array.isArray(body.videos)
    ? (body.videos as unknown[]).map((v) => {
        if (typeof v !== "string") return null
        if (v.startsWith("drive:")) {
          const id = extractDriveFileId(v.slice(6))
          return id ? `drive:${id}` : null
        }
        // Only her own folder.
        if (v.startsWith(`storage:${user.id}/`)) return v
        return null
      })
    : []
  // The own-b-roll caption runs through our caption routes as her.
  const origin = new URL(req.url).origin
  const cookie = req.headers.get("cookie") ?? ""
  after(async () => {
    try {
      const outcome: BRollAgentOutcome = ownCaption
        ? await runOwnBRollAgent({
            db: admin,
            postId,
            anthropicKey,
            mediaUrl: mediaUrl!,
            script: scriptTextFor("b_roll", v?.body),
            history,
            request: text || "(she attached pictures without words)",
            attached,
            attachedUrls: herImages,
            attachedVideos: videoRefs,
            publicUrl: (p) => admin.storage.from("user-media").getPublicUrl(p).data.publicUrl,
            setProgress: (progress) => setJob({ progress }),
            call: async <T,>(path: string, payload: unknown) => {
              const res = await fetch(new URL(path, origin), {
                method: "POST",
                headers: { "Content-Type": "application/json", cookie },
                body: JSON.stringify(payload),
              })
              return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T }
            },
          })
        : await runBRollAgent({
        db: admin,
        userId: user.id,
        postId,
        anthropicKey,
        openaiKey,
        canBlend: canBlendBRoll(user.email),
        canReplacePhoto: driveInBRoll(user.email),
        clipUrl: clipUrl!,
        composition: composition!,
        script: scriptTextFor("b_roll", v?.body),
        history,
        request: text || "(she attached pictures without words)",
        attached,
        attachedVideos: videoRefs,
        setProgress: (progress) => setJob({ progress }),
      })
      if (outcome.kind === "ask") {
        await appendMessages(admin, user.id, chatKey, [
          { role: "assistant", text: outcome.question, options: outcome.options, at: now() },
        ])
        await setJob({ status: "asking", progress: "", outcome })
      } else if (outcome.kind === "done") {
        await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: outcome.reply, at: now() }])
        await setJob({ status: "done", progress: "", outcome })
      } else {
        await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: outcome.reply, error: true, at: now() }])
        await setJob({ status: "failed", progress: "", outcome })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[edit-agent]", msg)
      const reply = isInvalidClaudeKey(msg)
        ? CLAUDE_KEY_INVALID_MESSAGE
        : msg === "composition_invalid" || msg === "composition_not_seekable"
          ? "העיצוב שיצא לא היה תקין, אז השארתי את הבי-רול כמו שהיה. נסו שוב, אולי בניסוח אחר."
          : `משהו נתקע בדרך (${msg.slice(0, 120)}), אז הבי-רול נשאר כמו שהיה. נסו שוב.`
      await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: reply, error: true, at: now() }])
      await setJob({ status: "failed", progress: "", outcome: { kind: "failed", reply } })
    }
  })

  return NextResponse.json({ jobId })
}
