// npx tsx --tsconfig tsconfig.json src/lib/still-original.test.mts
import assert from "node:assert/strict"
import { isCaptionedRender, stillOriginalOf } from "./still-original.ts"
import { scriptTextFor } from "./script-text.ts"
import { parseImagePostBody } from "./image-post-text.ts"

const BASE = "https://x.supabase.co/storage/v1/object/public/user-media/u1/image"
let failed = 0
const t = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn()
    console.log("ok  ", name)
  } catch (e) {
    failed++
    console.log("FAIL", name, e instanceof Error ? e.message : e)
  }
}

await t("a caption-route render is recognised", () => {
  assert.equal(isCaptionedRender(`${BASE}/captioned-1b2c.png`), true)
  assert.equal(isCaptionedRender(`${BASE}/captioned-1b2c.png?v=2`), true)
})
await t("her own upload / an AI image is not", () => {
  assert.equal(isCaptionedRender(`${BASE}/9f8e.jpg`), false)
  assert.equal(isCaptionedRender("https://drive.google.com/file/d/abc/view"), false)
  assert.equal(isCaptionedRender(null), false)
})
await t("original of a bare picture is the picture", async () => {
  assert.equal(await stillOriginalOf(`${BASE}/9f8e.jpg`), `${BASE}/9f8e.jpg`)
})
await t("original of a render comes from its record", async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async (u: string) => {
    assert.equal(u, `${BASE}/captioned-aa.png.json`)
    return new Response(JSON.stringify({ v: 1, sourceUrl: `${BASE}/her.jpg`, caption: { headline: "h" } }))
  }) as typeof fetch
  try {
    assert.equal(await stillOriginalOf(`${BASE}/captioned-aa.png?x=1`), `${BASE}/her.jpg`)
  } finally {
    globalThis.fetch = orig
  }
})
await t("a render with no record has no original (never the render itself)", async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch
  try {
    assert.equal(await stillOriginalOf(`${BASE}/captioned-bb.png`), null)
  } finally {
    globalThis.fetch = orig
  }
})
await t("image post: the caption route and the AI generator read the same words", () => {
  const body = "[כותרת]\nשלוש טעויות\n\n[תת-כותרת]\nשכולן עושות\n\n[טקסט תחתון]\nשמרו לאחר כך"
  const unit = scriptTextFor("image_post", body)
  const gen = parseImagePostBody(body)!
  assert.equal(unit?.headline, gen.headline)
  assert.equal(unit?.body, [gen.subheadline, gen.bottom].join("\n"))
})
await t("image post with no script text → null (never the hook)", () => {
  assert.equal(scriptTextFor("image_post", "   "), null)
  assert.equal(scriptTextFor("image_post", null), null)
})

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log("\nall passed")
