/**
 * Splitting a story script across N frames.
 *
 * Lifted out of `api/story/generate-media` (Hani, 2026-07-29) so the SAME
 * split runs whether the frames are drawn by the AI or brought in from Drive.
 * Two code paths dividing the same script by different rules would put the
 * hook on frame 1 in one flow and halfway down frame 2 in the other.
 *
 * Deliberately deterministic — no model call. The script already carries its
 * structure: the story generator emits hook / content / CTA as blank-line
 * separated blocks, so "split it sensibly" is a grouping problem over blocks
 * that are already the author's own units of thought. An LLM here would cost
 * a round trip and return a different answer every run, for a job whose right
 * answer is already written into the text.
 *
 * The shape it produces, matching how a story is actually read:
 *   - Frame 1 leads with the hook.
 *   - Middle frames carry the body, balanced by length.
 *   - The last block (usually the CTA) lands on the final frame.
 *   - One frame → everything together; the renderer shrinks the type to fit
 *     rather than dropping the tail.
 */

/** Never more than this many frames when WE choose the count from length. */
export const MAX_STORY_FRAMES = 3

/** The script's own division wins, up to this many frames (3 render at a time inside the route's 300 s, so 6 = two rounds). */
const MAX_SCRIPT_FRAMES = 6

/**
 * A line that names a frame — "פריים 1", "[מסך 2]", "סטורי 3:", "Frame 4".
 * It's an instruction for us, never text for the image (Hani, 2026-10-29:
 * "פריים 1" was drawn onto the frame). Optional text after a colon on the
 * same line belongs to that frame.
 */
const FRAME_MARKER = /^\s*[\[(]?\s*(?:פריים|מסך|סטורי|שקופית|frame|screen|slide)\s*\d+\s*[\])]?\s*[:.\-–—]?\s*/i

/**
 * The script with its frame marks taken out — "סטורי 1", "[מסך 2]" lines are
 * the card's way of saying where a story ends (Hani, 2026-11-05) and must
 * NEVER reach a frame's picture, a burned caption or anything published.
 * Text after a mark on the same line stays.
 */
export function stripFrameMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(FRAME_MARKER)
      return m && m[0].trim() ? line.slice(m[0].length) : line
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** True when `text` still carries a frame mark — for the checks. */
export function hasFrameMarker(text: string): boolean {
  return text.split("\n").some((line) => {
    const m = line.match(FRAME_MARKER)
    return !!m && !!m[0].trim()
  })
}

/**
 * The script divided by its own frame markers, or null when it has none.
 *
 * One marker counts too (Hani, 2026-11-05 — the story card's split view):
 * "סטורי 1" over a script with several paragraphs means ONE story she chose,
 * not one per paragraph.
 */
function markedFrames(body: string): string[] | null {
  const frames: string[] = []
  let current: string[] | null = null
  let marked = false
  for (const line of body.split("\n")) {
    const m = line.match(FRAME_MARKER)
    if (m && m[0].trim()) {
      marked = true
      if (current) frames.push(current.join("\n").trim())
      current = []
      const rest = line.slice(m[0].length).trim()
      if (rest) current.push(rest)
    } else if (current) {
      current.push(line)
    } else if (line.trim()) {
      // Text before the first marker opens frame 1.
      current = [line]
    }
  }
  if (current) frames.push(current.join("\n").trim())
  const kept = frames.filter(Boolean)
  return marked && kept.length >= 1 ? kept.slice(0, MAX_SCRIPT_FRAMES) : null
}

/**
 * The script's units, in order: its marked frames when it has them, else its
 * blank-line blocks. Marker lines never survive into the text.
 */
function scriptUnits(body: string): string[] {
  return markedFrames(body) ?? scriptBlocks(body)
}

// Legibility thresholds, in Hebrew characters, tuned for a designed 9:16
// poster where the type must stay large. Below the first threshold the whole
// script fits one frame comfortably; each further band adds a frame.
const ONE_FRAME_MAX_CHARS = 220
const TWO_FRAME_MAX_CHARS = 460

/**
 * The author's own units: blank-line separated blocks, minus any legacy
 * `[מסך N]` label that older dummy text carried.
 */
export function scriptBlocks(body: string): string[] {
  return body
    .split(/\n\s*\n+/)
    .map((b) =>
      b
        .split("\n")
        .map((line) => line.replace(FRAME_MARKER, (m) => (m.trim() ? "" : m)))
        .join("\n")
        .replace(/^\s*\[[^\]]*\]\s*/g, "")
        .trim(),
    )
    .filter(Boolean)
}

/**
 * How many frames this script wants, when nothing external dictates it.
 * Used by the AI path, which owns the frame count; the Drive path ignores
 * this because the user's link rows ARE the count.
 */
export function desiredFrameCount(body: string): number {
  // The script already says how it divides (Hani, 2026-10-29: the AI split a
  // story differently from its script): marked frames, or the author's own
  // blank-line paragraphs, one frame each.
  const marked = markedFrames(body)
  if (marked) return marked.length
  const blocks = scriptBlocks(body)
  if (blocks.length === 0) return 0
  if (blocks.length >= 2) return Math.min(MAX_SCRIPT_FRAMES, blocks.length)
  // One undivided block: choose by length so the type stays legible.
  const totalChars = blocks.reduce((n, b) => n + b.length, 0)
  return Math.min(
    MAX_STORY_FRAMES,
    totalChars <= ONE_FRAME_MAX_CHARS
      ? 1
      : totalChars <= TWO_FRAME_MAX_CHARS
        ? 2
        : 3,
  )
}

/**
 * Split `body` into exactly `frameCount` frames (or fewer, if the text simply
 * cannot be divided that far — one short sentence can't fill three frames).
 *
 * Blocks stay whole wherever possible: a paragraph is a thought, and cutting
 * one across two frames is what makes a story read as broken. Only when there
 * are fewer blocks than frames do we split the longest one, and then at a
 * sentence boundary.
 */
export function splitScriptIntoFrames(
  body: string,
  frameCount: number,
): string[] {
  const blocks0 = scriptUnits(body)
  if (blocks0.length === 0) return []
  if (frameCount <= 1) return [blocks0.join("\n\n")]

  // Fewer blocks than frames (e.g. one giant paragraph). Sentence-split the
  // longest block repeatedly until there are enough pieces.
  const blocks = [...blocks0]
  while (blocks.length < frameCount) {
    let longest = 0
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].length > blocks[longest].length) longest = i
    }
    const halves = splitBlockInHalf(blocks[longest])
    if (halves.length < 2) break // can't split further — bail with what we have
    blocks.splice(longest, 1, halves[0], halves[1])
  }
  const groups = Math.min(frameCount, blocks.length)
  if (groups <= 1) return [blocks.join("\n\n")]

  // The shape Hani described (2026-07-29): "בהתחלה ההוק, אחר כך מרכז הטקסט,
  // ובסוף הפסקה האחרונה". So the split is STRUCTURAL, not merely balanced:
  //   frame 1      → the hook, alone
  //   frame N      → the closing block (the CTA), alone
  //   frames 2..N-1 → everything between, balanced by length
  // Pure length-balancing gets this wrong in the common case: with a short
  // hook it packs the hook and the first body paragraph together and leaves
  // the last frame holding a 35-character CTA.
  if (groups === 2) return [blocks[0], blocks.slice(1).join("\n\n")]

  const middle = blocks.slice(1, -1)
  const middleGroups = groups - 2
  return [
    blocks[0],
    ...balanceBlocksIntoGroups(middle, Math.min(middleGroups, middle.length)),
    blocks[blocks.length - 1],
  ]
}

/**
 * Group consecutive blocks into `groups` frames, keeping order and balancing
 * character counts greedily (each block joins the current frame until doing
 * so would overshoot the even per-frame target).
 */
function balanceBlocksIntoGroups(blocks: string[], groups: number): string[] {
  const total = blocks.reduce((n, b) => n + b.length, 0)
  const target = total / groups
  const frames: string[] = []
  let current: string[] = []
  let currentChars = 0
  for (let i = 0; i < blocks.length; i++) {
    const remainingBlocks = blocks.length - i
    const remainingSlots = groups - frames.length
    // Keep at least one block per remaining frame slot.
    const mustClose = remainingBlocks <= remainingSlots - 1
    if (
      current.length > 0 &&
      (mustClose ||
        (frames.length < groups - 1 && currentChars >= target * 0.9))
    ) {
      frames.push(current.join("\n\n"))
      current = []
      currentChars = 0
    }
    current.push(blocks[i])
    currentChars += blocks[i].length
  }
  if (current.length > 0) frames.push(current.join("\n\n"))
  return frames
}

/** Split one block near its middle, preferring a sentence boundary. */
function splitBlockInHalf(block: string): string[] {
  const sentences = block.split(/(?<=[.!?…])\s+/).filter(Boolean)
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2)
    return [
      sentences.slice(0, mid).join(" ").trim(),
      sentences.slice(mid).join(" ").trim(),
    ]
  }
  // No sentence boundary — split on the nearest space to the midpoint.
  const mid = Math.floor(block.length / 2)
  const left = block.lastIndexOf(" ", mid)
  const cut = left > 0 ? left : mid
  return [block.slice(0, cut).trim(), block.slice(cut).trim()].filter(Boolean)
}

/**
 * The caption for ONE frame, split into its two type tiers.
 *
 * Frame 1 leads with the hook as a headline; later frames are body only —
 * repeating headline styling on every frame would flatten the hierarchy and
 * make each frame look like a fresh start.
 */
export function frameCaption(
  body: string,
  frameIndex: number,
  frameCount: number,
): { headline?: string; body?: string } {
  const frames = splitScriptIntoFrames(body, frameCount)
  // No frame mark ever reaches a burned caption.
  const text = stripFrameMarkers(frames[frameIndex] ?? "")
  if (!text) return {}

  if (frameIndex > 0) return { body: text }

  // Frame 1: the hook is its first block; anything else on this frame is
  // support text under it.
  const blocks = scriptBlocks(text)
  const [headline, ...rest] = blocks
  return {
    headline: headline || undefined,
    body: rest.length > 0 ? rest.join("\n\n") : undefined,
  }
}

const HEBREW_COUNTS: Record<string, number> = {
  אחד: 1, אחת: 1, שני: 2, שתי: 2, שניים: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6,
}

/**
 * A frame count she asked for in her own words for this piece — "לפצל ל-2
 * סטוריז", "שני פריימים", "ב-3 חלקים" (Hani, 2026-11-05: "split into 2
 * stories" came back as the script's 3). Null when she didn't say.
 */
export function requestedFrameCount(text: string | null | undefined): number | null {
  if (!text) return null
  const m = /(?:^|[\s\-־"'(לבו])(\d+|אחד|אחת|שני|שתי|שניים|שתיים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה)\s*(?:סטורי(?:ז|ס|יז)?|סטוריז|פריימ(?:ים)?|פריים|חלקים|פרקים|stories|frames)/i.exec(
    text,
  )
  if (!m) return null
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : HEBREW_COUNTS[m[1]]
  return n >= 1 && n <= MAX_SCRIPT_FRAMES ? n : null
}

/**
 * Split into `frameCount` frames of roughly EQUAL text, for a count she asked
 * for herself (requestedFrameCount). Hani, 2026-11-05: "split into 2" must
 * not mean the hook alone and everything else on the last frame — balance by
 * length; the hook may share a frame with what follows.
 *
 * Sentences stay whole (a line of her script counts as one). Among the splits
 * that balance best, a break at a paragraph boundary is preferred over one
 * inside a paragraph. Marked frames ("פריים 1:") are hers and are not used
 * here — the caller only comes here when she named a count.
 */
export function splitScriptBalanced(body: string, frameCount: number): string[] {
  const paragraphs = scriptUnits(body)
  if (paragraphs.length === 0) return []
  if (frameCount <= 1) return [paragraphs.join("\n\n")]

  // Sentences, each remembering whether it ends its line / its paragraph.
  // A sentence break inside a quote isn't one ("מה קורה לך? מה חסר לך?").
  const units: { text: string; endsLine: boolean; endsParagraph: boolean }[] = []
  for (const p of paragraphs) {
    const lines = p.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    lines.forEach((line, li) => {
      const sentences: string[] = []
      for (const piece of line.split(/(?<=[.!?…])\s+/)) {
        const prev = sentences[sentences.length - 1]
        const openQuote = prev !== undefined && ((prev.match(/["״“”]/g) ?? []).length % 2 === 1)
        if (openQuote) sentences[sentences.length - 1] = `${prev} ${piece}`
        else sentences.push(piece)
      }
      sentences.forEach((text, si) => {
        const endsLine = si === sentences.length - 1
        units.push({ text, endsLine, endsParagraph: endsLine && li === lines.length - 1 })
      })
    })
  }
  const k = Math.min(frameCount, units.length)
  if (k <= 1) return [paragraphs.join("\n\n")]

  const total = units.reduce((n, u) => n + u.text.length, 0)
  const target = total / k
  // Where a frame may end, cheapest first: a paragraph boundary (free), a
  // line boundary (as much as being 8% off the target), between sentences
  // of one line (30%) — a question and its answer on one line stay together.
  const breakPenalty = (u: { endsLine: boolean; endsParagraph: boolean }) =>
    u.endsParagraph ? 0 : u.endsLine ? (0.08 * target) ** 2 : (0.3 * target) ** 2
  const prefix = [0]
  for (const u of units) prefix.push(prefix[prefix.length - 1] + u.text.length)
  const groupCost = (from: number, to: number) => (prefix[to] - prefix[from] - target) ** 2

  // best[g][i]: cheapest way to put units[0..i) into g frames.
  const n = units.length
  const best: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1))
  best[0][0] = 0
  for (let g = 1; g <= k; g++) {
    for (let i = g; i <= n; i++) {
      for (let j = g - 1; j < i; j++) {
        if (best[g - 1][j] === Infinity) continue
        const breakCost = j > 0 ? breakPenalty(units[j - 1]) : 0
        const c = best[g - 1][j] + groupCost(j, i) + breakCost
        if (c < best[g][i]) {
          best[g][i] = c
          cut[g][i] = j
        }
      }
    }
  }

  const bounds: number[] = []
  for (let g = k, i = n; g > 0; g--) {
    bounds.unshift(i)
    i = cut[g][i]
  }
  const frames: string[] = []
  let start = 0
  for (const end of bounds) {
    // Her own layout inside a frame: same line, line break, blank line.
    let text = ""
    for (let u = start; u < end; u++) {
      text += units[u].text + (u === end - 1 ? "" : units[u].endsParagraph ? "\n\n" : units[u].endsLine ? "\n" : " ")
    }
    frames.push(text.trim())
    start = end
  }
  return frames
}

/**
 * THE story split — what api/story/generate-media draws and what the story
 * card shows while she writes (Hani, 2026-11-05), so the two never disagree:
 *   1. her own marks ("סטורי 1"…) win — they are the split she set;
 *   2. else a count she asked for at generation ("לפצל ל-2 סטוריז",
 *      requestedFrameCount) — balanced by length (splitScriptBalanced);
 *   3. else her blank-line paragraphs, one story each (or by length for one
 *      undivided block) — desiredFrameCount.
 */
export function storyFrames(body: string, asked?: number | null): string[] {
  const marked = markedFrames(body)
  const frames = marked
    ? splitScriptIntoFrames(body, marked.length)
    : asked
      ? splitScriptBalanced(body, asked)
      : splitScriptIntoFrames(body, desiredFrameCount(body))
  // Belt and braces: no mark ever reaches a frame's text.
  return frames.map(stripFrameMarkers).filter(Boolean)
}

/** Most frames a script can set for itself. */
export const MAX_STORY_SCRIPT_FRAMES = MAX_SCRIPT_FRAMES

/**
 * The check behind "סטורי 1 never ends up in the picture" (Hani, 2026-11-05):
 * every text the story pipeline hands on — each frame the generator draws,
 * each caption burned over her own frames (at the script's count and at one
 * frame), and the copy / planner text — must be free of frame marks. Returns
 * the names of the ones that aren't (empty = clean). Used by the story card
 * preview (/test/story-frame-split).
 */
export function frameMarkerLeaks(body: string): string[] {
  const leaks: string[] = []
  const frames = storyFrames(body)
  frames.forEach((f, i) => hasFrameMarker(f) && leaks.push(`פריים ${i + 1} ביצירה`))
  for (let i = 0; i < frames.length; i++) {
    const c = frameCaption(body, i, frames.length)
    if (hasFrameMarker([c.headline, c.body].filter(Boolean).join("\n"))) leaks.push(`כיתוב פריים ${i + 1}`)
  }
  const one = frameCaption(body, 0, 1)
  if (hasFrameMarker([one.headline, one.body].filter(Boolean).join("\n"))) leaks.push("כיתוב על תמונה שהעלו")
  if (hasFrameMarker(stripFrameMarkers(body))) leaks.push("טקסט להעתקה")
  return leaks
}

/**
 * The story card's sections (Hani, 2026-11-05: a grey "סטורי 1" over each
 * story's text). The stories the generator makes (storyFrames) — plus any
 * story she added and hasn't written yet: an empty "סטורי 3" stays on the
 * card, while the generator simply skips it.
 */
export function storySections(body: string): string[] {
  if (!markedFrames(body)) return storyFrames(body)
  const sections: string[] = []
  let current: string[] | null = null
  for (const line of body.split("\n")) {
    const m = line.match(FRAME_MARKER)
    if (m && m[0].trim()) {
      if (current) sections.push(current.join("\n").trim())
      current = []
      const rest = line.slice(m[0].length).trim()
      if (rest) current.push(rest)
    } else if (current) {
      current.push(line)
    } else if (line.trim()) {
      current = [line]
    }
  }
  if (current) sections.push(current.join("\n").trim())
  return sections.slice(0, MAX_SCRIPT_FRAMES)
}

/** The card's sections back to a script — "סטורי N" over each, empty ones kept. */
export function sectionsToScript(sections: string[]): string {
  return sections
    .slice(0, MAX_SCRIPT_FRAMES)
    .map((f, i) => (f.trim() ? `סטורי ${i + 1}\n${f.trim()}` : `סטורי ${i + 1}`))
    .join("\n\n")
}

/**
 * Removes the split before or after story `index` — never her words (Hani,
 * 2026-11-05): story N's text joins the end of story N-1; story 1's text
 * joins the start of the next one. One story left: nothing to remove.
 */
export function removeStorySplit(sections: string[], index: number): string[] {
  if (sections.length < 2 || index < 0 || index >= sections.length) return sections
  const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join("\n")
  if (index === 0) return [join(sections[0], sections[1]), ...sections.slice(2)]
  return [...sections.slice(0, index - 1), join(sections[index - 1], sections[index]), ...sections.slice(index + 1)]
}
