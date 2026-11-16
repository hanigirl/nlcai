import { extractDriveFileId } from "@/lib/drive-media"
import { brandTerms } from "@/lib/brand-terms"
import { parseOwnCaptionOffer, saveOwnCaptionLook } from "@/lib/own-caption-look"
import { after, NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { afterGenChoices, canBlendBRoll, canEditOwnBRollCaption, driveInBRoll, canUseEditAgent, qaFixes1112 } from "@/lib/feature-access"
import { loadComposition } from "@/lib/broll-animation/store"
import { isOwnMediaUrl } from "@/lib/own-media"
import { scriptTextFor } from "@/lib/script-text"
import { parseReferences, resolveReferences } from "@/lib/ai-edit-references"
import { loadCarousel, saveCarousel, type StoredCarousel } from "@/lib/carousel-composition"
import { knownProviderError } from "@/lib/claude-credits"
import { runBRollAgent, type BRollAgentOutcome, type ChatTurn } from "@/lib/edit-agent/broll-agent"
import { runOwnBRollAgent } from "@/lib/edit-agent/own-broll-agent"
import { runStoryAgent } from "@/lib/edit-agent/story-agent"
import { triageVisualMemory } from "@/lib/style-memory"

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
  /** The change as a lasting preference: the "זכור לעתיד" button under this reply saves it. */
  remember?: string
  /** The media before this reply's change — "חזרה לגרסה הקודמת" puts it back (Hani, 2026-11-14). */
  undo?: string[]
  /** The stored carousel layout from before this reply's change — undo puts it back too. */
  undoComposition?: string
  /** Per picture of hers (same order as images): the video it is the frame of. */
  videos?: (string | null)[]
  at: string
}

/** A run that hasn't reported for this long died (the function was killed before its catch ran). */
const STALE_MS = 15 * 60_000

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
  // A run killed mid-way (timeout, a render crash) never reaches its catch and
  // stays "running" — the chat would be locked forever. Close it here.
  const j = job as { id: string; status: string; updated_at: string } | null
  if (j?.status === "running" && Date.now() - new Date(j.updated_at).getTime() > STALE_MS) {
    const admin = untyped(createAdminClient())
    const reply = "הבקשה הקודמת נתקעה באמצע ולא הסתיימה, אז המדיה נשארה כמו שהייתה. אפשר לנסות שוב."
    const stamp = new Date().toISOString()
    const { data: closed } = await admin
      .from("ai_edit_jobs")
      .update({ status: "failed", progress: "", outcome: { kind: "failed", reply }, updated_at: stamp })
      .eq("id", j.id)
      .eq("status", "running")
      .select("id")
    if ((closed ?? []).length) await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: reply, error: true, at: stamp }])
    const fresh = await loadThread(db, user.id, chatKey)
    return NextResponse.json({ messages: fresh?.messages ?? [], job: { ...j, status: "failed", progress: "", outcome: { kind: "failed", reply } } })
  }
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
    /** She pressed "זכור לעתיד" under a reply: the preference that reply offered. */
    remember?: unknown
  }
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canUseEditAgent(user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 })
  const postId = body.postId ?? ""
  const format = body.format ?? ""
  if (!postId || (format !== "b_roll" && format !== "story" && format !== "image_post" && format !== "carousel")) {
    return NextResponse.json({ error: "b_roll, story, image_post and carousel only for now" }, { status: 400 })
  }
  // The frame agent's formats (lib/edit-agent/story-agent): a story's set, or an image post's one picture.
  const isStory = format === "story" || format === "image_post" || format === "carousel"
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

  // "חזרה לגרסה הקודמת" (Hani, 2026-11-14): the media from before the last
  // change goes back on the card, through the same save as an edit.
  if (body.action === "undo") {
    const { data: busyRun } = await admin
      .from("ai_edit_jobs")
      .select("id")
      .eq("user_id", user.id)
      .eq("chat_key", chatKey)
      .eq("status", "running")
      .gte("updated_at", new Date(Date.now() - STALE_MS).toISOString())
      .limit(1)
      .maybeSingle()
    if (busyRun) return NextResponse.json({ error: "busy", message: "אני עוד עובד על הבקשה הקודמת. רגע, ואז נמשיך." }, { status: 409 })
    const row = await loadThread(db, user.id, chatKey)
    const msgs = row?.messages ?? []
    const at = msgs.map((m) => !!m.undo?.length).lastIndexOf(true)
    if (!row || at < 0) return NextResponse.json({ error: "nothing_to_undo", message: "אין גרסה קודמת לחזור אליה." }, { status: 400 })
    const urls = msgs[at].undo!
    const res = await fetch(new URL("/api/media/own-edit", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
      body: JSON.stringify({ action: "save", postId, format, urls }),
    })
    if (!res.ok) return NextResponse.json({ error: "undo_failed", message: "לא הצלחתי לחזור לגרסה הקודמת. נסו שוב." }, { status: 500 })
    // A carousel's layout goes back with its slides, or every later edit loses
    // the precise layout path (the stored layout no longer matches the slides).
    const compPath = msgs[at].undoComposition
    if (compPath) {
      const { data: blob } = await admin.storage.from("user-media").download(compPath)
      const comp = blob ? (JSON.parse(await blob.text().catch(() => "null")) as StoredCarousel | null) : null
      if (comp) await saveCarousel(admin, user.id, postId, comp).catch((e) => console.error("[edit-agent] undo composition", e))
    }
    const stamp = new Date().toISOString()
    const reply = "חזרתי לגרסה הקודמת, היא כבר בכרטיס."
    await db
      .from("ai_chat_threads")
      .update({
        messages: [
          ...msgs.map((m, i) => (i === at ? { ...m, undo: undefined, undoComposition: undefined, remember: undefined } : m)),
          { role: "user", text: "חזרה לגרסה הקודמת", at: stamp },
          { role: "assistant", text: reply, at: stamp },
        ],
        updated_at: stamp,
      })
      .eq("id", row.id)
    // A finished job: the page applies it to the card like any agent result.
    const { data: jobRow } = await admin
      .from("ai_edit_jobs")
      .insert({ user_id: user.id, post_id: postId, format, chat_key: chatKey, progress: "", status: "done", outcome: { kind: "done", reply, url: urls[0], urls, changed: true } })
      .select("id")
      .single()
    return NextResponse.json({ jobId: (jobRow as { id: string } | null)?.id ?? null })
  }

  const text = body.text?.trim() ?? ""
  const rememberAsk = typeof body.remember === "string" ? body.remember.trim().slice(0, 1200) : ""
  // What the agent reads: her words, and what the button she pressed stands for.
  const agentRequest = rememberAsk
    ? `${text || "זכור לעתיד"}\n(She pressed the "זכור לעתיד" button under your last reply. Save exactly this as a lasting preference with the remember tool, change nothing in the media, then finish saying whether it was saved: ${rememberAsk})`
    : text || "(she attached pictures without words)"
  const attached: string[] = parseReferences(body.images)
  if (!text && !attached.length) return NextResponse.json({ error: "text is required" }, { status: 400 })

  // One run at a time per conversation (a stale one older than 15 min is over).
  const { data: running } = await admin
    .from("ai_edit_jobs")
    .select("id, updated_at")
    .eq("user_id", user.id)
    .eq("chat_key", chatKey)
    .eq("status", "running")
    .gte("updated_at", new Date(Date.now() - STALE_MS).toISOString())
    .limit(1)
    .maybeSingle()
  if (running) return NextResponse.json({ error: "busy", message: "אני עוד עובד על הבקשה הקודמת. רגע, ואז נמשיך." }, { status: 409 })

  const { data: variant } = await supabase
    .from("format_variants")
    .select("id, body, drive_slide_links")
    .eq("core_post_id", postId)
    .eq("format", format)
    .maybeSingle()
  const v = variant as { id: string; body: string | null; drive_slide_links?: string[] | null } | null
  // A story is a SET: its frames in order (the image rows, then a clip left
  // in the video slot) — the order the card shows (api/media/own-edit).
  const loadSet = async (dbc: SupabaseClient): Promise<string[]> => {
    if (!isStory || !v) return []
    const { data: rows } = await dbc
      .from("media_assets")
      .select("url, asset_type")
      .eq("format_variant_id", v.id)
      .in("asset_type", ["image", "video"])
      .order("created_at", { ascending: true })
    const all = ((rows ?? []) as { url: string | null; asset_type: string }[]).filter((r): r is { url: string; asset_type: string } => !!r.url && /^https?:\/\//.test(r.url))
    const images = all.filter((r) => r.asset_type === "image").map((r) => r.url)
    return format === "image_post"
      ? images.slice(-1)
      : format === "carousel"
        ? // Pictures and video slides, in her order.
          all.map((r) => r.url)
        : [...images, ...all.filter((r) => r.asset_type === "video" && !images.includes(r.url)).map((r) => r.url)]
  }
  const storyUrls = await loadSet(supabase)
  const { data: asset } = v && !isStory
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

  let videoRefs: (string | null)[] = Array.isArray(body.videos)
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
  const herImages = await storeImages(admin, user.id, attached)
  const now = () => new Date().toISOString()
  const userMsg: AgentMessage = {
    role: "user",
    text,
    ...(herImages.length ? { images: herImages, ...(videoRefs.some(Boolean) ? { videos: videoRefs.slice(0, herImages.length) } : {}) } : {}),
    at: now(),
  }
  const earlier = (await loadThread(db, user.id, chatKey))?.messages ?? []
  // Pictures from an earlier message stay in reach (QA 2026-11-15: "היא צורפה
  // בהודעה הקודמת… צרפו אותה שוב"): with none on this message, the ones she
  // sent last (within her last few messages) ride along as this message's.
  let carried = false
  let carriedUrls: string[] = []
  if (!attached.length && !rememberAsk) {
    const lastWithPics = earlier
      .slice(-6)
      .reverse()
      .find((m) => m.role === "user" && m.images?.length)
    if (lastWithPics?.images?.length) {
      const resolved = await resolveReferences(lastWithPics.images, user.id, 3).catch(() => [] as string[])
      if (resolved.length === lastWithPics.images.length) {
        attached.push(...resolved)
        videoRefs = lastWithPics.videos ?? []
        carried = true
        carriedUrls = lastWithPics.images
      }
    }
  }
  await appendMessages(admin, user.id, chatKey, [userMsg])

  // "זכור לעתיד" under a caption change on her own media: saved here as her
  // caption look (lib/own-caption-look) — no agent run, no credits.
  const ownLook = rememberAsk ? parseOwnCaptionOffer(rememberAsk) : null
  if (ownLook) {
    let reply = "שמרתי. מעכשיו הכיתוב על המדיה שלכם ייראה ככה בכל הפורמטים."
    try {
      await saveOwnCaptionLook(admin, user.id, ownLook)
    } catch (err) {
      console.error("[edit-agent] own caption look save failed", err)
      reply = "לא הצלחתי לשמור את מראה הכיתוב. נסו שוב."
    }
    await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: reply, at: now() }])
    return NextResponse.json({ ok: true })
  }

  const refuse = async (said: string) => {
    const reply = brandTerms(said, qaFixes1112(user.email))
    await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: reply, at: now() }])
    return NextResponse.json({ refused: true })
  }
  if (isStory && !storyUrls.length) {
    return refuse(
      format === "image_post"
        ? "אין עדיין תמונה בפוסט הזה. צרו אחת בשפה הוויזואלית שלכם או חברו תמונה משלכם, ואז נעבוד עליה יחד."
        : format === "carousel"
          ? "אין עדיין קרוסלה בפוסט הזה. צרו אחת בשפה הוויזואלית שלכם או חברו מדיה משלכם, ואז נעבוד עליה יחד."
        : "אין עדיין מדיה בסטורי הזה. צרו סטורי בשפה הוויזואלית שלכם או חברו מדיה משלכם, ואז נעבוד עליו יחד.",
    )
  }
  if (!isStory && !ownCaption && (!clipUrl || !composition)) {
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

  // "זכור לעתיד" on designed media: saved straight to her preferences — one
  // short call, not a whole agent turn with stills of every frame (QA
  // 2026-11-15). Only a conflict with a saved preference goes to the agent,
  // which asks her which one wins.
  if (rememberAsk) {
    const r = await triageVisualMemory(admin, user.id, anthropicKey, { instruction: rememberAsk, format: format as "carousel" | "story" | "image_post" | "b_roll", explicit: true }).catch(() => null)
    const m = r?.memory
    const said =
      m?.kind === "saved"
        ? `שמרתי: ${m.summary}. זה מופיע בהגדרות ← מדיה ← העדפות ויזואליות.`
        : m?.kind === "settings"
          ? `את זה לא שומרים בהעדפות: ${m.summary}. זה נקבע בהגדרות ← מדיה ← שפת המותג.`
          : null
    if (said) return refuse(said)
  }

  const { data: jobRow } = await admin
    .from("ai_edit_jobs")
    .insert({ user_id: user.id, post_id: postId, format, chat_key: chatKey, progress: "מתחיל..." })
    .select("id")
    .single()
  const jobId = (jobRow as { id: string } | null)?.id
  if (!jobId) return NextResponse.json({ error: "job_failed" }, { status: 500 })

  const requestText = carried
    ? `${agentRequest}\n(No new picture with this message: the attached pictures are the ones she sent in an earlier message of this conversation. Use them only if her words are about them.)`
    : agentRequest
  // Failures stay in the agent's memory, marked, so it knows what didn't work (QA 2026-11-15).
  const history: ChatTurn[] = earlier.map((m) => ({
    role: m.role,
    text: m.error ? `[THIS FAILED — nothing was changed by it] ${m.text}` : m.text,
    images: m.images?.length,
  }))
  const setJob = async (patch: Record<string, unknown>): Promise<void> => {
    await admin.from("ai_edit_jobs").update({ ...patch, updated_at: now() }).eq("id", jobId)
  }

  // The own-b-roll caption runs through our caption routes as her.
  const origin = new URL(req.url).origin
  const cookie = req.headers.get("cookie") ?? ""
  const asHer = async <T,>(path: string, payload: unknown) => {
    const res = await fetch(new URL(path, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(payload),
    })
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T }
  }
  // What the card shows now — the version "חזרה לגרסה הקודמת" restores.
  const before = isStory ? storyUrls : mediaUrl ? [mediaUrl] : []
  // A carousel's layout as it is now, so undo can put it back with the slides.
  const compBefore = format === "carousel" ? await loadCarousel(admin, user.id, postId).catch(() => null) : null
  const snapshotLayout = async (): Promise<string | undefined> => {
    if (!compBefore) return undefined
    const path = `${user.id}/carousel-undo/${postId}-${crypto.randomUUID()}.json`
    const { error } = await admin.storage.from("user-media").upload(path, JSON.stringify(compBefore), { contentType: "application/json" })
    return error ? undefined : path
  }
  after(async () => {
    try {
      const outcome: BRollAgentOutcome = isStory
        ? await runStoryAgent({
            db: admin,
            userId: user.id,
            email: user.email,
            postId,
            format: format === "image_post" ? "image_post" : format === "carousel" ? "carousel" : "story",
            driveLinks: v?.drive_slide_links ?? null,
            anthropicKey,
            openaiKey,
            canBlend: canBlendBRoll(user.email),
            urls: storyUrls,
            scriptBody: v?.body ?? null,
            history,
            request: requestText,
            attached,
            attachedVideos: videoRefs,
            publicUrl: (p) => admin.storage.from("user-media").getPublicUrl(p).data.publicUrl,
            setProgress: (progress) => setJob({ progress: brandTerms(progress, qaFixes1112(user.email)) }),
            call: asHer,
          })
        : ownCaption
        ? await runOwnBRollAgent({
            db: admin,
            postId,
            anthropicKey,
            mediaUrl: mediaUrl!,
            script: scriptTextFor("b_roll", v?.body),
            history,
            request: requestText,
            attached,
            attachedUrls: carried ? carriedUrls : herImages,
            attachedVideos: videoRefs,
            publicUrl: (p) => admin.storage.from("user-media").getPublicUrl(p).data.publicUrl,
            setProgress: (progress) => setJob({ progress: brandTerms(progress, qaFixes1112(user.email)) }),
            call: asHer,
          })
        : await runBRollAgent({
        origin,
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
        request: requestText,
        attached,
        attachedVideos: videoRefs,
        setProgress: (progress) => setJob({ progress: brandTerms(progress, qaFixes1112(user.email)) }),
      })
      if (outcome.kind === "ask") {
        await appendMessages(admin, user.id, chatKey, [
          { role: "assistant", text: brandTerms(outcome.question, qaFixes1112(user.email)), options: outcome.options, at: now() },
        ])
        await setJob({ status: "asking", progress: "", outcome })
      } else if (outcome.kind === "done") {
        const undoOn = outcome.changed && before.length > 0 && afterGenChoices(user.email)
        const undoComposition = undoOn ? await snapshotLayout() : undefined
        await appendMessages(admin, user.id, chatKey, [
          {
            role: "assistant",
            text: brandTerms(outcome.reply, qaFixes1112(user.email)),
            ...(outcome.rememberOffer ? { remember: outcome.rememberOffer } : {}),
            ...(undoOn ? { undo: before, ...(undoComposition ? { undoComposition } : {}) } : {}),
            at: now(),
          },
        ])
        await setJob({ status: "done", progress: "", outcome })
      } else {
        await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: outcome.reply, error: true, at: now() }])
        await setJob({ status: "failed", progress: "", outcome })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[edit-agent]", msg)
      // A tool may have SAVED a change before the run broke (a carousel edit
      // saves at once): then report what is on the card, not a failure.
      const nowSet = isStory ? await loadSet(admin).catch(() => [] as string[]) : []
      if (nowSet.length && nowSet.join("|") !== before.join("|")) {
        const reply = brandTerms("שמרתי את השינוי והוא כבר בכרטיס, אבל משהו נתקע אחרי זה, אז ייתכן שלא כל מה שביקשתם נעשה. תסתכלו ותגידו לי מה עוד לשנות.", qaFixes1112(user.email))
        const undoOn = afterGenChoices(user.email)
        const undoComposition = undoOn ? await snapshotLayout() : undefined
        await appendMessages(admin, user.id, chatKey, [
          { role: "assistant", text: reply, ...(undoOn ? { undo: before, ...(undoComposition ? { undoComposition } : {}) } : {}), at: now() },
        ])
        await setJob({ status: "done", progress: "", outcome: { kind: "done", reply, url: nowSet[0], urls: nowSet, changed: true } })
        return
      }
      const known = knownProviderError(msg)
      const reply = known
        ? known
        : msg === "composition_invalid" || msg === "composition_not_seekable"
          ? "העיצוב שיצא לא היה תקין, אז השארתי את הבי-רול כמו שהיה. נסו שוב, אולי בניסוח אחר."
          : `משהו נתקע בדרך, אז ${format === "story" ? "הסטורי" : format === "image_post" ? "פוסט התמונה" : format === "carousel" ? "מה שלא נשמר בקרוסלה" : "הבי-רול"} נשאר כמו שהיה. נסו שוב.`
      await appendMessages(admin, user.id, chatKey, [{ role: "assistant", text: reply, error: true, at: now() }])
      await setJob({ status: "failed", progress: "", outcome: { kind: "failed", reply } })
    }
  })

  return NextResponse.json({ jobId })
}
