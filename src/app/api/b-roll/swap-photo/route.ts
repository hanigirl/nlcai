import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { driveInBRoll, holdsBRollText } from "@/lib/feature-access"
import { finalizeHtml, holdsText, reviseBRoll } from "@/lib/broll-animation/compose"
import { renderDistributed } from "@/lib/broll-animation/distributed"
import { loadComposition, saveBRoll } from "@/lib/broll-animation/store"
import { driveFileBytes, storeLibraryImage, storeLibraryVideo } from "@/lib/broll-animation/library-media"

export const maxDuration = 800

/**
 * "החלפת תמונה" on a visual-language b-roll (Hani, 2026-11-10, gated
 * DRIVE_IN_BROLL_EMAILS): after the first generation she picks another
 * picture — from her Drive b-roll folder or her computer — and it takes the
 * photo's place in the SAME composition, under the same blend recipe
 * (compose.ts, "HER OWN PICTURE"): one look for all her b-rolls.
 *
 * A clip that already has her photo: the new one replaces it in the template
 * as is — no AI, so text, layout and motion stay exactly. A clip without one:
 * Opus works it in by the recipe, keeping the rest.
 *
 * Not the chat (iron rule: the chat never touches her Drive media) — her own
 * click on the media.
 *
 * POST { postId, driveId } | { postId, image: dataUrl } → { url } | { error, message }
 */

const MAX_UPLOAD = 8_000_000

function fail(message: string, status = 400) {
  return NextResponse.json({ error: "swap_failed", message }, { status })
}

export async function POST(req: NextRequest) {
  const tmpFiles: string[] = []
  try {
    const { postId, driveId, kind, image, video } = (await req.json().catch(() => ({}))) as {
      postId?: string
      driveId?: string
      kind?: "image" | "video"
      image?: string
      /** A video from her computer, already in her storage (path). */
      video?: string
    }
    if (!postId || (!driveId && !image && !video)) return fail("חסרה תמונה.")

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!driveInBRoll(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: post } = await supabase.from("core_posts").select("id").eq("id", postId).eq("user_id", user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })
    const { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", postId)
      .eq("format", "b_roll")
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
    const clipUrl = (asset as { url: string | null } | null)?.url ?? null
    const composition = clipUrl ? await loadComposition(supabase, clipUrl) : null
    if (!composition) return fail("אפשר להחליף תמונה רק בבי-רול שנוצר בשפה הויזואלית. צרו בי-רול ואז החליפו.")

    // Her picture → bytes.
    let file: Buffer | null = null
    const isVideo = !!video || kind === "video"
    if (video) {
      if (!video.startsWith(`${user.id}/`)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      const { data } = await supabase.storage.from("user-media").download(video)
      file = data ? Buffer.from(await data.arrayBuffer()) : null
      if (!file) return fail("לא הצלחתי לקרוא את הסרטון. נסו שוב.")
    } else if (driveId) {
      file = await driveFileBytes(driveId)
      if (!file) return fail("לא הצלחתי להביא את התמונה מהדרייב. נסו שוב או בחרו תמונה אחרת.")
    } else {
      const b64 = String(image).split(",")[1] ?? ""
      file = Buffer.from(b64, "base64")
      if (!file.length || file.length > MAX_UPLOAD) return fail("התמונה גדולה מדי או לא נקראה. נסו תמונה אחרת.")
    }

    const stamp = crypto.randomUUID()
    const photo = await (isVideo ? storeLibraryVideo : storeLibraryImage)(supabase, user.id, stamp, file).catch(() => null)
    if (!photo) return fail(isVideo ? "לא הצלחתי לקרוא את הסרטון. נסו סרטון אחר." : "לא הצלחתי לקרוא את התמונה. נסו קובץ JPG או PNG.")

    const libraryMedia = { url: photo.url, kind: photo.kind, width: photo.width, height: photo.height }
    const brief = { ...composition.brief, libraryMedia }
    const old = composition.brief.libraryMedia?.url
    let template: string
    if (old && composition.brief.libraryMedia?.kind === photo.kind && composition.template.includes(old)) {
      template = composition.template.split(old).join(photo.url)
    } else {
      const anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
      template = await reviseBRoll(
        anthropicKey,
        brief,
        composition.template,
        "Work HER OWN PICTURE (in the brief) into this composition with exactly its layer recipe. Keep the text, typography, graphic elements and motion as they are.",
      )
    }

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-swap-${stamp}.mp4`)
    tmpFiles.push(outPath)
    await renderDistributed(finalizeHtml(template, composition.backgroundUrl, brief.fonts, { holdText: holdsText(brief) || holdsBRollText(user.email) }), outPath, new URL(req.url).origin)
    const clip = await fs.readFile(outPath)
    const url = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      ...composition,
      brief,
      template,
      edits: [...composition.edits, "(החלפת התמונה)"],
    })
    return NextResponse.json({ url })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/swap-photo]", msg)
    return NextResponse.json(
      { error: msg, message: msg === "anthropic_not_connected" ? "כדי לשלב תמונה צריך לחבר מפתח Claude בהגדרות." : "ההחלפה לא הצליחה הפעם. נסו שוב." },
      { status: 500 },
    )
  } finally {
    const fs = await import("fs/promises")
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)))
  }
}
