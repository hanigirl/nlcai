import { createHash } from "crypto"
import type { MediaStyle } from "@/lib/visual-language/types"

/**
 * A finished piece keeps the brief it was designed from (carousel layout,
 * b-roll, animated story frame), so "עריכה עם AI" can revise it. That brief
 * is a snapshot of her visual language AT THAT TIME. When she replaces her
 * language in Settings, an edit that still reads the snapshot keeps the old
 * look while the brand elements pasted on top come from the new one — a mix
 * of both (Hani, 2026-11-05). And a request to apply the new language did
 * nothing: the editor was only ever shown the old one.
 *
 * So every edit re-reads her CURRENT language, and these helpers tell which
 * parts of a stored brief are the language (replaced) and which are this
 * piece's own (kept): her direction for this piece, the slide texts.
 */

const PIECE_HEADER = "THE CREATOR'S OWN DIRECTION FOR THIS PIECE"
const RULES_HEADER = "STANDING PREFERENCES"

/**
 * She asks to (re)apply her own visual language / brand to the piece:
 * "תערוך לפי שפת המותג המחודשת", "לפי השפה הוויזואלית שלי", "במיתוג שלי".
 */
export function wantsOwnLanguage(instruction: string): boolean {
  return /שפ(?:ה|ת)\s*(?:ה)?(?:ו)?ויזו?אלית|שפת\s*(?:ה)?מותג|שפה\s*מותגית|(?:ה)?מיתוג\s*(?:שלי|החדש|המחודש)|visual\s+language|brand\s+language/i.test(
    instruction,
  )
}

/** Which look a stored brief was made in, read from its "VISUAL LANGUAGE —" line. */
export function styleOfLines(lines: string[]): MediaStyle {
  const head = lines.find((l) => l.startsWith("VISUAL LANGUAGE")) ?? ""
  if (head.includes("the creator's own brand")) return "brand"
  if (head.includes("a DARK design")) return "ai-dark"
  if (head.includes("a LIGHT design")) return "ai-light"
  if (head.includes("Start from a blank page")) return "blank"
  return "niche"
}

/** Her own direction for this piece (lib/media-brief) — always at the end, kept across a refresh. */
export function pieceLines(lines: string[]): string[] {
  const at = lines.findIndex((l) => l.startsWith(PIECE_HEADER))
  return at < 0 ? [] : ["", ...lines.slice(at)]
}

/**
 * The language part only — without her standing preferences (saving one in
 * the chat must not count as a new language) and without this piece's own
 * direction.
 */
export function languageLines(lines: string[]): string[] {
  const end = lines.findIndex((l) => l.startsWith(RULES_HEADER) || l.startsWith(PIECE_HEADER))
  const base = end < 0 ? lines : lines.slice(0, end)
  return base.map((l) => l.trim()).filter(Boolean)
}

/** Stable fingerprint of the language parts of a brief. */
export function languageKey(parts: unknown): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex")
}

/** Added to a b-roll / animated-frame edit when its look is rebuilt in her current language. */
export const MOTION_RESTYLE_NOTE =
  "RESTYLE — the fonts, colours and visual language in the brief are the creator's CURRENT visual language. This composition was designed in an earlier look she has replaced (or drifted from it). Rebuild its whole look in the current language — type treatment, colours, shapes and accents — as if designed from this brief today; nothing of the earlier look may remain. Keep the words exactly. The background image has already been redrawn in the current language."
