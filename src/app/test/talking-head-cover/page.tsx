"use client"

/**
 * State preview for the talking-head cover's colour swatches.
 *
 * Route: /test/talking-head-cover — every state side by side, or one with
 * ?state=brand|no-brand|custom|generating. Each frame is the cover card's
 * preview + footer as on /project, painted with the same client composite
 * the live picker uses while dragging. No fetches, no DB writes: picking a
 * colour only "regenerates" on a local timer.
 */

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Download, Image as ImageIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CoverColorSwatches } from "@/components/cover-color-swatches"
import { COVER_FALLBACK_COLOR, defaultCoverColor } from "@/lib/cover-brand-color"

type State = "brand" | "no-brand" | "custom" | "generating"

const STATES: { id: State; title: string; description: string }[] = [
  { id: "brand", title: "צבע מותג (ברירת מחדל)", description: "קאבר חדש נפתח בצבע המותג הראשי שלה." },
  { id: "no-brand", title: "אין צבע מותג", description: "לא הוגדרו צבעי מותג: הרקע שחור, עם קישור להגדרה." },
  { id: "custom", title: "צבע שנבחר ידנית", description: "צבע מהגלגל שלא בפלטה מופיע כעיגול נבחר משלו." },
  { id: "generating", title: "בזמן יצירה מחדש", description: "אחרי בחירה, הקאבר נוצר מחדש והעיגולים נעולים." },
]

const SAMPLE_BRAND = ["#1F6F5C", "#F2B33D", "#E86A50"]
const SAMPLE_CUSTOM = "#3D5AFE"
const SAMPLE_TEXT = "3 טעויות שעולות ליועצים לקוחות"
const SAMPLE_FRAME = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 160"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9dccb"/><stop offset="1" stop-color="#c9b59c"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/><rect x="58" y="18" width="22" height="30" rx="2" fill="#b9a58a"/><circle cx="45" cy="74" r="15" fill="#8a6b55"/><path d="M14 160c2-34 14-52 31-52s29 18 31 52z" fill="#55606e"/></svg>`,
)}`

function isState(v: string | null): v is State {
  return STATES.some((s) => s.id === v)
}

function CoverCard({ state }: { state: State }) {
  const brandColors = state === "no-brand" ? [] : SAMPLE_BRAND
  const initial = state === "custom" ? SAMPLE_CUSTOM : brandColors.length ? defaultCoverColor(brandColors) : COVER_FALLBACK_COLOR
  const [pill, setPill] = useState(initial)
  const [draft, setDraft] = useState<string | null>(null)
  const [loading, setLoading] = useState(state === "generating")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const regenerate = () => {
    if (timer.current) clearTimeout(timer.current)
    setLoading(true)
    timer.current = setTimeout(() => { setLoading(false); setDraft(null) }, 1200)
  }

  return (
    <div dir="rtl" className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[310px]">
      <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
        <span className="text-p-bold text-text-primary-default">קאבר</span>
        <ImageIcon className="size-4 text-text-neutral-default" />
      </div>
      <div className="px-6 flex flex-col gap-4">
        <div className="flex gap-2">
          <input
            readOnly
            value={SAMPLE_TEXT}
            className="flex-1 rounded-lg border border-border-neutral-default bg-transparent px-3 py-2 text-sm text-text-primary-default outline-none"
          />
          <Button size="sm" disabled={loading} onClick={regenerate} className="shrink-0 gap-2">
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? "יוצר..." : "צור"}
          </Button>
        </div>
        <div className="flex justify-center">
          <div className="relative w-[200px] aspect-[9/16] rounded-xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SAMPLE_FRAME} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center px-[11px]">
              <span
                className="text-white text-center"
                style={{
                  backgroundColor: draft ?? pill,
                  padding: "4px 7px",
                  borderRadius: 4,
                  fontFamily: "Rubik, sans-serif",
                  fontWeight: 800,
                  fontSize: 13,
                  lineHeight: 1,
                  maxWidth: "100%",
                }}
              >
                {SAMPLE_TEXT}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3" dir="rtl">
          <CoverColorSwatches
            value={pill}
            brandColors={brandColors}
            onChange={(c) => { setPill(c); regenerate() }}
            onLivePreview={setDraft}
            userId={null}
            disabled={loading}
          />
          <Button variant="outline" aria-label="הורדת קאבר" className="w-11 px-0" disabled>
            <Download className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function Preview() {
  const params = useSearchParams()
  const only = params.get("state")
  const shown = isState(only) ? STATES.filter((s) => s.id === only) : STATES
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-8 flex flex-col gap-6">
      <h1 className="text-p-bold text-text-primary-default">דיבור למצלמה · צבע רקע הכותרת בקאבר</h1>
      <div className="flex flex-wrap gap-8">
        {shown.map((s) => (
          <div key={s.id} className="flex flex-col gap-2">
            <div>
              <p className="text-p-bold text-text-primary-default">{s.title}</p>
              <p className="text-xs text-text-neutral-default max-w-[310px]">{s.description}</p>
            </div>
            <CoverCard state={s.id} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TalkingHeadCoverTestPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
