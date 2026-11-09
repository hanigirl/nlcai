// npx tsx --tsconfig tsconfig.json src/lib/own-media-broll.test.mts
import assert from "node:assert/strict"
import { holdBRollToScript } from "./own-media-plan"
import { NO_SCRIPT_TEXT, scriptTextFor } from "./script-text"
import type { OwnFrameInfo } from "./own-media.ts"

const script = "סטורי 1\nשלוש טעויות שעולות לכם בלקוחות\nואיך מתקנים אותן בלי הוצאות נוספות"
const unit = scriptTextFor("b_roll", script)
assert.deepEqual(unit, { headline: "שלוש טעויות שעולות לכם בלקוחות", body: "ואיך מתקנים אותן בלי הוצאות" + " נוספות" })

const bare: OwnFrameInfo = { url: "https://x/storage/v1/object/public/user-media/u/video/a.mp4", kind: "video", aiMade: false, caption: "unknown" }
const stale: OwnFrameInfo = {
  url: "https://x/storage/v1/object/public/user-media/u/video/burned-a.mp4",
  kind: "video",
  aiMade: false,
  caption: "ours",
  record: { v: 1, sourceUrl: "https://x/a.mp4", caption: { headline: "שלוש טעויות שעולות לכם בלקוחות", body: "ואיך מתקנים אותן בלי הוצאות" } },
}

// Just imported, the planner did nothing (the live bug) → the script's text goes on it.
let p = holdBRollToScript({ reply: "הפורמט הזה הוא קליפ אחד בלבד, אז אי אפשר להוסיף בו תמונה נוספת", ops: [] }, [bare], unit, true)
assert.equal(p.ops.length, 1)
assert.deepEqual(p.ops[0], { op: "set_caption", frames: [1], headline: unit!.headline, body: unit!.body })
assert.ok(!p.reply.includes("אי אפשר"))

// No model ran (no Claude key) → same.
p = holdBRollToScript({ reply: "", ops: [] }, [bare], unit, true)
assert.equal(p.ops.length, 1)

// No script text → nothing invented, she's told.
p = holdBRollToScript({ reply: "", ops: [] }, [bare], null, true)
assert.equal(p.ops.length, 0)
assert.equal(p.reply, NO_SCRIPT_TEXT)

// A refusal stays a refusal; a picture with its own words isn't captioned.
assert.equal(holdBRollToScript({ reply: "לא", ops: [], refused: true }, [bare], unit, true).ops.length, 0)
assert.equal(holdBRollToScript({ reply: "", ops: [] }, [{ ...bare, kind: "image", caption: "baked" }], unit, true).ops.length, 0)

// Not just imported and nothing planned → nothing added.
assert.equal(holdBRollToScript({ reply: "?", ops: [] }, [bare], unit, false).ops.length, 0)

// Look-only edit on a render with the OLD words → the current script, and she's told.
p = holdBRollToScript({ reply: "הזזתי למעלה.", ops: [{ op: "set_caption", frames: [1], position: "top" }] }, [stale], unit, false)
assert.deepEqual(p.ops[0], { op: "set_caption", frames: [1], position: "top", headline: unit!.headline, body: unit!.body })
assert.ok(p.reply.startsWith("הזזתי למעלה."))
assert.ok(p.reply.includes("הסקריפט השתנה"))

// Same words as the script → no note.
p = holdBRollToScript(
  { reply: "הזזתי.", ops: [{ op: "set_caption", frames: [1], position: "top" }] },
  [{ ...stale, record: { ...stale.record!, caption: { ...unit! } } }],
  unit,
  false,
)
assert.equal(p.reply, "הזזתי.")

// Her own dictated words stay hers on a look-only edit.
p = holdBRollToScript(
  { reply: "", ops: [{ op: "set_caption", frames: [1], position: "top" }] },
  [{ ...stale, record: { ...stale.record!, textSource: "dictated" } }],
  unit,
  false,
)
assert.equal((p.ops[0] as { headline?: string }).headline, undefined)

console.log("own-media-broll: all passed")
