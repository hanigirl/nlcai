// Regression test for long dashes in generated copy. Run with: npx tsx src/lib/strip-dashes.test.mts
//
// There is no test runner in this project yet, so this is a standalone script
// (same convention as speech-dictation.test.mts). It exists because the
// "em dashes came back in the post" bug (Nataliya, 2026-10-22) was fixed once
// for the core post only, and every other route kept leaking them.

import { stripDashes } from "./strip-dashes"

const cases: Array<[string, string, string]> = [
  ["em dash between clauses", "רעיון — עוד רעיון", "רעיון, עוד רעיון"],
  ["en dash between clauses", "רעיון – עוד רעיון", "רעיון, עוד רעיון"],
  ["glued em dash", "קצר—ולעניין", "קצר, ולעניין"],
  ["double hyphen", "רעיון -- עוד רעיון", "רעיון, עוד רעיון"],
  ["spaced hyphen used as a dash", "זה לא הכלי - זה התהליך", "זה לא הכלי, זה התהליך"],
  ["after punctuation", "רעיון. — עוד", "רעיון. עוד"],
  ["bullet dash", "— פריט ראשון\n— פריט שני", "פריט ראשון\nפריט שני"],
  ["trailing dash", "וזה הסוד —\nהמשך", "וזה הסוד\nהמשך"],
  ["separator line", "פסקה אחת\n\n---\n\nפסקה שתיים", "פסקה אחת\n\nפסקה שתיים"],
  ["em separator line", "פסקה\n———\nעוד", "פסקה\nעוד"],
  ["numeric range", "בין 10–20 דקות", "בין 10-20 דקות"],
  ["hebrew prefix", "ב–2020 התחלתי", "ב-2020 התחלתי"],
  ["hyphen inside words untouched", "ה-AI הוא בין-לאומי", "ה-AI הוא בין-לאומי"],
  ["format tags untouched", "[תת-כותרת]\nטקסט", "[תת-כותרת]\nטקסט"],
  ["hyphen list bullet untouched", "- פריט\n- עוד פריט", "- פריט\n- עוד פריט"],
  ["arithmetic untouched", "5 - 3 = 2", "5 - 3 = 2"],
  ["empty", "", ""],
]

let failed = 0
for (const [name, input, expected] of cases) {
  const got = stripDashes(input)
  if (got !== expected) {
    failed++
    console.error(`FAIL ${name}\n  in:   ${JSON.stringify(input)}\n  want: ${JSON.stringify(expected)}\n  got:  ${JSON.stringify(got)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

// Whatever goes in, no long dash comes out.
const noisy = "הוק — עם דאש\n— בולט\nטקסט – עוד ― ועוד ‒ ועוד ⸻\n⸺\nסוף —"
if (/[‒–—―⸺⸻]/.test(stripDashes(noisy))) {
  failed++
  console.error(`FAIL no long dash survives: ${JSON.stringify(stripDashes(noisy))}`)
} else console.log("ok   no long dash survives")

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log("\nall passed")
