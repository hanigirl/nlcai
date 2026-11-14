/**
 * A brand-language story frame that is HER video (Hani, 2026-11-14): when she
 * has story usage examples, the frame looks like them — her video blended into
 * her brand language by the b-roll engine (lib/broll-animation, the approved
 * "HER OWN VIDEO/PICTURE" recipe), with that frame's text, composed after her
 * story examples. Without story examples, the caller burns the frame's text
 * over the video plainly instead (api/story/generate-video-media).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { extractDriveFileId } from "@/lib/drive-media"
import { driveFileBytes, storeLibraryVideo } from "@/lib/broll-animation/library-media"
import { BACKGROUND_FRAMINGS, buildBackgroundPrompt, cropToCanvas } from "@/lib/broll-animation/background"
import { buildCompositionBrief } from "@/lib/broll-animation/brief"
import { composeBRoll, finalizeHtml } from "@/lib/broll-animation/compose"
import { holdTextAtStart } from "@/lib/broll-animation/text-hold"
import { renderDistributed } from "@/lib/broll-animation/distributed"
import { uploadBackground } from "@/lib/broll-animation/store"
import { generateImage } from "@/lib/openai-image"
import { loadBrandExamples, resolveDesignDirection } from "@/lib/visual-language/direction"
import { withGraphicOnly } from "@/lib/visual-language/graphic-only"

/** She filed story examples (Settings → דוגמאות לשימוש → סטורי). */
export async function hasStoryExamples(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_media")
    .select("id")
    .eq("user_id", userId)
    .eq("category", "brand_example")
    .eq("metadata->>kind", "story")
    .limit(1)
  return (data ?? []).length > 0
}

export async function designedStoryVideoFrame(input: {
  supabase: SupabaseClient
  userId: string
  email: string | null | undefined
  origin: string
  anthropicKey: string
  openaiKey: string
  driveUrl: string
  text: { hook: string; rest?: string }
}): Promise<Buffer> {
  const { supabase, userId } = input
  const stamp = crypto.randomUUID()
  const id = extractDriveFileId(input.driveUrl)
  const bytes = id ? await driveFileBytes(id) : null
  if (!bytes) throw new Error("story_video_unreadable")
  const library = await storeLibraryVideo(supabase, userId, stamp, bytes)

  // The background: her language, graphics only (no invented faces).
  const direction = withGraphicOnly(
    await resolveDesignDirection(supabase, userId, { format: "b_roll", allowReferences: false, style: "brand" }),
    input.email,
  )
  const [brief, examples] = await Promise.all([
    buildCompositionBrief(supabase, userId, input.text, direction.lines, "brand"),
    // Her STORY examples set the composition (not her b-roll ones).
    loadBrandExamples(supabase, userId, "story", undefined),
  ])
  brief.libraryMedia = { url: library.url, kind: library.kind, width: library.width, height: library.height }

  const [raw, composed] = await Promise.all([
    generateImage(input.openaiKey, buildBackgroundPrompt(direction, BACKGROUND_FRAMINGS[0], ""), {
      shape: "9:16",
      references: direction.references,
    }),
    composeBRoll(input.anthropicKey, brief, 0, examples, []),
  ])
  const backgroundUrl = await uploadBackground(supabase, userId, stamp, Buffer.from(cropToCanvas(raw), "base64"))
  // Text visible from the first frame (all formats, Hani 2026-11-12).
  const toHtml = (t: string) => finalizeHtml(t, backgroundUrl, brief.fonts, { holdText: true })
  const template = await holdTextAtStart(input.anthropicKey, brief, composed, toHtml)

  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const outPath = path.join(os.tmpdir(), `story-frame-${stamp}.mp4`)
  try {
    await renderDistributed(toHtml(template), outPath, input.origin, {})
    return await fs.readFile(outPath)
  } finally {
    await fs.unlink(outPath).catch(() => undefined)
  }
}
