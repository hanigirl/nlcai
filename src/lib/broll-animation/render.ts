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

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default
  const onServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  if (onServerless) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT },
    })
  }
  return puppeteer.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    defaultViewport: { width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT },
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

export async function renderComposition(html: string, outputPath: string): Promise<void> {
  const browser = await launch()
  try {
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
    })

    const frames = COMPOSITION_SECONDS * FPS
    const { proc, done } = startEncoder(outputPath)
    for (let i = 0; i < frames; i++) {
      const t = i / FPS
      await page.evaluate((seconds: number) => {
        const w = window as unknown as {
          gsap?: { globalTimeline: { pause: () => void; totalTime: (t: number) => void }; ticker?: { lagSmoothing: (n: number) => void } }
        }
        if (w.gsap) {
          w.gsap.globalTimeline.pause()
          w.gsap.globalTimeline.totalTime(seconds)
        }
        for (const a of document.getAnimations()) {
          a.pause()
          a.currentTime = seconds * 1000
        }
      }, t)
      const shot = await page.screenshot({ type: "jpeg", quality: 92 })
      if (!proc.stdin.write(shot)) {
        await new Promise((r) => proc.stdin.once("drain", r))
      }
    }
    proc.stdin.end()
    await done
  } finally {
    await browser.close().catch(() => undefined)
  }
}
