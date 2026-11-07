import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserApiKey } from "@/lib/api-keys"
import { captionLines, transcribeVideo, type CaptionLine } from "@/lib/transcribe"
import { renderOwnVideoCaption, OVERLAY_SECONDS } from "@/lib/own-video-captions"
import { talkingHeadVideoUrl, transcriptionContext } from "@/lib/talking-head-video"
import { editBase, saveApplied, type Applied } from "@/lib/talking-head-original"
import { loadTalkingHeadTemplate } from "@/lib/talking-head-template"
import { detectFaces, faceZone, headZone, placeClear, type Box } from "@/lib/face-boxes"
import {
  CAPTION_BAND,
  MAX_TALKING_HEAD_SECONDS,
  elementBox,
  grabFrames,
  probeVideo,
  captionFonts,
  captionPlateColor,
  captionTrack,
  composeTalkingHead,
  renderCaptionLines,
  tooLongMessage,
  type MomentLayer,
} from "@/lib/talking-head-captions"

/**
 * The talking-head AI edit itself (Hani, 2026-11-07), from her ORIGINAL
 * video (lib/talking-head-original):
 *   - captions: her speech word by word (lib/transcribe → captionLines), in
 *     her visual language's font, else Rubik (lib/talking-head-captions);
 *   - elements: each approved moment of the plan — a card, a highlight or an
 *     animation with her words — designed by the animated-caption engine (Ben's
 *     own-video captions, lib/broll-animation on Opus 5.5) in her visual
 *     language, shown from its time for a few seconds in the upper half
 *     (the lower third holds the captions);
 * all composited over her untouched footage in one encode.
 */
export class EditError extends Error {
  constructor(public code: string, message: string, public status = 422) {
    super(message)
  }
}

export type PlanMoment = { at: string; quote: string; element: "card" | "highlight" | "animation" }

/** How long an element stays: its animation, then a hold, then a fade. */
const MOMENT_SECONDS = 4

export function parseAt(at: string): number {
  const m = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(at.trim())
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0)
  const n = Number(at)
  return Number.isFinite(n) ? n : 0
}

const ELEMENT_DESIGN: Record<PlanMoment["element"], string> = {
  card: "A card: a solid rounded panel in her brand colours with these words on it, like a key-point card.",
  highlight: "These words big and emphasised — the key word with a highlight or underline sweep in her accent colour.",
  animation: "A short animated graphic around these words — a drawn arrow, a circle sweep or a simple icon-like shape made with CSS/SVG.",
}

/** Her head in the overlay's 1080×1920 canvas, from fractions of her frame (W×H). */
export function toCanvas(b: Box, W: number, H: number): Box {
  const k = 1080 / W
  const top = (H - (W * 16) / 9) / 2
  return { x: b.x * W * k, y: (b.y * H - top) * k, w: b.w * W * k, h: b.h * H * k }
}

/** Where the design should go, said to the engine — the render enforces it too. */
function placeNote(head: Box | null, captionsAt: "bottom" | "top" | null): string {
  const pct = (v: number) => Math.round((v / 1920) * 100)
  const caps = captionsAt === "top" ? "The top of the frame holds her running captions." : captionsAt === "bottom" ? "The lower third holds her running captions." : ""
  if (!head) return `Keep it compact, clear of the centre of the frame where her face usually is. ${caps}`
  return `Her head fills about ${pct(head.y)}%–${pct(head.y + head.h)}% of the frame height (and ${Math.round((head.x / 1080) * 100)}%–${Math.round(((head.x + head.w) / 1080) * 100)}% of the width). Put the element in the free space — above, below or beside her head — never over it. Keep it compact. ${caps}`
}

export function elementDesign(m: PlanMoment, request?: string, template?: string, place?: string): string {
  return [
    ELEMENT_DESIGN[m.element],
    place ?? placeNote(null, "bottom"),
    request ? `Her request for this edit: ${request}` : "",
    template ? `Her standing instructions for talking-head videos: ${template}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export async function runTalkingHeadEdit(opts: {
  supabase: SupabaseClient
  userId: string
  postId: string
  url?: string
  captions: boolean
  moments: PlanMoment[]
  request?: string
  work: string
  /** Frames of an element, for local tests (no Opus): replaces the engine. */
  designMoment?: (m: PlanMoment, dir: string) => Promise<number>
}): Promise<{ buffer: Buffer; lines: CaptionLine[]; source: string; applied: Applied }> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const { supabase, userId, postId, work } = opts
  const current = opts.url?.trim() || (await talkingHeadVideoUrl(supabase, postId))
  if (!current) throw new EditError("no_video", "אין כאן סרטון. העלו או חברו את הסרטון ונסו שוב.", 400)
  // From her ORIGINAL, carrying what the edits so far added — a new request
  // continues from where it stopped ("אמשיך מאיפה שזה נפסק", 2026-11-08).
  const { source, applied } = await editBase(supabase, userId, postId, current)
  const wantCaptions = opts.captions || applied.captions
  const keyOf = (m: PlanMoment) => `${m.at}|${m.quote}`
  const newKeys = new Set(opts.moments.map(keyOf))
  const allMoments: PlanMoment[] = [...applied.moments.filter((m) => !newKeys.has(keyOf(m))), ...opts.moments]

  // Up front: a clip too long for one run is said so, never failed midway.
  // Download first (a Drive link is a page, not a file ffmpeg can open),
  // then probe the local copy.
  await fs.mkdir(work, { recursive: true })
  const input = path.join(work, "in.mp4")
  const { isDriveUrl, extractDriveFileId } = await import("@/lib/drive-media")
  const { fetchDriveFile } = await import("@/lib/drive-fetch")
  const driveId = isDriveUrl(source) ? extractDriveFileId(source) : null
  const res = await (driveId ? fetchDriveFile(driveId) : fetch(source)).catch(() => null)
  const type = (res?.headers.get("content-type") || "").split(";")[0]
  if (!res?.ok || type.includes("text/html")) {
    throw new EditError("video_fetch_failed", "לא הצלחתי לטעון את הסרטון. אם הוא בדרייב, בדקו שהוא משותף ל״כל מי שיש לו הקישור״.")
  }
  await fs.writeFile(input, Buffer.from(await res.arrayBuffer()))

  const { seconds, width: W, height: H } = await probeVideo(input)
  if (seconds === null) throw new EditError("not_video", "לא הצלחתי לקרוא את הסרטון. נסו שוב.")
  if (seconds > MAX_TALKING_HEAD_SECONDS + 0.5) throw new EditError("too_long", tooLongMessage(seconds))

  // Her face, so nothing covers it (lib/face-boxes). A detector that can't
  // run leaves only the instruction to the engine — never a failed edit.
  const facesAt = async (times: number[]): Promise<Box[][] | null> => {
    try {
      return await detectFaces(await grabFrames(input, times))
    } catch (err) {
      console.error("[talking-head-edit] faces", err instanceof Error ? err.message : err)
      return null
    }
  }
  const faceAt = async (times: number[]): Promise<Box | null> => {
    const found = await facesAt(times)
    const zone = found ? headZone(found) : null
    return zone ? toCanvas(zone, W, H) : null
  }
  const overall = await facesAt([0.1, 0.3, 0.5, 0.7, 0.9].map((f) => f * seconds))
  const headRaw = overall ? headZone(overall) : null
  const head = headRaw ? toCanvas(headRaw, W, H) : null
  // Captions ALWAYS in the lower third (Hani, 2026-11-08) — moved up only when
  // her FACE itself is down there. Hair, shoulders and body never move them
  // (live: a head-and-shoulders zone sent them up to her forehead).
  const faceRaw = overall ? faceZone(overall) : null
  const face = faceRaw ? toCanvas(faceRaw, W, H) : null
  // "Down there" = the middle of her face is at or below the captions' band —
  // a chin reaching into it doesn't count.
  const captionsAt: "bottom" | "top" = face && face.y + face.h / 2 >= CAPTION_BAND.bottom.y ? "top" : "bottom"

  let lines: CaptionLine[] = []
  let captionsList: string | undefined
  if (wantCaptions) {
    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch {
      throw new EditError("openai_not_connected", "כדי לתמלל את הסרטון לכתוביות צריך לחבר מפתח OpenAI בהגדרות ← חיבורים.", 400)
    }
    const transcript = await transcribeVideo(openaiKey, source, await transcriptionContext(supabase, userId, postId))
    lines = captionLines(transcript.words)
    if (lines.length) {
      const [fonts, plate] = await Promise.all([captionFonts(supabase, userId), captionPlateColor(supabase, userId)])
      const pngs = await renderCaptionLines(lines, fonts, plate, captionsAt)
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
      captionsList = path.join(work, "captions.txt")
      await captionTrack(pngPaths, lines, blank, captionsList)
    }
  }

  const layers: MomentLayer[] = []
  if (allMoments.length) {
    let design = opts.designMoment
    if (!design) {
      let claudeKey: string
      try {
        claudeKey = await getUserApiKey(supabase, "anthropic_api_key")
      } catch {
        throw new EditError("anthropic_not_connected", "כדי לעצב את האלמנטים צריך לחבר מפתח Claude בהגדרות ← חיבורים.", 400)
      }
      const template = await loadTalkingHeadTemplate(supabase, userId)
      const note = placeNote(head, wantCaptions ? captionsAt : null)
      design = (m, dir) =>
        renderOwnVideoCaption(supabase, userId, claudeKey, "b_roll", { headline: m.quote, design: elementDesign(m, opts.request, template, note) }, dir)
    }
    // Opus designs each element; up to 3 at a time.
    const queue = allMoments.map((m, k) => ({ m, k }))
    const results: (MomentLayer | null)[] = new Array(queue.length).fill(null)
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const dir = path.join(work, `m${item.k}`)
        await fs.mkdir(dir, { recursive: true })
        try {
          const frames = await design!(item.m, dir)
          const start = Math.min(Math.max(0, parseAt(item.m.at)), Math.max(0, seconds - 1))
          const duration = Math.min(MOMENT_SECONDS, Math.max(1, seconds - start))
          // Enforced, not only asked: where her head is during THIS moment,
          // and the element moved / shrunk off it (and off the captions).
          const momentHead = (await faceAt([start, start + duration / 2, start + duration - 0.2].map((t) => Math.min(t, seconds - 0.05)))) ?? head
          const box = await elementBox(path.join(dir, `f${String(frames - 1).padStart(4, "0")}.png`))
          const place =
            box && momentHead
              ? placeClear(box, momentHead, { w: 1080, h: 1920, top: 220, bottom: 420, side: 80 }, wantCaptions ? CAPTION_BAND[captionsAt] : null)
              : undefined
          results[item.k] = { dir, fps: Math.max(1, Math.round(frames / OVERLAY_SECONDS)), start, duration, place }
        } catch (err) {
          console.error("[talking-head-edit] moment", item.k, err instanceof Error ? err.message : err)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    layers.push(...results.filter((r): r is MomentLayer => !!r))
    if (!layers.length && !captionsList) throw new EditError("elements_failed", "לא הצלחתי לעצב את האלמנטים הפעם. נסו שוב.", 500)
  }
  if (!captionsList && !layers.length) throw new EditError("no_speech", "לא שמעתי דיבור בסרטון, אז אין מה להוסיף.")

  const output = path.join(work, "out.mp4")
  await composeTalkingHead(input, { captionsList, moments: layers }, output)
  const nowApplied: Applied = { captions: wantCaptions && !!captionsList, moments: allMoments }
  return { buffer: await fs.readFile(output), lines, source, applied: nowApplied }
}
