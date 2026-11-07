/**
 * Caption-line splitting (lib/transcribe). Run: npx tsx --test src/lib/transcribe.test.ts
 * No network, no keys — words are given with their times as Whisper returns them.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { captionLines, parseWhisper, type Word } from "./transcribe"

/** Words spoken back to back (0.3s each), with an optional pause after some. */
function speak(text: string, pausesAfter: Record<number, number> = {}): Word[] {
  let t = 0
  return text.split(" ").map((w, i) => {
    const word = { text: w, start: t, end: t + 0.3 }
    t += 0.3 + (pausesAfter[i] ?? 0.05)
    return word
  })
}

test("lines are 2–5 words", () => {
  const lines = captionLines(speak("אני רוצה לספר לכם על שלושה דברים שאני בודקת כל פעם שקלוד מתבלבל לי באמצע העבודה"))
  for (const l of lines) {
    const n = l.words.length
    assert.ok(n >= 2 && n <= 5, `"${l.text}" has ${n} words`)
  }
})

test("a pause in her speech ends the line", () => {
  // Pause after word 2 ("לכם").
  const lines = captionLines(speak("אני רוצה לכם להראות משהו חשוב מאוד", { 2: 0.6 }))
  assert.equal(lines[0].text, "אני רוצה לכם")
})

test("a sentence end ends the line, even short", () => {
  const lines = captionLines(speak("זה עובד. ועכשיו הדבר השני שאני בודקת"))
  assert.equal(lines[0].text, "זה עובד.")
})

test("a comma is a natural break once the line has 2 words", () => {
  const lines = captionLines(speak("קודם כל, חלון הקונטקסט מעל שבעים אחוז"))
  assert.equal(lines[0].text, "קודם כל,")
})

test("a lone last word joins the line before it", () => {
  const lines = captionLines(speak("אחד שתיים שלוש ארבע חמש שש"))
  assert.equal(lines.at(-1)!.words.length >= 2, true)
  assert.equal(lines.map((l) => l.text).join(" "), "אחד שתיים שלוש ארבע חמש שש")
})

test("no word is lost or reordered, and times follow the words", () => {
  const words = speak("ומי שרוצה להיות מאסטר בקלוד קוד מוזמן להגיב בוסט ואשלח לו את המדריך", { 4: 0.5, 8: 0.5 })
  const lines = captionLines(words)
  assert.deepEqual(lines.flatMap((l) => l.words), words)
  for (const l of lines) {
    assert.equal(l.start, l.words[0].start)
    assert.equal(l.end, l.words.at(-1)!.end)
  }
})

test("long words fill a line sooner (character cap)", () => {
  const lines = captionLines(speak("אינטרדיסציפלינריות התפתחותיות ומתודולוגיות אפיסטמולוגיות משמעותיות במיוחד"))
  for (const l of lines) assert.ok(l.text.length <= 34, `"${l.text}" is ${l.text.length} chars`)
})

test("Whisper verbose_json → words with times", () => {
  const t = parseWhisper({
    text: "שלום לכם.",
    duration: 1.2,
    words: [
      { word: " שלום", start: 0.1, end: 0.5 },
      { word: "לכם.", start: 0.55, end: 1.0 },
      { word: "", start: 1, end: 1 },
    ],
  })
  assert.deepEqual(t.words.map((w) => w.text), ["שלום", "לכם."])
  assert.equal(t.duration, 1.2)
})

import { alignToScript, applySpellingFixes, snapWordsToVoice, voiceOnsets } from "./transcribe"

test("script spelling: a misheard word between two exact matches takes the script's spelling", () => {
  const words = speak("תיק העבודות שלח נקרא כמו דוח")
  const fixed = alignToScript(words, "תיק העבודות שלך נקרא כמו דוח, ככה תתקנו את זה.")
  assert.equal(fixed.map((w) => w.text).join(" "), "תיק העבודות שלך נקרא כמו דוח")
  assert.deepEqual(fixed.map((w) => [w.start, w.end]), words.map((w) => [w.start, w.end]))
})

test("script spelling: words she said differently from the script are left alone", () => {
  // Real transcript of post 22fd782d's clip — she talks about a conference, not the script.
  const said = "והאמת שאני הולכת להראות הרבה מהתהליך הזה בכנס דיזיין היה יקרות דיזיין היה ישמונה, ואז הזל, בבימא הולך להיות מטורף, תבואו להגיד שלום אני הולכת לדבר ממש על זה"
  const script = "תיק העבודות שלך נקרא כמו דוח? זו בדיוק הבעיה. תיק העבודות שלך נקרא כמו דו\"ח , ככה תתקנו את זה. הבעיה עם הרבה תיקי עבודות היא שאתם רוצים להראות את הפיצ'רים שעשיתם."
  const words = speak(said)
  assert.deepEqual(alignToScript(words, script), words)
})

test("script spelling: no context, no change (הולכת stays even if the script says הולך)", () => {
  const words = speak("אני הולכת הביתה")
  assert.deepEqual(alignToScript(words, "מחר הוא הולך לעבודה"), words)
})

test("Opus fixes are applied safely: only listed words, only spelling", () => {
  const words = speak("בכנס דיזיין היה יקרות")
  const out = applySpellingFixes(words, [
    { i: 1, text: "Design" },
    { i: 9, text: "x" }, // out of range
    { i: 2, text: "one two three four" }, // not one word
    { i: 3, text: "" },
  ])
  assert.deepEqual(out.map((w) => w.text), ["בכנס", "Design", "היה", "יקרות"])
  assert.deepEqual(out.map((w) => w.start), words.map((w) => w.start))
})

test("voice onsets: speech after a silence, relative to the clip's noise floor", () => {
  // 20ms frames: 0.4s quiet, 1s speech, 0.6s quiet, 1s speech, a 0.1s dip inside it.
  const levels = [
    ...new Array(20).fill(-45),
    ...new Array(50).fill(-22),
    ...new Array(30).fill(-42),
    ...new Array(20).fill(-21),
    ...new Array(5).fill(-40),
    ...new Array(25).fill(-23),
  ]
  assert.deepEqual(voiceOnsets(levels).map((o) => Number(o.toFixed(2))), [0.4, 2])
})

test("a word stamped in the silence starts when her voice returns; others don't move", () => {
  const words: Word[] = [
    { text: "והאמת", start: 0, end: 0.86 },
    { text: "יקרות", start: 3.54, end: 4.08 },
    { text: "דיזיין", start: 4.84, end: 5.4 },
  ]
  const snapped = snapWordsToVoice(words, [0.46, 5.2])
  assert.deepEqual(snapped.map((w) => w.start), [0.46, 3.54, 5.2])
  assert.deepEqual(snapped.map((w) => w.end), [0.86, 4.08, 5.4])
})
