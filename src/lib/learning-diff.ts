/**
 * Small, dependency-free diff helpers for the learning loop.
 *
 * Two jobs:
 *  1. Decide whether an edit is worth learning from at all. A comma, a blank
 *     line, or a capitalisation change used to become a "binding preference"
 *     spliced into every future prompt. Those are filtered here — but a single
 *     swapped word is NOT trivial: restoring "בלגן" where the AI wrote "אתגר"
 *     is exactly the voice signal the loop exists to catch.
 *  2. Render only the changed lines (with a little context) for the insight
 *     extractor, instead of two full posts. The model then reads the change
 *     itself rather than hunting for it inside 2,000 characters of prose.
 *
 * Shared by the browser (skip the request), the API route (defence in depth)
 * and the extractor prompt, so it must stay free of server-only imports.
 */

/** Letters, digits and whitespace only — punctuation and symbols dropped. */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * True when the two texts differ only in punctuation, whitespace, line breaks
 * or letter case. Any change to an actual word counts as meaningful.
 */
export function isTrivialEdit(originalText: string, editedText: string): boolean {
  return normalizeForComparison(originalText) === normalizeForComparison(editedText)
}

/** Longest-common-subsequence table over two line arrays (classic DP). */
function lcsTable(a: string[], b: string[]): Uint16Array[] {
  const rows: Uint16Array[] = []
  for (let i = 0; i <= a.length; i++) rows.push(new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i][j] =
        a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1])
    }
  }
  return rows
}

type DiffOp = { kind: "same" | "removed" | "added"; line: string }

function lineDiff(a: string[], b: string[]): DiffOp[] {
  const table = lcsTable(a, b)
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "removed", line: a[i] })
      i++
    } else {
      ops.push({ kind: "added", line: b[j] })
      j++
    }
  }
  while (i < a.length) ops.push({ kind: "removed", line: a[i++] })
  while (j < b.length) ops.push({ kind: "added", line: b[j++] })
  return ops
}

/** Cap on rendered diff length so a wholesale rewrite can't blow up the prompt. */
const MAX_DIFF_CHARS = 6000

/**
 * Renders the changed lines between two texts, with one unchanged line of
 * context on each side of every change and "…" where unchanged runs were
 * skipped. Removed lines are prefixed "−", added lines "+", context "  ".
 *
 * Blank lines are compared like any other line, so a deleted paragraph break
 * still shows up — the triviality filter, not this renderer, decides whether
 * that alone is worth learning from.
 */
export function renderLineDiff(originalText: string, editedText: string): string {
  const a = originalText.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd())
  const b = editedText.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd())
  const ops = lineDiff(a, b)

  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((op, idx) => {
    if (op.kind === "same") return
    for (let k = Math.max(0, idx - 1); k <= Math.min(ops.length - 1, idx + 1); k++) keep[k] = true
  })

  const out: string[] = []
  let skipping = false
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      if (!skipping) out.push("…")
      skipping = true
      return
    }
    skipping = false
    const prefix = op.kind === "removed" ? "− " : op.kind === "added" ? "+ " : "  "
    out.push(prefix + (op.line || "(שורה ריקה)"))
  })

  const rendered = out.join("\n")
  return rendered.length > MAX_DIFF_CHARS ? rendered.slice(0, MAX_DIFF_CHARS) + "\n…" : rendered
}
