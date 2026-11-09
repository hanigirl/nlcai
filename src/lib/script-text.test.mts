// npx tsx --tsconfig tsconfig.json src/lib/script-text.test.mts
import { scriptTextFor, scriptTextUnits } from "./script-text"
import { captionLookFromBrand } from "./caption-look"

let failed = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`}`)
}

// Carousel: a slide with two paragraphs stays ONE slide (the old split made it two).
const carousel = `שקופית 1
המוצר לא פגש משתמשים? עדיין יש לכם KPIs.

שקופית 2
הרבה מעצבים אומרים לי: "אין לי מה להראות."

אני מבינה את זה.

שקופית 3
איך? תמצאו חמישה אנשים.`
const cu = scriptTextUnits("carousel", carousel)
eq("carousel: slide count follows the headers", cu.length, 3)
eq("carousel: slide 1 title", cu[0]?.headline, "המוצר לא פגש משתמשים? עדיין יש לכם KPIs.")
eq("carousel: slide 3 is slide 3", (cu[2]?.headline ?? "") + (cu[2]?.body ?? ""), "איך? תמצאו חמישה אנשים.")
eq("carousel: beyond the script = null (no hook fallback)", scriptTextFor("carousel", carousel, 5), null)
eq("carousel: no header text leaks", cu.some((u) => /שקופית\s*\d/.test(`${u.headline}${u.body}`)), false)

// Image post: labelled lines.
const image = `[כותרת]
כשקלוד נהיה מטומטם, יש לי 3 בדיקות

[טקסט תחתון]
קראו בתיאור`
eq("image post", scriptTextFor("image_post", image), { headline: "כשקלוד נהיה מטומטם, יש לי 3 בדיקות", body: "קראו בתיאור" })

// B-roll: first line + reading caption.
eq("b-roll", scriptTextFor("b_roll", "התחלתי לעבוד עם וריאבלס — וקיבלתי בחזרה כמה שעות נוספות ביום\n\nתראו בתיאור"), {
  headline: "התחלתי לעבוד עם וריאבלס — וקיבלתי בחזרה כמה שעות נוספות ביום",
  body: "תראו בתיאור",
})

// Story: marked frames, marks never on the media.
const story = `פריים 1:
היא הייתה הכי AI-first בחברה.

המשך בסטורי הבא.

פריים 2:
זה שהם התקדמו היה בעוכריהם.`
const su = scriptTextUnits("story", story)
eq("story: one unit per marked story", su.length, 2)
eq("story: frame 1 headline", su[0]?.headline, "היא הייתה הכי AI-first בחברה.")
eq("story: no marks", su.some((u) => /פריים\s*\d/.test(`${u.headline}${u.body}`)), false)

// Empty script: nothing, never the hook.
eq("empty script", scriptTextFor("story", "", 0), null)

// Caption look: a new user / unreadable brand pair → white on black; a readable pair → hers.
eq("look: no brand", captionLookFromBrand(null), { pill: "#000000", text: "#ffffff" })
eq("look: unreadable pair falls back", captionLookFromBrand({ text_color: "#ffffff", accent_color: "#ffff00" }), { pill: "#000000", text: "#ffffff" })
eq("look: her readable pair", captionLookFromBrand({ text_color: "#ffffff", accent_color: "#1f2a8c" }), { pill: "#1f2a8c", text: "#ffffff" })

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log("\nall passed")
