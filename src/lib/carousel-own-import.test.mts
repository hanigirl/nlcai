// npx tsx --tsconfig tsconfig.json src/lib/carousel-own-import.test.mts
// The client side of her own carousel + the script's text, against a stubbed
// fetch: nothing reaches the network.
import {
  baresFromRecords,
  captionCarouselSlide,
  captionOwnSlides,
  isCarouselAlreadySaved,
  markCarouselSaved,
  ownCaptionNote,
  saveOwnCarousel,
} from "./carousel-caption"

let failed = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`}`)
}

const S = "https://x.supabase.co/storage/v1/object/public/user-media/u1"
const calls: { url: string; body: Record<string, unknown> }[] = []
const reply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
  calls.push({ url, body })
  if (url === "/api/media/caption-image") {
    const i = body.slideIndex as number
    if (i === 2) return reply(200, { skipped: "no_script_text", message: "x" })
    if (i === 3) return reply(500, { error: "boom" })
    return reply(200, { url: `${S}/image/captioned-${i}.png`, originalUrl: body.sourceUrl })
  }
  if (url.endsWith("captioned-0.png.json")) return reply(200, { v: 1, sourceUrl: `${S}/slots/a.jpg`, caption: {} })
  if (url.endsWith(".json")) return reply(404, {})
  if (url.startsWith("/api/core-posts/")) return reply(200, { ok: true })
  return reply(404, {})
}) as typeof fetch

const bares = [`${S}/slots/a.jpg`, `${S}/slots/b.jpg`, `${S}/slots/c.jpg`, `${S}/slots/d.jpg`, `${S}/carousel/video-1.mp4`]
const out = await captionOwnSlides("p1", bares, [0, 1, 2, 3, 4], "bottom")
eq("captioned slides are stored renders; past-script + failed stay bare; video untouched", out.slides, [
  `${S}/image/captioned-0.png`,
  `${S}/image/captioned-1.png`,
  `${S}/slots/c.jpg`,
  `${S}/slots/d.jpg`,
  `${S}/carousel/video-1.mp4`,
])
eq("no_script / failed reported", [out.noScript, out.failed], [[2], [3]])
const sent = calls.find((c) => c.url === "/api/media/caption-image")!.body
eq("rendered from the URL, stored (record), no inline bytes", [sent.sourceUrl, sent.store, sent.imageBase64], [`${S}/slots/a.jpg`, true, undefined])
eq("note says what didn't happen", ownCaptionNote(out), "לשקופית 3 אין טקסט בסקריפט, אז לא שמתי עליה טקסט. הטקסט לא נכנס על שקופית 4, היא נשארה כמו שהעליתם. אפשר לנסות שוב מהכרטיס.")

eq("a URL bare redraws through the stored path", await captionCarouselSlide("p1", `${S}/slots/b.jpg`, 1, "top"), `${S}/image/captioned-1.png`)

eq(
  "originals after a reload come from the caption records",
  await baresFromRecords([`${S}/image/captioned-0.png`, `${S}/slots/b.jpg`, `${S}/carousel/video-1.mp4`]),
  [`${S}/slots/a.jpg`, `${S}/slots/b.jpg`, `${S}/carousel/video-1.mp4`],
)
eq("a render without a record → null (fall back to Drive)", await baresFromRecords([`${S}/image/captioned-9.png`]), null)

calls.length = 0
eq("save waits and succeeds", await saveOwnCarousel("p1", ["u1", "u2"], ["", ""], false), true)
const patch = calls[0].body
eq("no Drive slide → links cleared, never stale", patch.carouselDriveLinks, [])
eq("stamped as hers", patch.carouselMeta, { source: "import", bakedText: false })
eq("page autosave skips the set the panel saved", isCarouselAlreadySaved("p1", ["u1", "u2"]), true)
markCarouselSaved("p1", ["u3"])
eq("…and saves the next one", isCarouselAlreadySaved("p1", ["u1", "u2"]), false)

console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
