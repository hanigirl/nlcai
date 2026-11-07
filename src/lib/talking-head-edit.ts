import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserApiKey } from "@/lib/api-keys"
import { captionLines, transcribeVideo, type CaptionLine } from "@/lib/transcribe"
import { renderOwnVideoCaption, OVERLAY_SECONDS } from "@/lib/own-video-captions"
import { talkingHeadVideoUrl } from "@/lib/talking-head-video"
import { originalFor } from "@/lib/talking-head-original"
import { loadTalkingHeadTemplate } from "@/lib/talking-head-template"
import {
  MAX_TALKING_HEAD_SECONDS,
  captionFonts,
  captionPlateColor,
  captionTrack,
  composeTalkingHead,
  probeSeconds,
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

export function elementDesign(m: PlanMoment, request?: string, template?: string): string {
  return [
    ELEMENT_DESIGN[m.element],
    "Place it in the UPPER HALF of the safe area — the lower third holds her running captions. Never cover the middle of the frame where her face is for longer than the animation's entrance; keep it compact.",
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
}): Promise<{ buffer: Buffer; lines: CaptionLine[] }> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const { supabase, userId, postId, work } = opts
  const current = opts.url?.trim() || (await talkingHeadVideoUrl(supabase, postId))
  if (!current) throw new EditError("no_video", "אין כאן סרטון. העלו או חברו את הסרטון ונסו שוב.", 400)
  const source = await originalFor(supabase, userId, postId, current)

  // Up front: a clip too long for one run is said so, never failed midway.
  const seconds = await probeSeconds(source)
  if (seconds === null) throw new EditError("not_video", "לא הצלחתי לקרוא את הסרטון. נסו שוב.")
  if (seconds > MAX_TALKING_HEAD_SECONDS + 0.5) throw new EditError("too_long", tooLongMessage(seconds))

  await fs.mkdir(work, { recursive: true })
  const input = path.join(work, "in.mp4")
  const res = await fetch(source)
  if (!res.ok) throw new EditError("video_fetch_failed", "לא הצלחתי לטעון את הסרטון. אם הוא בדרייב, בדקו שהוא משותף ל״כל מי שיש לו הקישור״.")
  await fs.writeFile(input, Buffer.from(await res.arrayBuffer()))

  let lines: CaptionLine[] = []
  let captionsList: string | undefined
  if (opts.captions) {
    let openaiKey: string
    try {
      openaiKey = await getUserApiKey(supabase, "openai_api_key")
    } catch {
      throw new EditError("openai_not_connected", "כדי לתמלל את הסרטון לכתוביות צריך לחבר מפתח OpenAI בהגדרות ← חיבורים.", 400)
    }
    const transcript = await transcribeVideo(openaiKey, source)
    lines = captionLines(transcript.words)
    if (lines.length) {
      const [fonts, plate] = await Promise.all([captionFonts(supabase, userId), captionPlateColor(supabase, userId)])
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
      captionsList = path.join(work, "captions.txt")
      await captionTrack(pngPaths, lines, blank, captionsList)
    }
  }

  const layers: MomentLayer[] = []
  if (opts.moments.length) {
    let design = opts.designMoment
    if (!design) {
      let claudeKey: string
      try {
        claudeKey = await getUserApiKey(supabase, "anthropic_api_key")
      } catch {
        throw new EditError("anthropic_not_connected", "כדי לעצב את האלמנטים צריך לחבר מפתח Claude בהגדרות ← חיבורים.", 400)
      }
      const template = await loadTalkingHeadTemplate(supabase, userId)
      design = (m, dir) =>
        renderOwnVideoCaption(supabase, userId, claudeKey, "b_roll", { headline: m.quote, design: elementDesign(m, opts.request, template) }, dir)
    }
    // Opus designs each element; up to 3 at a time.
    const queue = opts.moments.map((m, k) => ({ m, k }))
    const results: (MomentLayer | null)[] = new Array(queue.length).fill(null)
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const dir = path.join(work, `m${item.k}`)
        await fs.mkdir(dir, { recursive: true })
        try {
          const frames = await design!(item.m, dir)
          const start = Math.min(Math.max(0, parseAt(item.m.at)), Math.max(0, seconds - 1))
          results[item.k] = {
            dir,
            fps: Math.max(1, Math.round(frames / OVERLAY_SECONDS)),
            start,
            duration: Math.min(MOMENT_SECONDS, Math.max(1, seconds - start)),
          }
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
  return { buffer: await fs.readFile(output), lines }
}
