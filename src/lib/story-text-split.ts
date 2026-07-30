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

/** Never more than this many frames when WE choose the count. */
export const MAX_STORY_FRAMES = 3

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
    .map((b) => b.replace(/^\s*\[[^\]]*\]\s*/g, "").trim())
    .filter(Boolean)
}

/**
 * How many frames this script wants, when nothing external dictates it.
 * Used by the AI path, which owns the frame count; the Drive path ignores
 * this because the user's link rows ARE the count.
 */
export function desiredFrameCount(body: string): number {
  const blocks = scriptBlocks(body)
  if (blocks.length === 0) return 0
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
  const blocks0 = scriptBlocks(body)
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
  const text = frames[frameIndex]?.trim()
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
