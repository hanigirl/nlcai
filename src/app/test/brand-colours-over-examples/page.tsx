/**
 * What the media generators are told about colour when she has usage
 * examples — with brand colours and without. Pure: sample data, the real
 * prompt helpers, no fetches, no DB, no model calls.
 *
 * Route: /test/brand-colours-over-examples?state=with-brand|no-brand
 * (no param = both side by side).
 */

import { stripLookWords } from "@/lib/visual-language/composition-only"
import { brandColourLines, brandPalette } from "@/lib/visual-language/direction"

const SAMPLE_SPEC =
  "Full-bleed, authentic lifestyle photograph filling the entire frame: a woman in a candid, quiet moment in soft natural light, with muted warm-neutral tones of beige, heather grey and stone. Apply a gentle even dark overlay so white text reads clearly. Palette: #a3263f deep burgundy is the call-to-action accent, used as a rounded pill behind the key action word. #0d2622 deep forest-black fills rounded headline boxes. Typography: clean modern Hebrew sans-serif. Headlines are bold to heavy and compact; body text is regular weight with short broken lines. Composition: everything centred in one vertical text column in the middle band of the frame."

const SAMPLE_ANALYSED = [
  { hex: "#a3263f", role: "CTA accent pill / highlight" },
  { hex: "#f1efe9", role: "light box fill and body text tint" },
  { hex: "#eae1f5", role: "optional soft secondary light box" },
  { hex: "#0d2622", role: "dark headline box fill" },
]

const STATES = {
  "with-brand": { title: "יש צבעי מותג", colors: ["#a3263f", "#eae1f5", "#f1efe9"] as string[] },
  "no-brand": { title: "אין צבעי מותג", colors: [] as string[] },
} as const

type StateId = keyof typeof STATES

function StateCard({ id }: { id: StateId }) {
  const s = STATES[id]
  const hasBrand = s.colors.length > 0
  const palette = brandPalette(s.colors, SAMPLE_ANALYSED)
  const description = stripLookWords(SAMPLE_SPEC, { colours: hasBrand, fonts: true })
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border-neutral-default p-5">
      <h2 className="text-lg font-semibold text-text-primary-default">{s.title}</h2>
      <p className="text-sm text-text-neutral-default">
        {hasBrand
          ? "הדוגמאות נשלחות בשחור-לבן וקובעות רק קומפוזיציה. הצבעים מצבעי המותג."
          : "אין צבעי מותג, לכן הצבעים של הדוגמאות נשארים."}
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-primary-default">הפלטה שנשלחת למעצב</h3>
        <ul className="flex flex-wrap gap-2">
          {palette.map((p) => (
            <li key={p.hex} className="flex items-center gap-2 rounded-lg border border-border-neutral-default px-2 py-1 text-xs">
              {/* Her own colours as data, not UI colour. */}
              <span className="size-4 rounded-full border border-border-neutral-default" style={{ backgroundColor: p.hex }} />
              <span dir="ltr">{p.hex}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-primary-default">התיאור שנשלח (אחרי ניקוי)</h3>
        <p dir="ltr" className="rounded-lg bg-bg-surface p-3 text-left text-xs leading-relaxed text-text-primary-default">
          {description}
        </p>
      </div>
      {hasBrand && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary-default">שורת הצבעים בפרומפט</h3>
          <p dir="ltr" className="rounded-lg bg-bg-surface p-3 text-left text-xs leading-relaxed text-text-primary-default">
            {brandColourLines(s.colors).join("\n")}
          </p>
        </div>
      )}
    </section>
  )
}

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams
  const ids = (state && state in STATES ? [state] : Object.keys(STATES)) as StateId[]
  return (
    <main dir="rtl" className="min-h-screen p-6">
      <h1 className="mb-4 text-xl font-semibold text-text-primary-default">צבעי מותג מול הדוגמאות</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {ids.map((id) => (
          <StateCard key={id} id={id} />
        ))}
      </div>
    </main>
  )
}
