/**
 * Turning the text of an uploaded Word file into a list of hooks.
 *
 * Most files people keep hooks in are already lists: one hook per line or
 * paragraph, maybe numbered, maybe bulleted, maybe with a title on top. Those
 * are split here, in code, for free and instantly. Only a file that reads as
 * prose (long paragraphs with hooks buried inside) is sent to the model, see
 * /api/hooks/import.
 */

/** Hard ceiling per import, so a 40-page doc can't flood the warehouse. */
export const MAX_IMPORTED_HOOKS = 50

/** A line longer than this is a paragraph of prose, not a hook. */
const MAX_HOOK_CHARS = 220

/** Shorter than this is a stray word or a page number, not a hook. */
const MIN_HOOK_CHARS = 4

/** Strips list markers and wrapping quotes: "1. ", "2) ", "- ", "• ", "* ", "“…”". */
export function cleanHookLine(line: string): string {
  const stripped = line
    .replace(/‏|‎/g, "") // RTL/LTR marks Word leaves behind
    .trim()
    // Markers need a space after them when they're digits/letters, so
    // "10:00 בבוקר" or "3 טעויות" keep their opening.
    .replace(/^(?:[-–—•●○▪■*·]+\s*|\(?\d{1,3}[.)]\s+|[א-ת][.)]\s+)/, "")
    .trim()
  // Only a quote pair that wraps the whole line; a lone ' or ״ is Hebrew
  // spelling (צ'יפס, בע״מ), not a quote.
  const wrapped = stripped.match(/^["“”„](.*)["“”„]$/)
  return (wrapped ? wrapped[1] : stripped).trim()
}

function isLabel(line: string): boolean {
  // "הוקים לרילס:" / "Hooks:" — a heading that introduces the list.
  return /[:：]$/.test(line)
}

export interface SplitResult {
  hooks: string[]
  /** True when the text already reads as a list of hooks. */
  listLike: boolean
}

export function splitHookList(text: string): SplitResult {
  const candidates = text
    .split(/\r?\n/)
    .map(cleanHookLine)
    .filter((l) => l.length >= MIN_HOOK_CHARS && !isLabel(l))

  const listLike = candidates.length > 0 && candidates.every((l) => l.length <= MAX_HOOK_CHARS)
  return { hooks: dedupeHooks(candidates).slice(0, MAX_IMPORTED_HOOKS), listLike }
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

/** Drops repeats inside the list, and anything already in `existing`. */
export function dedupeHooks(hooks: string[], existing: string[] = []): string[] {
  const seen = new Set(existing.map(normalize))
  const out: string[] = []
  for (const h of hooks) {
    const key = normalize(h)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(h)
  }
  return out
}

/** Prompt for the prose case: find the hooks, copy them verbatim. */
export function buildHookExtractionPrompt(text: string): string {
  return `לפניך טקסט מתוך מסמך Word שמשתמשת העלתה למחסן ההוקים שלה.
המשימה: למצוא בטקסט את ההוקים (משפטי פתיחה לפוסטים/רילס) ולהחזיר אותם.

כללים:
- להעתיק כל הוק מילה במילה, בדיוק כפי שהוא כתוב. לא לשכתב, לא לתקן, לא לקצר, לא לתרגם.
- לא להמציא הוקים שלא כתובים בטקסט.
- לא לכלול כותרות, הסברים, הערות או טקסט שאינו הוק.
- הוק אחד בכל שורה. בלי מספור, בלי תבליטים, בלי מרכאות, בלי שום טקסט נוסף לפני או אחרי.
- אם אין בטקסט אף הוק, להחזיר תשובה ריקה.
- לכל היותר ${MAX_IMPORTED_HOOKS} הוקים.

הטקסט:
"""
${text}
"""`
}

/** Reads the model's answer back into hooks, with the same cleaning as a list. */
export function parseExtractedHooks(raw: string): string[] {
  return dedupeHooks(
    raw
      .split(/\r?\n/)
      .map(cleanHookLine)
      .filter((l) => l.length >= MIN_HOOK_CHARS && !isLabel(l)),
  ).slice(0, MAX_IMPORTED_HOOKS)
}

/** Pulls the document id out of any docs.google.com/document/… link. */
export function parseGoogleDocId(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null
  const match = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,})/)
  return match ? match[1] : null
}
