import { spawn } from "child_process"
import ffmpegPath from "ffmpeg-static"
import type { Browser } from "puppeteer-core"
import {
  COMPOSITION_HEIGHT,
  COMPOSITION_SECONDS,
  COMPOSITION_WIDTH,
} from "./compose"

/**
 * Opus's HTML composition → MP4.
 *
 * A headless Chromium loads the page once, freezes every clock, and then for
 * each frame seeks all animations to that frame's time and takes a
 * screenshot. The frames are piped straight into ffmpeg. Seeking (rather than
 * recording in real time) is what makes the output identical on every run and
 * independent of how fast the server is.
 *
 * Clocks it controls: CSS animations / transitions and the Web Animations API
 * (`document.getAnimations()`), and GSAP's global timeline when GSAP is on the
 * page. The composition prompt forbids every other clock, and compose.ts
 * rejects a composition that uses one.
 *
 * Chromium: on Vercel, @sparticuz/chromium (a Lambda-sized build). Locally,
 * the machine's Chrome — set CHROME_EXECUTABLE_PATH to override.
 */

const FPS = 25

let chromiumPath: Promise<string> | null = null

export async function launch(
  viewport: { width: number; height: number } = { width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT },
): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default
  const onServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  if (onServerless) {
    const chromium = (await import("@sparticuz/chromium")).default
    // Unpacked once per instance: several renders at once in one instance
    // (the distributed chunks) must not unpack it over each other.
    chromiumPath ??= chromium.executablePath()
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromiumPath,
      headless: true,
      defaultViewport: viewport,
    })
  }
  return puppeteer.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    defaultViewport: viewport,
  })
}

function startEncoder(outputPath: string) {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found")
  const proc = spawn(ffmpegPath as unknown as string, [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(FPS),
    "-c:v", "mjpeg",
    "-i", "-",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    // Puts the moov atom first so the clip starts playing before it has
    // fully downloaded.
    "-movflags", "+faststart",
    outputPath,
  ])
  let stderr = ""
  proc.stderr.on("data", (d) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`)),
    )
  })
  return { proc, done }
}

/**
 * Her own video inside a composition (lib/broll-animation/library-media):
 * held paused and seeked to the frame's time, so it renders frame-exact like
 * every other animation. A clip shorter than the b-roll loops.
 */
async function seekVideos(page: import("puppeteer-core").Page, seconds: number): Promise<void> {
  await page.evaluate(async (s: number) => {
    const videos = Array.from(document.querySelectorAll("video"))
    await Promise.all(
      videos.map(
        (v) =>
          new Promise<void>((resolve) => {
            v.pause()
            const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
            const target = d ? s % d : s
            if (Math.abs(v.currentTime - target) < 0.001) return resolve()
            const t = window.setTimeout(resolve, 3000)
            v.addEventListener("seeked", () => { window.clearTimeout(t); resolve() }, { once: true })
            v.currentTime = target
          }),
      ),
    )
  }, seconds)
}

/**
 * Her video inside a composition, WITHOUT playing it in the browser (Hani,
 * 2026-11-10: b-rolls with a video never finished on the server). The
 * server's Chromium couldn't seek the clip, so every frame waited out a 3s
 * timeout and the render ran past the function's limit. Instead ffmpeg cuts
 * the clip into stills up front (looped to the b-roll's length), the <video>
 * becomes an <img> with the same class and style (so the blend recipe still
 * applies), and each frame shows its own still. Frame-exact, and independent
 * of which codecs the browser has.
 */
type VideoStills = Map<string, string[]>

async function extractVideoStills(html: string, frames: number): Promise<VideoStills> {
  const out: VideoStills = new Map()
  const srcs = [...new Set([...html.matchAll(/<video\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]))]
  if (!srcs.length) return out
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  for (const src of srcs) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "broll-vid-"))
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) continue
      const input = path.join(dir, "in")
      await fs.writeFile(input, Buffer.from(await res.arrayBuffer()))
      await new Promise<void>((resolve, reject) => {
        const p = spawn(ffmpegPath as unknown as string, [
          "-y", "-stream_loop", "-1", "-i", input,
          "-t", String(frames / FPS),
          "-vf", `fps=${FPS},scale=-2:1280`,
          "-q:v", "4",
          path.join(dir, "f%04d.jpg"),
        ])
        let err = ""
        p.stderr.on("data", (d) => (err = (err + d).slice(-1500)))
        p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`video_stills: ${err}`))))
      })
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jpg")).sort()
      if (!files.length) continue
      const stills: string[] = []
      for (const f of files) stills.push(`data:image/jpeg;base64,${(await fs.readFile(path.join(dir, f))).toString("base64")}`)
      out.set(src, stills)
    } catch (e) {
      console.error("[broll render] video stills failed, the video element stays", e)
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return out
}

/** Each <video> that has stills becomes an <img> with its class / style, showing its first still. */
function withStillsForVideos(html: string, stills: VideoStills): string {
  return html.replace(/<video\b([^>]*)>(?:\s*<\/video>)?/gi, (whole, attrs: string) => {
    const src = /\bsrc="([^"]+)"/i.exec(attrs)?.[1]
    const list = src ? stills.get(src) : undefined
    if (!src || !list?.length) return whole
    const kept = attrs
      .replace(/\s(?:autoplay|loop|muted|playsinline|preload|controls)(?:="[^"]*")?/gi, "")
      .replace(/\bsrc="[^"]+"/i, `src="${list[0]}" data-video-src="${src}"`)
    return `<img${kept}>`
  })
}

async function showVideoStills(page: import("puppeteer-core").Page, frame: number, stills: VideoStills): Promise<void> {
  if (!stills.size) return
  const now: Record<string, string> = {}
  for (const [src, list] of stills) now[src] = list[Math.min(frame, list.length - 1)]
  await page.evaluate(async (map: Record<string, string>) => {
    await Promise.all(
      Array.from(document.querySelectorAll<HTMLImageElement>("img[data-video-src]")).map(async (img) => {
        const next = map[img.getAttribute("data-video-src") ?? ""]
        if (!next) return
        img.src = next
        await img.decode().catch(() => undefined)
      }),
    )
  }, now)
}

/**
 * Pages that screenshot at once (Hani, 2026-11-10: the frames took ~8 of the
 * ~9 minutes on the server). Each takes a contiguous slice of the frames —
 * every frame is seeked to its own time, so the result is identical to one
 * page — and ffmpeg still gets them in order.
 */
const RENDER_PAGES_MAX = 4
/** Parallel pages for the gated accounts (Hani + Nataliya, 2026-11-10). */
export const FAST_RENDER_PAGES = 2

async function preparePage(browser: Browser, html: string) {
  const page = await browser.newPage()
  await page.setViewport({ width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT })
  await page.setContent(html, { waitUntil: "load", timeout: 60_000 })
  // Fonts / GSAP / background come over the network.
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined)
  // Fonts and the background must be in before frame 0, or the first second
  // renders in a fallback face / on black.
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((r) => { img.onload = img.onerror = r }),
      ),
    )
    await Promise.all(
      Array.from(document.querySelectorAll("video")).map((v) =>
        v.readyState >= 2
          ? null
          : new Promise((r) => {
              v.addEventListener("loadeddata", r, { once: true })
              v.addEventListener("error", r, { once: true })
              setTimeout(r, 20_000)
            }),
      ),
    )
  })
  return page
}

async function seekTo(page: import("puppeteer-core").Page, seconds: number): Promise<void> {
  await page.evaluate((t: number) => {
    const w = window as unknown as {
      gsap?: { globalTimeline: { pause: () => void; totalTime: (t: number) => void }; ticker?: { lagSmoothing: (n: number) => void } }
    }
    if (w.gsap) {
      w.gsap.globalTimeline.pause()
      w.gsap.globalTimeline.totalTime(t)
    }
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = t * 1000
    }
  }, seconds)
  await seekVideos(page, seconds)
}

/** Frames per second of every b-roll render (the distributed render splits by it). */
export const RENDER_FPS_BROLL = FPS

export async function renderComposition(
  html: string,
  outputPath: string,
  /** Timing per render stage, ms (Hani, 2026-11-10 — where does b-roll time go). */
  timing?: Record<string, number>,
  /** Pages in parallel; 1 = the old one-page render (everyone but the gated accounts, for now). */
  pagesWanted = 1,
  /** Only these frames [from, to) — one chunk of a distributed render (lib/broll-animation/distributed). */
  range?: { from: number; to: number },
): Promise<void> {
  let t0 = Date.now()
  const lap = (k: string) => {
    if (timing) timing[k] = Date.now() - t0
    t0 = Date.now()
  }
  const browser = await launch()
  lap("renderLaunch")
  try {
    const n = Math.max(1, Math.min(RENDER_PAGES_MAX, pagesWanted))
    const stills = await extractVideoStills(html, COMPOSITION_SECONDS * FPS)
    if (timing && stills.size) timing.renderVideoStills = Date.now() - t0
    // Swapped in the markup itself, so the page never waits on a video it can't play.
    const ready = stills.size ? withStillsForVideos(html, stills) : html
    const pages = await Promise.all(Array.from({ length: n }, () => preparePage(browser, ready)))
    lap("renderLoad")
    const total = COMPOSITION_SECONDS * FPS
    const first = Math.max(0, Math.min(total, range?.from ?? 0))
    const frames = Math.max(0, Math.min(total, range?.to ?? total) - first)
    const shots: (Buffer | undefined)[] = new Array(frames)
    const waiting = new Map<number, () => void>()
    let seekMs = 0
    let shotMs = 0
    const per = Math.ceil(frames / pages.length)
    const workers = pages.map(async (page, w) => {
      for (let i = w * per; i < Math.min(frames, (w + 1) * per); i++) {
        const a = Date.now()
        await seekTo(page, (first + i) / FPS)
        await showVideoStills(page, first + i, stills)
        const b = Date.now()
        shots[i] = Buffer.from(await page.screenshot({ type: "jpeg", quality: 88, optimizeForSpeed: true }))
        seekMs += b - a
        shotMs += Date.now() - b
        waiting.get(i)?.()
      }
    })
    const { proc, done } = startEncoder(outputPath)
    // Feed ffmpeg in order as the frames arrive.
    const feed = (async () => {
      for (let i = 0; i < frames; i++) {
        if (!shots[i]) await new Promise<void>((r) => waiting.set(i, r))
        const shot = shots[i]!
        shots[i] = undefined
        if (!proc.stdin.write(shot)) await new Promise((r) => proc.stdin.once("drain", r))
      }
    })()
    await Promise.all(workers)
    await feed
    if (timing) {
      timing.renderPages = pages.length
      timing.renderSeekMsPerFrame = Math.round(seekMs / frames)
      timing.renderShotMsPerFrame = Math.round(shotMs / frames)
    }
    lap("renderFrames")
    proc.stdin.end()
    await done
    lap("renderEncode")
  } finally {
    await browser.close().catch(() => undefined)
  }
}

/**
 * The composition as a TRANSPARENT text layer, for laying over her own
 * footage (lib/own-video-captions): the page background is cleared and every
 * frame is a PNG with alpha, written to `dir` as f0000.png, f0001.png… Only
 * `seconds` of it — the entrance; the caller holds the last frame.
 */
export async function renderOverlayFrames(
  html: string,
  seconds: number,
  dir: string,
  /** Only the last frame, as f0000.png — a quick look (the own-media chat's draft check). */
  onlyLast = false,
): Promise<number> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const page0 = html.replace(
    /<\/head>/i,
    "<style>html,body{background:transparent!important;background-color:transparent!important}</style></head>",
  )
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT })
    await page.setContent(page0, { waitUntil: "load", timeout: 60_000 })
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    const frames = Math.round(seconds * FPS)
    for (let i = onlyLast ? frames - 1 : 0; i < frames; i++) {
      const t = i / FPS
      await page.evaluate((s: number) => {
        const w = window as unknown as { gsap?: { globalTimeline: { pause: () => void; totalTime: (t: number) => void } } }
        if (w.gsap) {
          w.gsap.globalTimeline.pause()
          w.gsap.globalTimeline.totalTime(s)
        }
        for (const a of document.getAnimations()) {
          a.pause()
          a.currentTime = s * 1000
        }
      }, t)
      const shot = await page.screenshot({ type: "png", omitBackground: true })
      await fs.writeFile(path.join(dir, `f${String(onlyLast ? 0 : i).padStart(4, "0")}.png`), shot)
    }
    return onlyLast ? 1 : frames
  } finally {
    await browser.close().catch(() => undefined)
  }
}

export { FPS as RENDER_FPS }
