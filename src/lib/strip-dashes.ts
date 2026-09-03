/**
 * Remove long dashes from generated copy.
 *
 * The core-post prompt forbids em/en dashes, and the model still slips them
 * in (Hani, 2026-09-03: "remove em dash from the core post creation"). A rule
 * in a prompt is a request; this is the guarantee. Runs on model output only,
 * never on what the user typed.
 *
 * What it does:
 *   "רעיון — עוד רעיון"   → "רעיון, עוד רעיון"   (dash between clauses → comma)
 *   "רעיון -- עוד רעיון"  → "רעיון, עוד רעיון"   (double hyphen, same thing)
 *   "רעיון. — עוד"        → "רעיון. עוד"          (already punctuated → just drop it)
 *   "— פריט"  at line start → "פריט"              (dash used as a bullet)
 * Ordinary hyphens inside words ("ה-AI", "בין-לאומי") are left alone.
 */
const LONG_DASH = "[–—―]|--+"

// Punctuation that already closes the clause — a comma after it would double up.
const CLOSING = /[,.:;!?…]\s*$/

export function stripDashes(text: string): string {
  if (!text) return text
  return text
    .split("\n")
    .map((line) =>
      line
        // bullet-style dash at the start of a line
        .replace(new RegExp(`^\\s*(?:${LONG_DASH})\\s*`), "")
        // dash between clauses
        .replace(new RegExp(`\\s*(?:${LONG_DASH})\\s*`, "g"), (_m, offset: number, whole: string) => {
          const before = whole.slice(0, offset)
          if (CLOSING.test(before)) return " "
          return ", "
        })
        .replace(/[ \t]+$/, "")
    )
    .join("\n")
}
