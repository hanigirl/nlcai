// Deterministic near-duplicate detection for hooks.
//
// The anti-repetition work in the hook prompts is instruction-only: we show
// the model what it already wrote and ask it not to repeat itself. That moves
// the odds, it doesn't close the door — a model that ignores the instruction
// produced exactly the bug we were fixing, and nothing downstream noticed.
// This is the check that notices. It costs nothing (no model call) and its
// output feeds the judge that already runs on every hook, so a caught repeat
// gets rewritten rather than dropped.

/** Hebrew prefixes that attach to a word and would otherwise defeat matching. */
const PREFIXES = /^(?:וה|שה|לה|מה|כשה|וב|ול|ומ|וכ|וש|ה|ו|ב|ל|מ|כ|ש)/

// Function words carry no angle. Left in, two hooks about entirely different
// things score as similar purely on their connectives.
const STOPWORDS = new Set([
  "של", "את", "לא", "יש", "אם", "זה", "זו", "זאת", "על", "עם", "מה", "איך",
  "כל", "גם", "אבל", "או", "כי", "רק", "עוד", "כבר", "אני", "אתה", "את",
  "אתם", "הוא", "היא", "הם", "לך", "לכם", "שלך", "שלכם", "אותך", "יותר",
  "פחות", "מאוד", "ככה", "בלי", "אחרי", "לפני", "בין", "עד", "אז", "הכי",
])

/**
 * Strip punctuation and a leading prefix letter so "בפיגמה" and "פיגמה" are
 * the same token. Deliberately crude — real Hebrew stemming is not worth a
 * dependency here, and over-stripping only makes the check more eager, which
 * the threshold below absorbs.
 */
function normalizeToken(word: string): string {
  const bare = word.replace(/[^֐-׿a-zA-Z0-9]/g, "")
  if (bare.length <= 3) return bare
  const stripped = bare.replace(PREFIXES, "")
  return stripped.length >= 3 ? stripped : bare
}

function contentTokens(hook: string): Set<string> {
  return new Set(
    hook
      .split(/\s+/)
      .map(normalizeToken)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )
}

/** Overlap of content words, 0–1. */
export function hookSimilarity(a: string, b: string): number {
  const ta = contentTokens(a)
  const tb = contentTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

/**
 * 0.55, not higher: two hooks that share more than half their content words
 * are the same angle rephrased, which is precisely what the user was clicking
 * regenerate to escape. Not lower, because hooks on one idea legitimately
 * share the idea's own nouns — a stricter bar flags every hook in the batch
 * and the judge starts rewriting things that were fine.
 */
const NEAR_DUPLICATE_THRESHOLD = 0.55

/**
 * The closest thing in `pool` that this hook duplicates, or null. Returns the
 * matched text rather than a boolean so the caller can tell the judge *what*
 * was repeated — a bare "this is a repeat" gives it nothing to steer away
 * from, and it rewrites into a second copy of the same angle.
 */
export function findNearDuplicate(hook: string, pool: string[]): string | null {
  let best: { text: string; score: number } | null = null
  for (const candidate of pool) {
    if (!candidate?.trim()) continue
    const score = hookSimilarity(hook, candidate)
    if (score >= NEAR_DUPLICATE_THRESHOLD && (!best || score > best.score)) {
      best = { text: candidate, score }
    }
  }
  return best?.text ?? null
}
