/**
 * Remove long dashes, and hyphens used as dashes, from generated copy.
 *
 * The prompts forbid em/en dashes, and the model still slips them in (Hani,
 * 2026-09-03: "remove em dash from the core post creation"; Nataliya,
 * 2026-10-22: "למה הוא בדיפולט עוד מוסיף את השטויות האלה? אם-דאשים גם!").
 * A rule in a prompt is a request; this is the guarantee. Runs on model output
 * only, never on what the user typed.
 *
 * Every route that hands model-written copy to the user goes through this:
 * core post, its conversational edit, every format (carousel, story, image
 * post), hooks (both generators), and the post title. A new text-producing
 * route must call it too. `strip-dashes.test.mts` pins the behaviour.
 *
 * What it does:
 *   "רעיון — עוד רעיון"   → "רעיון, עוד רעיון"   (dash between clauses → comma)
 *   "רעיון -- עוד רעיון"  → "רעיון, עוד רעיון"   (double hyphen, same thing)
 *   "רעיון - עוד רעיון"   → "רעיון, עוד רעיון"   (spaced hyphen standing in for a dash)
 *   "רעיון. — עוד"        → "רעיון. עוד"          (already punctuated → just drop it)
 *   "— פריט"  at line start → "פריט"              (dash used as a bullet)
 *   "רעיון —" at line end   → "רעיון"
 *   a line that is only dashes ("---", "———", "⸻") → removed (a separator)
 *   "10–20", "ב–2020"       → "10-20", "ב-2020"     (range / Hebrew prefix keep a hyphen)
 * Ordinary hyphens inside words ("ה-AI", "בין-לאומי", "[תת-כותרת]") are left
 * alone, and so is a "- " list bullet.
 */
const LONG = "[‒–—―⸺⸻]"
const LONG_DASH = `${LONG}|--+`

// Punctuation that already closes the clause — a comma after it would double up.
const CLOSING = /[,.:;!?…]\s*$/

// A line made only of dashes (and spaces) is a separator, not text.
const SEPARATOR_LINE = new RegExp(`^\\s*(?:(?:${LONG_DASH}|-)\\s*){1,}$`)

function cleanLine(line: string): string {
  return (
    line
      // Ranges: "10–20" / "10 — 20" → "10-20".
      .replace(new RegExp(`(\\d)\\s*(?:${LONG})\\s*(?=\\d)`, "g"), "$1-")
      // Hebrew one-to-three-letter prefix glued to a dash: "ב–2020" → "ב-2020".
      .replace(new RegExp(`(^|[\\s"'(״׳])([בהוכלמש]{1,3})(?:${LONG})(?=\\S)`, "g"), "$1$2-")
      // Bullet-style dash at the start of a line.
      .replace(new RegExp(`^\\s*(?:${LONG_DASH})\\s*`), "")
      // Dash between clauses: long dash anywhere, or a hyphen with space on both sides.
      .replace(
        new RegExp(`\\s*(?:${LONG_DASH})\\s*|(?<=\\S)\\s+-\\s+(?=\\S)`, "g"),
        (match: string, offset: number, whole: string) => {
          const before = whole.slice(0, offset)
          const after = whole.slice(offset + match.length)
          if (!after.trim()) return "" // trailing dash
          // "5 - 3": arithmetic, not a dash. Leave it.
          if (/\d$/.test(before) && /^\d/.test(after) && /^\s+-\s+$/.test(match)) return match
          if (CLOSING.test(before)) return " "
          return ", "
        },
      )
      .replace(/[ \t]+$/, "")
  )
}

export function stripDashes(text: string): string {
  if (!text) return text
  return text
    .split("\n")
    .filter((line) => !SEPARATOR_LINE.test(line))
    .map(cleanLine)
    .join("\n")
    // Dropping a separator line can leave two blank lines in a row.
    .replace(/\n{3,}/g, "\n\n")
}
