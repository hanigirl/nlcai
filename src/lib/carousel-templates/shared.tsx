/**
 * Shared building blocks for carousel templates.
 *
 * Satori (v0.26) does not run the Unicode Bidi Algorithm, so Hebrew text
 * renders LTR — visually reversed for an RTL reader. Same workaround used
 * in the reel-cover generator: reverse each Hebrew word's characters and
 * lay the words out in row-reverse so the line reads right-to-left.
 *
 * Every template MUST render text through <RtlText> — a bare string will
 * come out mirrored.
 */

import type { ReactNode } from "react"

export const SLIDE_SIZE = 1080

const HEBREW_CHAR = /[֐-׿]/
const LATIN_OR_DIGIT = /[0-9A-Za-z]/

// Paired punctuation must swap sides when a word is visually reversed,
// otherwise "(טיפ)" renders with both parens facing the wrong way.
const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
}

/**
 * Visually reverse a single word for satori's LTR-only layout.
 *
 * - Pure Latin/digit words ("ChatGPT", "25") pass through untouched —
 *   row-reverse already places them correctly in the line.
 * - Hebrew runs are character-reversed with paired punctuation mirrored.
 * - Mixed words ("ה-AI.") are split into Latin/digit runs vs. everything
 *   else; run order flips, but Latin/digit runs keep their internal order.
 */
function mirrorReverse(chars: string): string {
  return [...chars].map((ch) => MIRROR[ch] ?? ch).reverse().join("")
}

export function reverseWord(word: string): string {
  if (!HEBREW_CHAR.test(word)) {
    // Latin/digit word in an RTL line: the characters keep their order,
    // but edge punctuation must swap sides ("1:" → ":1", "25." → ".25")
    // or it visually lands between the number and the previous word.
    const m = word.match(/^([^0-9A-Za-z]*)([0-9A-Za-z].*?)([^0-9A-Za-z]*)$/)
    if (!m) return word
    const [, lead, core, trail] = m
    return mirrorReverse(trail) + core + mirrorReverse(lead)
  }

  const runs = word.match(/[0-9A-Za-z]+|[^0-9A-Za-z]+/g) ?? [word]
  return runs
    .reverse()
    .map((run) => (LATIN_OR_DIGIT.test(run) ? run : mirrorReverse(run)))
    .join("")
}

/**
 * RTL-safe text block. Preserves line breaks — each line gets its own
 * row-reverse row, otherwise wrapping breaks the visual order.
 */
export function RtlText({
  text,
  style,
  align = "center",
}: {
  text: string
  style: React.CSSProperties
  /** "right" = right-aligned block (for non-centered layouts) */
  align?: "center" | "right"
}) {
  const lines = text.split("\n")
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-end",
        ...style,
      }}
    >
      {lines.map((line, li) => {
        const words = line.split(" ")
        return (
          <div
            key={li}
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              flexWrap: "wrap",
              justifyContent: align === "center" ? "center" : "flex-start",
              gap: "0.28em",
              maxWidth: "100%",
            }}
          >
            {words.map((w, wi) => (
              <span key={wi}>{reverseWord(w)}</span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Bottom progress-dot bar. Relies on the slide root being a centered
 * flex column — `position: absolute` without left/right keeps the bar
 * at the parent's horizontal center in satori.
 */
export function ProgressDots({
  total,
  current,
  activeColor,
  inactiveColor,
  bottom = 40,
}: {
  total: number
  current: number
  activeColor: string
  inactiveColor: string
  /** Distance from the bottom edge — raise when the template has a frame */
  bottom?: number
}): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        bottom,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 32 : 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: i === current ? activeColor : inactiveColor,
          }}
        />
      ))}
    </div>
  )
}

/** Round slide-number badge, pinned to the top-left corner. */
export function SlideNumberBadge({
  number,
  bg,
  color,
  offset = 40,
}: {
  number: number
  bg: string
  color: string
  /** Distance from the top-left corner — raise when the template has a frame */
  offset?: number
}): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        top: offset,
        left: offset,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: bg,
        color,
        fontSize: 20,
        fontWeight: 700,
      }}
    >
      {number}
    </div>
  )
}
