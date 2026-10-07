import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { reviseBrandFormatSpec, reviseNicheToneSpec } from "@/lib/agents/visual-language-analyzer"
import { resolveOwnImagePath } from "@/lib/visual-language/media-source"
import {
  DISLIKE_REASONS,
  type DislikeReason,
  type NicheVisualLanguage,
  type StyleFeedback,
  type VisualFormat,
  type VisualLanguage,
} from "@/lib/visual-language/types"

/**
 * 👍 / 👎 on any AI media (every format but the avatar), in any style.
 * The brief behind a style is written once; feedback is what may change it
 * (Hani, 2026-10-07).
 *
 * Slots:
 * - "ai-dark" / "ai-light" → that tone of her NICHE language
 *   (users.niche_visual_language.feedback[tone], brief = [tone]_spec)
 * - "brand" → that FORMAT of her own visual language
 *   (users.visual_language.feedback[format], brief = formats[format])
 *
 * like    → slot approved; the image is copied as the slot's style anchor,
 *           sent as a visual reference with every future image there.
 * dislike → the slot's brief is rewritten ONCE with her reasons; approval
 *           and anchor are dropped.
 *
 * Body: { style, format, verdict, mediaUrl?, postId?, reasons?, note? }
 */

const FORMATS: VisualFormat[] = ["carousel", "story", "image_post", "b_roll"]

type Supabase = Awaited<ReturnType<typeof createClient>>

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    style?: string
    format?: string
    verdict?: string
    mediaUrl?: string
    postId?: string
    reasons?: string[]
    note?: string
  }
  const style = body.style === "brand" || body.style === "ai-dark" || body.style === "ai-light" ? body.style : null
  const verdict = body.verdict === "like" || body.verdict === "dislike" ? body.verdict : null
  const format = FORMATS.find((f) => f === body.format)
  if (!style || !verdict || !format) {
    return NextResponse.json({ error: "style, verdict and format are required" }, { status: 400 })
  }

  const reasons = (body.reasons ?? []).filter((r): r is DislikeReason => r in DISLIKE_REASONS)
  const vote = {
    verdict,
    format,
    ...(reasons.length ? { reasons } : {}),
    ...(body.note?.trim() ? { note: body.note.trim().slice(0, 600) } : {}),
    at: new Date().toISOString(),
  } as StyleFeedback["votes"][number]

  const { data: row } = await supabase
    .from("users")
    .select("visual_language, niche_visual_language")
    .eq("id", user.id)
    .single()
  const r = row as {
    visual_language?: VisualLanguage | null
    niche_visual_language?: NicheVisualLanguage | null
  } | null

  // Load the slot.
  let prev: StyleFeedback
  let brief: string
  if (style === "brand") {
    const vl = r?.visual_language
    if (!vl || vl.status !== "ok") {
      return NextResponse.json({ error: "no_visual_language", message: "אין שפה ויזואלית מנותחת." }, { status: 400 })
    }
    prev = vl.feedback?.[format] ?? { approved: false, votes: [] }
    brief = vl.formats?.[format] ?? ""
  } else {
    const tone = style === "ai-dark" ? "dark" : "light"
    const nvl = r?.niche_visual_language
    const spec = nvl?.[`${tone}_spec`]
    if (!nvl || !spec) {
      return NextResponse.json(
        { error: "no_niche_language", message: "עוד אין שפת נישה שמורה לגוון הזה. צרו קודם מדיה בסגנון הזה." },
        { status: 400 },
      )
    }
    prev = nvl.feedback?.[tone] ?? { approved: false, votes: [] }
    brief = spec
  }

  let nextSlot: StyleFeedback
  let nextBrief: string | null = null
  let message: string

  if (verdict === "like") {
    const anchorPath = await copyAnchor(supabase, user.id, style, format, body.mediaUrl, body.postId)
    if (anchorPath && prev.anchor_path) await supabase.storage.from("user-media").remove([prev.anchor_path])
    nextSlot = {
      approved: true,
      anchor_path: anchorPath ?? prev.anchor_path,
      votes: [...prev.votes, vote].slice(-20),
    }
    message =
      style === "brand"
        ? "מעולה! מעכשיו מדיה בפורמט הזה בשפה שלך תיווצר לפי התמונה הזו."
        : "מעולה! מעכשיו כל מדיה בסגנון הזה תיווצר לפי התמונה הזו."
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
    const reasonText = reasons.map((x) => DISLIKE_REASONS[x])
    let revised: { style_spec: string; summary_he: string }
    try {
      revised =
        style === "brand"
          ? await reviseBrandFormatSpec(apiKey, {
              styleSpec: r!.visual_language!.style_spec,
              format,
              formatSpec: brief,
              reasons: reasonText,
              note: body.note,
            })
          : await reviseNicheToneSpec(apiKey, {
              niche: r!.niche_visual_language!.niche,
              tone: style === "ai-dark" ? "dark" : "light",
              spec: brief,
              reasons: reasonText,
              note: body.note,
            })
    } catch (err) {
      console.error("[style-feedback][revise]", err)
      return NextResponse.json({ error: "revise_failed", message: "לא הצלחנו לעדכן את השפה. נסו שוב." }, { status: 500 })
    }
    if (prev.anchor_path) await supabase.storage.from("user-media").remove([prev.anchor_path])
    nextSlot = { approved: false, votes: [...prev.votes, vote].slice(-20) }
    nextBrief = revised.style_spec
    message = revised.summary_he
  }

  // Write the slot back.
  let update: Record<string, unknown>
  if (style === "brand") {
    const vl = r!.visual_language!
    update = {
      visual_language: {
        ...vl,
        ...(nextBrief !== null ? { formats: { ...vl.formats, [format]: nextBrief } } : {}),
        feedback: { ...vl.feedback, [format]: nextSlot },
      } satisfies VisualLanguage,
    }
  } else {
    const tone = style === "ai-dark" ? "dark" : "light"
    const nvl = r!.niche_visual_language!
    update = {
      niche_visual_language: {
        ...nvl,
        ...(nextBrief !== null ? { [`${tone}_spec`]: nextBrief } : {}),
        feedback: { ...nvl.feedback, [tone]: nextSlot },
      } satisfies NicheVisualLanguage,
    }
  }
  const { error } = await supabase.from("users").update(update as never).eq("id", user.id)
  if (error) {
    console.error("[style-feedback][save]", error)
    return NextResponse.json({ error: "save_failed", message: "הפידבק לא נשמר. נסו שוב." }, { status: 500 })
  }
  return NextResponse.json({ ok: true, message })
}

/**
 * Copy the liked image to a stable path so deleting the post can't break the
 * anchor. Null when there's no usable image (a b-roll is a video — its like
 * still approves the slot).
 */
async function copyAnchor(
  supabase: Supabase,
  userId: string,
  style: string,
  format: string,
  mediaUrl?: string,
  postId?: string,
): Promise<string | null> {
  const source = await resolveOwnImagePath(supabase, userId, format, mediaUrl, postId)
  if (!source) return null
  const ext = source.split(".").pop() || "png"
  const dest = `${userId}/style-anchor/${style}-${format}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from("user-media").copy(source, dest)
  if (error) {
    console.error("[style-feedback][copy-anchor]", error)
    return null
  }
  return dest
}
