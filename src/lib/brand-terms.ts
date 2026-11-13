/**
 * "שפה ויזואלית" is called "שפת המותג" (Hani, 2026-11-13: "תחליף ל״שפת
 * המותג״ בכל המקומות"). Every user-facing string that names it passes through
 * here; `on` is the gate (qaFixes1112 / useQaFixes1112 — Hani + Nataliya until
 * launch), off returns the text untouched.
 */
const SWAPS: [RegExp, string][] = [
  [/(ב|ל|מ)?השפה הוו?יזואלית/g, "$1שפת המותג"],
  [/(ב|ל)שפה הוו?יזואלית/g, "$1שפת המותג"],
  [/(ב|ל)?שפה וו?יזואלית אחת/g, "$1שפת מותג אחת"],
  [/אין שפה וו?יזואלית/g, "אין שפת מותג"],
  [/(ב|ל|מ)?שפה וו?יזואלית/g, "$1שפת המותג"],
]

export function brandTerms(text: string, on: boolean): string {
  if (!on) return text
  let out = text
  for (const [re, to] of SWAPS) out = out.replace(re, to)
  return out
}
