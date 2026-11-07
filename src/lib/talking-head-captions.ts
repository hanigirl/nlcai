import { spawn } from "child_process"
import ffmpegPath from "ffmpeg-static"
import type { SupabaseClient } from "@supabase/supabase-js"
import { loadBrandFonts } from "@/lib/broll-animation/brief"
import { fontHead, type BrandFont } from "@/lib/broll-animation/compose"
import { launch } from "@/lib/broll-animation/render"
import type { CaptionLine } from "@/lib/transcribe"
import { cleanBrandColors, defaultCoverColor } from "@/lib/cover-brand-color"

/**
 * "רק כתוביות" for her talking-head video (Hani, 2026-11-07): the lines of
 * her own speech (lib/transcribe → captionLines, 2–5 words each with their
 * times) burned onto her footage, each shown exactly while she says it.
 *
 *   - Font: the visual language's primary font; none set → Rubik.
 *   - Look: white words on a plate in her main brand colour (black when she
 *     has none) — the same default as her reel cover.
 *   - Place: the lower third, inside Instagram's reel safe area.
 *   - Her footage is untouched: the captions are a layer on top.
 *
 * Each line is drawn once as a transparent PNG by the headless browser (so
 * her web / uploaded font renders exactly as on her other designs), then
 * ffmpeg overlays them, each enabled only between its start and end.
 */

const W = 1080
const H = 1920
/** The plate's lower edge sits this far above the bottom (reel UI below). */
const BOTTOM = 470
/** …or, with her face low in the frame, this far below the top (reel UI above). */
const TOP = 260
/** The captions' band in the 1080×1920 canvas, for keeping elements off it. */
export const CAPTION_BAND = { bottom: { y: 1920 - BOTTOM - 170, h: 170 }, top: { y: TOP, h: 170 } }

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Her caption font stack: her primary font, else Rubik. */
export function captionFontStack(fonts: BrandFont[]): string {
  const primary = fonts.find((f) => f.role !== "secondary") ?? fonts[0]
  return primary ? `${JSON.stringify(primary.family)},"Rubik",sans-serif` : `"Rubik",sans-serif`
}

/** One transparent 1080×1920 PNG per line. */
export async function renderCaptionLines(
  lines: CaptionLine[],
  fonts: BrandFont[],
  plate: string,
  /** "top" when her face sits in the lower third (lib/face-boxes). */
  position: "bottom" | "top" = "bottom",
): Promise<Buffer[]> {
  // Rubik is always loaded (fontHead adds it), so "else Rubik" holds even
  // with no brand font at all.
  const head = fontHead(fonts)
  const stack = captionFontStack(fonts)
  const page = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">${head}<style>
html,body{margin:0;width:${W}px;height:${H}px;background:transparent}
.line{position:absolute;left:0;right:0;${position === "top" ? `top:${TOP}px` : `bottom:${BOTTOM}px`};display:none;justify-content:center;padding:0 90px}
.line.on{display:flex}
.plate{background:${plate};color:#fff;font-family:${stack};font-weight:700;font-size:64px;line-height:1.25;padding:18px 34px;border-radius:24px;text-align:center;max-width:${W - 180}px}
</style></head><body>${lines
    .map((l, i) => `<div class="line" id="l${i}"><span class="plate">${escapeHtml(l.text)}</span></div>`)
    .join("")}</body></html>`
  const browser = await launch({ width: W, height: H })
  try {
    const tab = await browser.newPage()
    await tab.setViewport({ width: W, height: H })
    await tab.setContent(page, { waitUntil: "load", timeout: 60_000 })
    await tab.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined)
    // Hidden lines don't request their font, and font-display:block hides
    // text until it arrives — load her font (and Rubik) with the real words first.
    const sample = JSON.stringify(lines.map((l) => l.text).join(" ").slice(0, 400))
    await tab.evaluate(
      `Promise.all([${JSON.stringify(`700 64px ${stack}`)}].map((f)=>document.fonts.load(f, ${sample}))).then(()=>document.fonts.ready)`,
    )
    const out: Buffer[] = []
    for (let i = 0; i < lines.length; i++) {
      await tab.evaluate(`document.querySelectorAll('.line').forEach((e,k)=>e.classList.toggle('on',k===${i}))`)
      await tab.evaluate("document.fonts.ready")
      out.push(Buffer.from(await tab.screenshot({ type: "png", omitBackground: true })))
    }
    return out
  } finally {
    await browser.close().catch(() => undefined)
  }
}

/** Her primary brand colour, black when she has none (the cover's default). */
export async function captionPlateColor(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("users").select("brand_colors").eq("id", userId).maybeSingle()
  return defaultCoverColor(cleanBrandColors((data as { brand_colors?: unknown } | null)?.brand_colors))
}

export async function captionFonts(supabase: SupabaseClient, userId: string): Promise<BrandFont[]> {
  return loadBrandFonts(supabase, userId).catch(() => [])
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found"))
    const proc = spawn(ffmpegPath as unknown as string, args)
    let err = ""
    proc.stderr.on("data", (d) => (err = (err + d.toString()).slice(-4000)))
    proc.on("error", reject)
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))))
  })
}

/** A moment's animated element: its frames (f0000.png…), their rate, and when it shows. */
export type MomentLayer = {
  dir: string
  fps: number
  start: number
  duration: number
  /** Moved / shrunk off her face (lib/face-boxes → placeClear), in the 1080×1920 canvas. */
  place?: { scale: number; dx: number; dy: number }
}

/** Write the captions' timed image track (lines + a transparent blank for the gaps). */
export async function captionTrack(pngs: string[], lines: CaptionLine[], blank: string, listPath: string): Promise<void> {
  const fs = await import("fs/promises")
  const entries: string[] = []
  let t = 0
  lines.forEach((l, i) => {
    if (l.start > t + 0.01) entries.push(`file '${blank}'`, `duration ${(l.start - t).toFixed(3)}`)
    const d = Math.max(0.05, l.end - Math.max(l.start, t))
    entries.push(`file '${pngs[i]}'`, `duration ${d.toFixed(3)}`)
    t = Math.max(t, l.end)
  })
  // The concat demuxer needs the last file once more for its duration to hold.
  entries.push(`file '${blank}'`, "duration 1", `file '${blank}'`)
  await fs.writeFile(listPath, entries.join("\n"))
}

/**
 * Her ORIGINAL video with the layers on top: the captions' timed track (in
 * the lower third) and each moment's animated element (full-frame 9:16
 * frames, shown from its start for its duration, fading out). Every layer is
 * scaled to her frame width. Her footage and sound are untouched.
 */
export async function composeTalkingHead(
  input: string,
  layers: { captionsList?: string; moments: MomentLayer[] },
  output: string,
): Promise<void> {
  const args: string[] = ["-y", "-i", input]
  const parts: string[] = []
  let cur = "[0:v]"
  let idx = 1
  if (layers.captionsList) {
    args.push("-f", "concat", "-safe", "0", "-i", layers.captionsList)
    parts.push(
      `[${idx}:v]format=rgba,fps=25[cap]`,
      `[cap]${cur}scale2ref=w=main_w:h=main_w*16/9[capS][capB]`,
      `[capB][capS]overlay=0:main_h-overlay_h:eof_action=pass[vc]`,
    )
    cur = "[vc]"
    idx++
  }
  layers.moments.forEach((m, k) => {
    args.push("-framerate", String(m.fps), "-start_number", "0", "-i", `${m.dir}/f%04d.png`)
    const s = m.start.toFixed(2)
    const fadeAt = Math.max(0, m.duration - 0.4).toFixed(2)
    parts.push(
      // Its last frame holds for the rest of its time, then fades; shifted to its moment.
      `[${idx}:v]format=rgba,tpad=stop_mode=clone:stop_duration=${m.duration.toFixed(2)},trim=duration=${m.duration.toFixed(2)},fade=t=out:st=${fadeAt}:d=0.4:alpha=1,setpts=PTS-STARTPTS+${s}/TB[m${k}]`,
      `[m${k}]${cur}scale2ref=w=main_w:h=main_w*16/9[mS${k}][mB${k}]`,
    )
    const enable = `enable='between(t,${s},${(m.start + m.duration).toFixed(2)})'`
    if (m.place && (m.place.scale !== 1 || m.place.dx || m.place.dy)) {
      // Off her face: the layer shrunk and moved (canvas px → her frame via main_w/1080).
      const p = m.place
      parts.push(
        `[mS${k}]scale=iw*${p.scale.toFixed(4)}:ih*${p.scale.toFixed(4)}[mT${k}]`,
        `[mB${k}][mT${k}]overlay=x='main_w/1080*${p.dx.toFixed(1)}':y='(main_h-main_w*16/9)/2+main_w/1080*${p.dy.toFixed(1)}':eof_action=pass:${enable}[w${k}]`,
      )
    } else {
      parts.push(`[mB${k}][mS${k}]overlay=0:(main_h-overlay_h)/2:eof_action=pass:${enable}[w${k}]`)
    }
    cur = `[w${k}]`
    idx++
  })
  if (!parts.length) throw new Error("nothing_to_add")
  await run([
    ...args,
    "-filter_complex", parts.join(";"),
    "-map", cur,
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ])
}

/** Length and frame size from ffmpeg's probe. */
export function probeVideo(src: string): Promise<{ seconds: number | null; width: number; height: number }> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve({ seconds: null, width: 1080, height: 1920 })
    const proc = spawn(ffmpegPath as unknown as string, ["-i", src])
    let err = ""
    proc.stderr.on("data", (d) => (err += d.toString()))
    proc.on("error", () => resolve({ seconds: null, width: 1080, height: 1920 }))
    proc.on("close", () => {
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
      const v = /Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(err)
      resolve({
        seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
        width: v ? Number(v[1]) : 1080,
        height: v ? Number(v[2]) : 1920,
      })
    })
  })
}

/** Small frames of her video at these times, for the face detector. */
export async function grabFrames(input: string, times: number[]): Promise<Buffer[]> {
  const grab = (t: number) =>
    new Promise<Buffer | null>((resolve) => {
      if (!ffmpegPath) return resolve(null)
      const proc = spawn(ffmpegPath as unknown as string, [
        "-ss", t.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", "-f", "image2pipe", "-vcodec", "png", "-",
      ])
      const chunks: Buffer[] = []
      proc.stdout.on("data", (d) => chunks.push(d))
      proc.on("error", () => resolve(null))
      proc.on("close", (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null))
    })
  const out = await Promise.all(times.map(grab))
  return out.filter((b): b is Buffer => !!b)
}

/** Where an element sits in its (last) frame: the box of its visible pixels, in canvas px. */
export async function elementBox(png: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const sharp = (await import("sharp")).default
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = info.width
  let y0 = info.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      if (data[(y * info.width + x) * info.channels + 3] > 24) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const k = 1080 / info.width
  return { x: x0 * k, y: y0 * k, w: (x1 - x0 + 2) * k, h: (y1 - y0 + 2) * k }
}

/** The clip's length from ffmpeg's probe (works on a URL without a full download). */
export function probeSeconds(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null)
    const proc = spawn(ffmpegPath as unknown as string, ["-i", src])
    let err = ""
    proc.stderr.on("data", (d) => (err += d.toString()))
    proc.on("error", () => resolve(null))
    proc.on("close", () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null)
    })
  })
}

/**
 * The longest talking head an AI edit takes (transcription + the elements'
 * design + one encode must fit the route's 800 seconds, with room to spare).
 */
export const MAX_TALKING_HEAD_SECONDS = 5 * 60

export function tooLongMessage(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const sec = Math.round(seconds % 60)
  return `הסרטון באורך ${min}:${String(sec).padStart(2, "0")} דקות, ועריכת AI של דיבור למצלמה עובדת על סרטונים של עד ${MAX_TALKING_HEAD_SECONDS / 60} דקות. קצרו אותו ונסו שוב.`
}
