/**
 * "סקריפט" is called "טקסט הפורמט" in the UI (launch call with Nataliya,
 * 2026-11-13, sheet #21: "הוספת מדיה לסקריפט" → "הוספת מדיה לטקסט הפורמט").
 * User-facing labels that name a format's script pass through here; `on` is
 * the gate (qaFixes1112 / useQaFixes1112 — Hani + Nataliya until launch), off
 * returns the text untouched. Order matters: the specific phrases first.
 */
const SWAPS: [RegExp, string][] = [
  // "הסקריפט המרכזי" is the core post's own text, not a format's.
  [/הסקריפט המרכזי/g, "הטקסט המרכזי"],
  [/סקריפט הפוסט/g, "טקסט הפורמט"],
  // "…סקריפט ל{פורמט}" already names the format → plain "טקסט".
  [/(ה)?סקריפט ל(?=\S)/g, "$1טקסט ל"],
  [/(ב|ל|מ)ה?סקריפט/g, "$1טקסט הפורמט"],
  [/(?:ה)?סקריפט/g, "טקסט הפורמט"],
]

export function formatTextTerms(text: string, on: boolean): string {
  if (!on) return text
  let out = text
  for (const [re, to] of SWAPS) out = out.replace(re, to)
  return out
}
