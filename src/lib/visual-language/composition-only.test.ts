/**
 * Colour / font words stripped from an example-derived description.
 * Run: npx tsx --test src/lib/visual-language/composition-only.test.ts
 */
import test from "node:test"
import assert from "node:assert/strict"
import { stripLookWords } from "./composition-only"

const SPEC =
  "Full-bleed, authentic lifestyle photograph filling the entire frame: a woman in a candid, quiet moment (cafe terrace, car window, cozy living room) in soft natural light, with muted warm-neutral tones of beige, oatmeal knitwear, heather grey and stone, and a slightly filmic, low-contrast grade. Apply a gentle even dark overlay (about 25-35%) so white text reads clearly. Palette: #a3263f deep burgundy is the call-to-action accent, used as a rounded pill behind the key action word. #0d2622 deep forest-black fills rounded headline boxes. Typography: clean modern Hebrew sans-serif. Headlines are bold to heavy and compact; body text is regular weight, airy, with generous line spacing and short broken lines. Composition: everything centred in one vertical text column in the middle band of the frame, with wide side margins."

test("no hex code, colour name or font word survives", () => {
  const out = stripLookWords(SPEC, { colours: true, fonts: true })
  assert.doesNotMatch(out, /#[0-9a-f]{3,8}/i)
  assert.doesNotMatch(out, /burgundy|forest|beige|grey|palette|sans-serif|typography/i)
})

test("composition survives", () => {
  const out = stripLookWords(SPEC, { colours: true, fonts: true })
  for (const kept of ["Full-bleed", "lifestyle photograph filling the entire frame", "rounded pill", "centred in one vertical text column", "short broken lines", "wide side margins"]) {
    assert.match(out, new RegExp(kept))
  }
})

test("without brand colours, the colours stay", () => {
  const out = stripLookWords(SPEC, { colours: false, fonts: true })
  assert.match(out, /#a3263f/)
  assert.doesNotMatch(out, /sans-serif/)
})

test("nothing to strip → unchanged", () => {
  assert.equal(stripLookWords("Centred column.", { colours: false, fonts: false }), "Centred column.")
})
