import { launch } from "@/lib/broll-animation/render"
import { COMPOSITION_HEIGHT, COMPOSITION_WIDTH } from "@/lib/broll-animation/compose"

/**
 * A few stills of a b-roll composition, so the agent can LOOK at a draft
 * before paying for the full render (~4 min on our functions; a handful of
 * stills is seconds). Same seek as the renderer (lib/broll-animation/render),
 * at a third of the size — enough to judge the design, cheap to send.
 */
export async function snapshotComposition(html: string, times: number[]): Promise<string[]> {
  const scale = 1 / 3
  const browser = await launch({
    width: Math.round(COMPOSITION_WIDTH * scale),
    height: Math.round(COMPOSITION_HEIGHT * scale),
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT, deviceScaleFactor: scale })
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 })
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete ? null : new Promise((r) => { img.onload = img.onerror = r }),
        ),
      )
    })
    const shots: string[] = []
    for (const t of times) {
      await page.evaluate((seconds: number) => {
        const w = window as unknown as {
          gsap?: { globalTimeline: { pause: () => void; totalTime: (t: number) => void } }
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
      const shot = await page.screenshot({ type: "jpeg", quality: 80 })
      shots.push(Buffer.from(shot).toString("base64"))
    }
    return shots
  } finally {
    await browser.close().catch(() => undefined)
  }
}
