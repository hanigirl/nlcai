import { launch } from "@/lib/broll-animation/render"
import { COMPOSITION_HEIGHT, COMPOSITION_SECONDS, COMPOSITION_WIDTH, reviseBRoll, type CompositionBrief } from "@/lib/broll-animation/compose"

/**
 * Her b-roll words are on screen from frame 0 (Hani, 2026-11-11: "מהרגע
 * הראשון בלי fade או דיליי"). The page itself pins every text element opaque,
 * visible and unclipped (compose TEXT_HOLD) — that ends fades, delays, word
 * by word reveals and wipes. What it can't pin without stopping the motion
 * she allows is an entrance by MOVEMENT: words growing from nothing, or
 * sliding in from outside the frame. This looks at frame 0 against the held
 * end frame; a word that is much smaller there, or not inside the frame, goes
 * back to the model once to be fixed. A check that can't run never blocks.
 */

type Box = { text: string; x: number; y: number; w: number; h: number }

/** Texts that are not at full size inside the frame at t=0. */
export async function textEntranceProblems(html: string): Promise<string[]> {
  const browser = await launch({ width: COMPOSITION_WIDTH / 4, height: COMPOSITION_HEIGHT / 4 })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT, deviceScaleFactor: 0.25 })
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 })
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    const at = (seconds: number) =>
      page.evaluate((s: number): Box[] => {
        const w = window as unknown as { gsap?: { globalTimeline: { pause: () => void; totalTime: (t: number) => void } } }
        if (w.gsap) {
          w.gsap.globalTimeline.pause()
          w.gsap.globalTimeline.totalTime(s)
        }
        for (const a of document.getAnimations()) {
          a.pause()
          a.currentTime = s * 1000
        }
        const out: Box[] = []
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-text-hold]"))) {
          const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && !!n.nodeValue?.trim())
          if (!own) continue
          const r = el.getBoundingClientRect()
          out.push({ text: (el.textContent ?? "").trim().slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height })
        }
        return out
      }, seconds)
    // Frame 0 first, as the renderer does: seeking back from the end doesn't
    // bring a GSAP from() with a delay back to its start state.
    const start = await at(0)
    const end = await at(COMPOSITION_SECONDS - 0.5)
    const problems: string[] = []
    start.forEach((s, i) => {
      const e = end[i]
      if (!e || e.w < 4 || e.h < 4) return
      const small = s.w < e.w * 0.7 || s.h < e.h * 0.7
      const visW = Math.max(0, Math.min(s.x + s.w, COMPOSITION_WIDTH) - Math.max(s.x, 0))
      const visH = Math.max(0, Math.min(s.y + s.h, COMPOSITION_HEIGHT) - Math.max(s.y, 0))
      const outside = s.w * s.h > 0 && (visW * visH) / (s.w * s.h) < 0.9
      if (small || outside) problems.push(s.text)
    })
    return [...new Set(problems)]
  } finally {
    await browser.close().catch(() => undefined)
  }
}

/**
 * The template, with its words at full size in the frame at t=0. One fix by
 * the model when the check finds an entrance by movement; whatever it
 * returns is used only if it passes (else the original, still pinned
 * visible by TEXT_HOLD).
 */
export async function holdTextAtStart(
  apiKey: string,
  brief: CompositionBrief,
  template: string,
  toHtml: (template: string) => string,
): Promise<string> {
  try {
    const problems = await textEntranceProblems(toHtml(template))
    if (!problems.length) return template
    console.warn("[b-roll text-hold] entrance at t=0:", problems)
    const fixed = await reviseBRoll(
      apiKey,
      brief,
      template,
      [
        "תיקון טכני בלבד, בלי לשנות שום דבר אחר בעיצוב:",
        `The text must be on screen at full size, in its final place, from the very first frame (t=0). These words start smaller (grow / scale up from nothing) or outside the frame (slide in): ${JSON.stringify(problems)}.`,
        "Remove ONLY that entrance, on those words: at t=0 each of them is already at its full size and fully inside the frame; after that it may still move a little (gentle float, subtle breathe).",
        "Change nothing else — every other rule, element and line of the document stays exactly as it is, character for character: the highlights / underlines / marks on the words (including ::before / ::after and their animations), shapes, decorative elements, colours, layout and the other words' motion.",
      ].join("\n"),
    )
    const left = await textEntranceProblems(toHtml(fixed))
    if (left.length) console.warn("[b-roll text-hold] still after fix:", left)
    return left.length < problems.length ? fixed : template
  } catch (err) {
    console.error("[b-roll text-hold] check skipped:", err instanceof Error ? err.message : err)
    return template
  }
}
