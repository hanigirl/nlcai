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

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Her caption font stack: her primary font, else Rubik. */
export function captionFontStack(fonts: BrandFont[]): string {
  const primary = fonts.find((f) => f.role !== "secondary") ?? fonts[0]
  return primary ? `${JSON.stringify(primary.family)},"Rubik",sans-serif` : `"Rubik",sans-serif`
}

/** One transparent 1080×1920 PNG per line. */
export async function renderCaptionLines(lines: CaptionLine[], fonts: BrandFont[], plate: string): Promise<Buffer[]> {
  // Rubik is always loaded (fontHead adds it), so "else Rubik" holds even
  // with no brand font at all.
  const head = fontHead(fonts)
  const stack = captionFontStack(fonts)
  const page = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">${head}<style>
html,body{margin:0;width:${W}px;height:${H}px;background:transparent}
.line{position:absolute;left:0;right:0;bottom:${BOTTOM}px;display:none;justify-content:center;padding:0 90px}
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

/**
 * Her video with the line PNGs on top, each shown between its times. The
 * lines (and a transparent `blank` for the gaps) become ONE timed image
 * track through ffmpeg's concat list, scaled to her frame width and set on
 * the bottom of the frame — one overlay, however many lines she speaks.
 */
export async function burnCaptionLines(
  input: string,
  pngs: string[],
  lines: CaptionLine[],
  blank: string,
  listPath: string,
  output: string,
): Promise<void> {
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
  const filter =
    "[1:v]format=rgba,fps=25[cap];[cap][0:v]scale2ref=w=main_w:h=main_w*16/9[c][base];" +
    "[base][c]overlay=0:main_h-overlay_h:eof_action=pass[v]"
  await run([
    "-y",
    "-i", input,
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ])
}
