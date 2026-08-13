import type { SlideData } from "@/lib/carousel-templates"

/**
 * Parse carousel text ("שקופית N" blocks) into slides.
 *
 * Lives here rather than in the panel because the server needs the SAME split
 * when it lays a slide's words over a picture the user brought — a second
 * implementation would let the caption say something the slide doesn't.
 */
export function parseTextToSlides(text: string): SlideData[] {
  const slideHeaderRegex = /^\s*(?:שקופית\s*\d+|\[.*?\])\s*:?\s*$/
  const rawLines = text.split("\n")
  // When the text is headed ("שקופית N" / "[...]"), those headers are the
  // ONLY slide boundary. Blank lines inside a slide belong to that slide's
  // body — splitting on them turned a 7-slide carousel into 15 and tripped
  // the AI-template cap (Hani 2026-07-27).
  const hasHeaders = rawLines.some((l) => slideHeaderRegex.test(l))

  // One entry per slide, each holding that slide's raw lines.
  const blocks: string[][] = []
  if (hasHeaders) {
    let current: string[] | null = null
    for (const line of rawLines) {
      if (slideHeaderRegex.test(line)) {
        current = []
        blocks.push(current)
        continue
      }
      // Text before the first header (a stray preamble) still becomes a
      // block, so nothing the user wrote is silently dropped.
      if (!current) {
        if (!line.trim()) continue
        current = []
        blocks.push(current)
      }
      current.push(line)
    }
  } else {
    // Unheaded text: a blank line is the only boundary available.
    for (const block of text.split(/\n\s*\n+/)) {
      const lines = block.split("\n")
      if (lines.some((l) => l.trim())) blocks.push(lines)
    }
  }

  const parsed: SlideData[] = []
  let slideNum = 1

  for (const block of blocks) {
    // Trim the block's edges but keep the blank lines between its
    // paragraphs — they're the slide's own line breaks.
    const lines = block.map((l) => l.trim())
    while (lines.length && !lines[0]) lines.shift()
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    if (lines.length === 0) continue

    const legacyTitleLine = lines.find((l) => l.startsWith("כותרת:"))
    let title: string
    let body: string

    if (legacyTitleLine) {
      title = legacyTitleLine.replace("כותרת:", "").trim()
      body = lines.filter((l) => l !== legacyTitleLine).join("\n").trim()
    } else {
      title = lines[0]
      body = lines.slice(1).join("\n").trim()
    }

    // Collapse runs of blank lines so a stray double break doesn't blow up
    // the slide's layout.
    body = body.replace(/\n{3,}/g, "\n\n")

    parsed.push({ slide: slideNum, type: "content", title, body })
    slideNum++
  }

  if (parsed.length > 0) {
    parsed[0].type = "cover"
    parsed[parsed.length - 1].type = "cta"
  }

  return parsed
}
