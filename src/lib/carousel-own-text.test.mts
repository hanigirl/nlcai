// npx tsx --tsconfig tsconfig.json src/lib/carousel-own-text.test.mts
import { scriptTextFor } from "./script-text"
import { isOwnCarousel, isOwnCarouselSlideUrl } from "./carousel-own"
import { holdVideoWordsToScript, scriptWords } from "./carousel-video-caption"

let failed = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`}`)
}

const S = "https://x.supabase.co/storage/v1/object/public/user-media/u1"
const body = `שקופית 1
כותרת הפתיחה
גוף ראשון

שקופית 2
רק פסקה אחת בלי כותרת?

שקופית 3
כותרת שלוש`

// A slide past the script: no text at all (never the hook).
eq("slide past the script → null", scriptTextFor("carousel", body, 5), null)
eq("cover", scriptTextFor("carousel", body, 0)?.headline, "כותרת הפתיחה")

// Classification: her pictures from the computer / chat have no links.
eq("slot picture is hers", isOwnCarouselSlideUrl(`${S}/slots/a.jpg`), true)
eq("our caption render over hers is hers", isOwnCarouselSlideUrl(`${S}/image/captioned-1.png`), true)
eq("bytes-saved set is not decided by URL", isOwnCarouselSlideUrl(`${S}/carousel/1b2c.png`), false)
eq("ai slide is not hers", isOwnCarouselSlideUrl(`${S}/carousel/ai-slide-1234abcd.png`), false)
eq("computer upload, no links → hers", isOwnCarousel([`${S}/slots/a.jpg`, `${S}/image/captioned-2.png`], []), true)
eq("her set + one AI slide → still hers", isOwnCarousel([`${S}/slots/a.jpg`, `${S}/carousel/ai-slide-1234abcd.png`], null), true)
eq("AI carousel → not hers", isOwnCarousel([`${S}/carousel/a1.png`, `${S}/carousel/a2.png`], null), false)
eq("AI carousel + one slot picture → not hers (AI edit path)", isOwnCarousel([`${S}/carousel/a1.png`, `${S}/slots/b.jpg`], null), false)
eq("older Drive import, aligned links → hers", isOwnCarousel([`${S}/carousel/a1.png`], ["https://drive.google.com/file/d/x/view"]), true)

// Video slide words: the script's, verbatim, unless she dictated them.
const script = scriptWords({ headline: "כותרת הפתיחה", body: "גוף ראשון" })
eq(
  "model rewrite → back to the script, her look kept",
  holdVideoWordsToScript({ headline: "פתיחה!", design: "צהוב" }, script, "תעשה את זה קצר וצהוב"),
  { headline: "כותרת הפתיחה", body: "גוף ראשון", design: "צהוב" },
)
eq(
  "dictated words kept",
  holdVideoWordsToScript({ headline: "הנה זה" }, script, "תכתוב על הסרטון: הנה זה"),
  { headline: "הנה זה", design: "תכתוב על הסרטון: הנה זה" },
)
eq("body-only slide → its body is the headline", scriptWords({ body: "רק פסקה" }), { headline: "רק פסקה" })

console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
