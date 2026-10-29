// npx tsx src/lib/story-text-split.test.mts
import { desiredFrameCount, splitScriptIntoFrames, frameCaption } from "./story-text-split"

let failed = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`}`)
}

const marked = `פריים 1
אתם עדיין מחפשים כלי חדש כל שבוע?

פריים 2
הבעיה היא לא הכלים.

פריים 3
תבחרו כלי אחד.
תלמדו אותו לעומק.

פריים 4
שלחו את זה למישהו 👇`
eq("marked: count follows the script", desiredFrameCount(marked), 4)
eq("marked: frames follow the script, no marker text", splitScriptIntoFrames(marked, 4), [
  "אתם עדיין מחפשים כלי חדש כל שבוע?",
  "הבעיה היא לא הכלים.",
  "תבחרו כלי אחד.\nתלמדו אותו לעומק.",
  "שלחו את זה למישהו 👇",
])
eq("marked: frame caption has no 'פריים 1'", frameCaption(marked, 0, 4), { headline: "אתם עדיין מחפשים כלי חדש כל שבוע?" })

const bracketed = `[מסך 1]\nעצרו.\n[מסך 2]\nהעומק מנצח.\n[מסך 3]\nשלחו 👇`
eq("bracketed markers", splitScriptIntoFrames(bracketed, desiredFrameCount(bracketed)), ["עצרו.", "העומק מנצח.", "שלחו 👇"])

const inline = `פריים 1: הוק קצר\nפריים 2: גוף\nפריים 3: קריאה לפעולה`
eq("marker with text on the same line", splitScriptIntoFrames(inline, 3), ["הוק קצר", "גוף", "קריאה לפעולה"])

const paragraphs = `הוק\n\nפסקה ראשונה\n\nפסקה שנייה\n\nפסקה שלישית\n\nקריאה לפעולה`
eq("unmarked paragraphs: one frame each", desiredFrameCount(paragraphs), 5)
eq("unmarked paragraphs split", splitScriptIntoFrames(paragraphs, 5).length, 5)

const generated = `הוק\n\nתוכן\n\nCTA`
eq("generator's three blocks stay three", splitScriptIntoFrames(generated, desiredFrameCount(generated)), ["הוק", "תוכן", "CTA"])

eq("a sentence mentioning פריים isn't a marker", splitScriptIntoFrames("כל פריים חשוב\n\nסוף", 2), ["כל פריים חשוב", "סוף"])

if (failed) { console.log(`\n${failed} failed`); process.exit(1) } else console.log("\nall passed")
