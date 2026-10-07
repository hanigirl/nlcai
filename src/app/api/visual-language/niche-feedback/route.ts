import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { reviseNicheToneSpec } from "@/lib/agents/visual-language-analyzer"
import { resolveOwnImagePath } from "@/lib/visual-language/media-source"
import {
  DISLIKE_REASONS,
  type DislikeReason,
  type NicheToneFeedback,
  type NicheVisualLanguage,
} from "@/lib/visual-language/types"

/**
 * 👍 / 👎 on an image made in "שפת הנישה · כהה/בהיר".
 *
 * The niche language is written once and reused everywhere; feedback is
 * what's allowed to change it (Hani, 2026-10-07):
 * - like    → that tone is approved and locked; the image is copied as the
 *             tone's style anchor, sent as a visual reference with every
 *             future image in that tone (text alone drifts between images).
 * - dislike → that tone's brief is rewritten ONCE with her reasons; the
 *             approval and anchor for that tone are dropped.
 *
 * Body: { tone, format, verdict, mediaUrl?, postId?, reasons?, note? }
 * The anchor image comes from `mediaUrl` when it's a file in her own storage
 * folder, else the post's first saved image for that format.
 */

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    tone?: string
    format?: string
    verdict?: string
    mediaUrl?: string
    postId?: string
    reasons?: string[]
    note?: string
  }
  const tone = body.tone === "dark" || body.tone === "light" ? body.tone : null
  const verdict = body.verdict === "like" || body.verdict === "dislike" ? body.verdict : null
  const format = typeof body.format === "string" ? body.format.slice(0, 32) : ""
  if (!tone || !verdict || !format) {
    return NextResponse.json({ error: "tone, verdict and format are required" }, { status: 400 })
  }

  const { data: row } = await supabase
    .from("users")
    .select("niche_visual_language")
    .eq("id", user.id)
    .single()
  const nvl = (row as { niche_visual_language?: NicheVisualLanguage | null } | null)?.niche_visual_language
  const spec = nvl?.[`${tone}_spec`]
  if (!nvl || !spec) {
    return NextResponse.json(
      { error: "no_niche_language", message: "עוד אין שפת נישה שמורה לגוון הזה. צרו קודם מדיה בסגנון הזה." },
      { status: 400 },
    )
  }

  const prev: NicheToneFeedback = nvl.feedback?.[tone] ?? { approved: false, votes: [] }
  const reasons = (body.reasons ?? []).filter((r): r is DislikeReason => r in DISLIKE_REASONS)
  const vote = {
    verdict,
    format,
    ...(reasons.length ? { reasons } : {}),
    ...(body.note?.trim() ? { note: body.note.trim().slice(0, 600) } : {}),
    at: new Date().toISOString(),
  } as NicheToneFeedback["votes"][number]

  let next: NicheVisualLanguage
  let message: string

  if (verdict === "like") {
    const anchorPath = await copyAnchor(supabase, user.id, tone, format, body.mediaUrl, body.postId)
    if (anchorPath && prev.anchor_path) {
      await supabase.storage.from("user-media").remove([prev.anchor_path])
    }
    next = {
      ...nvl,
      feedback: {
        ...nvl.feedback,
        [tone]: {
          approved: true,
          anchor_path: anchorPath ?? prev.anchor_path,
          votes: [...prev.votes, vote].slice(-20),
        },
      },
    }
    message = "מעולה! מעכשיו כל מדיה בסגנון הזה תיווצר לפי התמונה הזו."
  } else {
    let apiKey: string
    try {
      apiKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch {
      return NextResponse.json(
        { error: "anthropic_not_connected", message: "כדי לעדכן את השפה לפי הפידבק צריך לחבר מפתח Claude בהגדרות ← חיבורים." },
        { status: 402 },
      )
    }
    let revised
    try {
      revised = await reviseNicheToneSpec(apiKey, {
        niche: nvl.niche,
        tone,
        spec,
        reasons: reasons.map((r) => DISLIKE_REASONS[r]),
        note: body.note,
      })
    } catch (err) {
      console.error("[niche-feedback][revise]", err)
      return NextResponse.json({ error: "revise_failed", message: "לא הצלחנו לעדכן את השפה. נסו שוב." }, { status: 500 })
    }
    if (prev.anchor_path) await supabase.storage.from("user-media").remove([prev.anchor_path])
    next = {
      ...nvl,
      [`${tone}_spec`]: revised.style_spec,
      feedback: {
        ...nvl.feedback,
        [tone]: { approved: false, votes: [...prev.votes, vote].slice(-20) },
      },
    }
    message = revised.summary_he
  }

  const { error } = await supabase
    .from("users")
    .update({ niche_visual_language: next } as never)
    .eq("id", user.id)
  if (error) {
    console.error("[niche-feedback][save]", error)
    return NextResponse.json({ error: "save_failed", message: "הפידבק לא נשמר. נסו שוב." }, { status: 500 })
  }
  return NextResponse.json({ ok: true, message })
}

/**
 * Copy the liked image to a stable path, so deleting the post later can't
 * break the anchor. Returns the new path, or null when no usable image was
 * found (a b-roll is a video — its like still approves the tone).
 */
async function copyAnchor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  tone: "dark" | "light",
  format: string,
  mediaUrl?: string,
  postId?: string,
): Promise<string | null> {
  const source = await resolveOwnImagePath(supabase, userId, format, mediaUrl, postId)
  if (!source) return null
  const ext = source.split(".").pop() || "png"
  const dest = `${userId}/style-anchor/${tone}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from("user-media").copy(source, dest)
  if (error) {
    console.error("[niche-feedback][copy-anchor]", error)
    return null
  }
  return dest
}
