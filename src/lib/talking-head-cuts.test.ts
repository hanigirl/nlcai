/**
 * Cut planning for talking-head videos (lib/talking-head-cuts).
 * Run: npx tsx --test src/lib/talking-head-cuts.test.ts — no network, no keys.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { cutMessage, isFiller, planCuts, remapTime, remapWords, wordsToDrop } from "./talking-head-cuts"
import type { Word } from "./transcribe"

const w = (text: string, start: number, end: number): Word => ({ text, start, end })

test("Hebrew fillers are fillers, real words aren't", () => {
  for (const f of ["אממ", "אמממ", "אה", "אהה", "הממ", "אמ,"]) assert.ok(isFiller(f), f)
  for (const r of ["אמא", "אהבה", "מה", "הלקוח"]) assert.ok(!isFiller(r), r)
})

test("a repeated word or pair drops its first take", () => {
  const words = [w("הלקוח", 0, 0.4), w("הלקוח", 0.5, 0.9), w("לא", 1, 1.2), w("קונה", 1.3, 1.6), w("לא", 1.7, 1.9), w("קונה", 2, 2.3)]
  assert.deepEqual([...wordsToDrop(words)].sort(), [0, 2, 3])
})

test("a tight video is left alone", () => {
  const words = [w("הלקוח", 0.05, 0.4), w("לא", 0.5, 0.7), w("קונה", 0.8, 1.1), w("שעות", 1.2, 1.6)]
  assert.equal(planCuts(words, null, 1.8), null)
  assert.equal(cutMessage(null), "הקאטים כבר טובים, לא נגענו.")
})

test("fillers and long silences are cut, with breath kept", () => {
  const words = [
    w("הלקוח", 0, 0.4),
    w("אממ", 0.6, 1.1),
    w("לא", 1.3, 1.5),
    w("קונה", 1.6, 1.9),
    w("אה", 2.0, 2.3),
    w("שעות", 4.5, 4.9), // 2.2s of silence before
  ]
  const plan = planCuts(words, null, 5.5)
  assert.ok(plan)
  assert.equal(plan!.stats.fillers, 2)
  assert.ok(plan!.stats.after < 3.2, `after ${plan!.stats.after}`)
  // Every kept word is still inside a segment.
  for (const word of [words[0], words[2], words[3], words[5]]) {
    assert.ok(plan!.segments.some((s) => s.start <= word.start && word.end <= s.end), word.text)
  }
  // Breath: a cut never touches a kept word.
  assert.ok(plan!.segments[0].end >= 0.4 + 0.1)
  // Captions follow the cut.
  const moved = remapWords(words, plan!.segments)
  assert.equal(moved.length, 4)
  assert.ok(moved.every((x, i) => i === 0 || x.start >= moved[i - 1].end - 1e-6))
  assert.ok(Math.abs(moved[3].end - remapTime(4.9, plan!.segments)) < 1e-9)
  assert.match(cutMessage(plan!.stats), /^הורדנו 2 ״אממ״ ו-\d+ שניות של שקט, הסרטון עכשיו \d+ שניות במקום 6\.$/)
})

test("an untranscribed voiced gap counts as a filler", () => {
  const words = [w("הלקוח", 0, 0.4), w("לא", 1.0, 1.2), w("קונה", 1.3, 1.6), w("שעות", 2.3, 2.6), w("נכון", 2.7, 3.0)]
  // 20ms levels: quiet floor -60dB, speech -20dB; voice in the 0.4–1.0 and 1.6–2.3 gaps.
  const levels = Array.from({ length: 160 }, (_, i) => {
    const t = i * 0.02
    const inWord = words.some((x) => t >= x.start && t < x.end)
    const inGap = (t > 0.45 && t < 0.95) || (t > 1.65 && t < 2.25)
    return inWord || inGap ? -20 : -60
  })
  const plan = planCuts(words, levels, 3.2)
  assert.ok(plan)
  assert.equal(plan!.stats.fillers, 2)
})
