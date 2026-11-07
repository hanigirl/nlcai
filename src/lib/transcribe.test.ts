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
