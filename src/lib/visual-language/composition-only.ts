/**
 * Her analysed visual language is a text description written from her
 * usage examples. When the examples supply composition only (Hani,
 * 2026-11-09), the parts of that description that name colours or fonts
 * must not reach the generator: colours come from her brand colours and
 * fonts from her brand fonts. This strips them clause by clause, so the
 * composition around them (full-bleed photo, centred column, rounded
 * boxes, short lines) survives.
 */

const HEX = /#[0-9a-f]{3,8}\b/i

const COLOUR_WORDS = [
  "colou?rs?", "colou?red", "palette", "hues?", "tints?", "tinted", "shades?", "monochrome", "pastels?", "neon",
  "red", "burgundy", "maroon", "crimson", "wine", "pink", "rose", "blush", "magenta", "fuchsia", "purple", "violet",
  "lavender", "lilac", "plum", "blue", "navy", "teal", "turquoise", "cyan", "aqua", "green", "olive", "sage", "mint",
  "emerald", "forest", "yellow", "mustard", "gold(?:en)?", "orange", "peach", "coral", "apricot", "terracotta",
  "brown", "tan", "beige", "cream", "ivory", "oatmeal", "sand", "taupe", "khaki", "camel", "grey", "gray", "silver",
  "charcoal", "stone", "off-white", "warm-neutral", "neutral", "sepia",
]
const FONT_WORDS = [
  "fonts?", "typefaces?", "typography", "serif", "sans-serif", "sans", "script", "handwritten", "monospace",
  "slab", "geometric sans", "grotesk", "rubik", "heebo", "assistant", "varela", "frank ruhl",
]

function wordRe(words: string[]): RegExp {
  return new RegExp(`(^|[^a-z-])(${words.join("|")})(?=$|[^a-z-])`, "i")
}

const COLOUR_RE = wordRe(COLOUR_WORDS)
const FONT_RE = wordRe(FONT_WORDS)

/** Split a sentence into clauses at , ; : and dashes — never inside parentheses. */
function clauses(sentence: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i]
    if (ch === "(") depth++
    if (ch === ")") depth = Math.max(0, depth - 1)
    const dash = (ch === "—" || ch === "–") && sentence[i - 1] === " "
    if (depth === 0 && (ch === "," || ch === ";" || ch === ":" || dash)) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim()).filter(Boolean)
}

export function stripLookWords(text: string, opts: { colours: boolean; fonts: boolean }): string {
  if (!opts.colours && !opts.fonts) return text
  const hits = (s: string) =>
    (opts.colours && (HEX.test(s) || COLOUR_RE.test(s))) || (opts.fonts && FONT_RE.test(s))
  return text
    .split(/\n/)
    .map((line) =>
      (line.match(/[^.!?]+[.!?]*/g) ?? [])
        .map((sentence) => {
          if (!hits(sentence)) return sentence.trim()
          const kept = clauses(sentence.replace(/[.!?]+\s*$/, "")).filter((c) => !hits(c))
          // A clause that only introduced what was removed ("and", "with") goes too.
          const cleaned = kept.filter((c) => !/^(and|with|or|in|of|plus)$/i.test(c))
          if (!cleaned.length) return ""
          const joined = cleaned.join(", ")
          return `${joined[0].toUpperCase()}${joined.slice(1)}.`
        })
        .filter(Boolean)
        .join(" "),
    )
    .join("\n")
    .trim()
}
