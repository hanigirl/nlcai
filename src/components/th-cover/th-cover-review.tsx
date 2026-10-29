"use client"

import { useEffect, useRef, useState } from "react"
import { COVER_FALLBACK_COLOR, defaultCoverColor } from "@/lib/cover-brand-color"
import type { CoverColorVariant } from "./cover-color-control"

/**
 * Review harness for ?thcover=a|b — lands straight on the talking-head cover
 * card with a seeded cover. Nothing is generated, fetched or saved: the cover
 * is the same client composite the live picker already paints while dragging,
 * and a colour change "regenerates" on a local timer.
 *
 * States (also ?state=…): brand · no-brand · custom · generating.
 * `?state=live` is not handled here — it runs the real page with the brand
 * default switched on (see project/page.tsx).
 */

export type ThCoverState = "brand" | "no-brand" | "custom" | "generating"

export const TH_COVER_STATES: { id: ThCoverState; label: string }[] = [
  { id: "brand", label: "צבע מותג (ברירת מחדל)" },
  { id: "no-brand", label: "אין צבע מותג" },
  { id: "custom", label: "צבע שנבחר ידנית" },
  { id: "generating", label: "בזמן יצירה מחדש" },
]

export function isThCoverState(v: string | null): v is ThCoverState {
  return TH_COVER_STATES.some((s) => s.id === v)
}

/** A plausible solo-consultant palette: deep teal primary + two accents. */
export const SAMPLE_BRAND_COLORS = ["#1F6F5C", "#F2B33D", "#E86A50"]
const SAMPLE_CUSTOM = "#3D5AFE"

export const SAMPLE_COVER_TEXT = "3 טעויות שעולות ליועצים לקוחות"

/** A soft, warm "speaker at a desk" frame, drawn inline — no network. */
export const SAMPLE_FRAME = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 160"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9dccb"/><stop offset="1" stop-color="#c9b59c"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/><rect x="58" y="18" width="22" height="30" rx="2" fill="#b9a58a"/><circle cx="45" cy="74" r="15" fill="#8a6b55"/><path d="M14 160c2-34 14-52 31-52s29 18 31 52z" fill="#55606e"/></svg>`,
)}`

export interface ThCoverSeed {
  brandColors: string[]
  pillColor: string
  livePillColor: string
  coverLoading: boolean
  onPillColorChange: (c: string) => void
  onLivePillPreview: (c: string | null) => void
  coverText: string
  onCoverTextChange: (t: string) => void
  onCoverRegenerate: () => void
}

function seedFor(state: ThCoverState) {
  const brandColors = state === "no-brand" ? [] : SAMPLE_BRAND_COLORS
  const pillColor = state === "custom" ? SAMPLE_CUSTOM : brandColors.length ? defaultCoverColor(brandColors) : COVER_FALLBACK_COLOR
  return { brandColors, pillColor, coverLoading: state === "generating" }
}

export function ThCoverReview({
  variant,
  initialState,
  render,
  focusOn,
}: {
  variant: CoverColorVariant
  initialState: ThCoverState
  /** Glide the canvas onto the cover card on landing. */
  focusOn?: (el: HTMLElement) => void
  render: (seed: ThCoverSeed) => React.ReactNode
}) {
  const [state, setState] = useState<ThCoverState>(initialState)
  const init = seedFor(initialState)
  const [brandColors, setBrandColors] = useState(init.brandColors)
  const [pillColor, setPillColor] = useState(init.pillColor)
  const [draft, setDraft] = useState<string | null>(null)
  const [coverLoading, setCoverLoading] = useState(init.coverLoading)
  const [coverText, setCoverText] = useState(SAMPLE_COVER_TEXT)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Land ON the cover card — it sits below the format card, out of view.
  useEffect(() => {
    const t = setTimeout(() => {
      const card = document.querySelector("[data-thcover-control]")?.closest<HTMLElement>(".rounded-\\[20px\\]")
      if (card) focusOn?.(card)
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const jump = (next: ThCoverState) => {
    if (timer.current) clearTimeout(timer.current)
    const s = seedFor(next)
    setState(next)
    setBrandColors(s.brandColors)
    setPillColor(s.pillColor)
    setDraft(null)
    setCoverLoading(s.coverLoading)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set("state", next)
      window.history.replaceState(null, "", url.toString())
    } catch { /* review-only nicety */ }
  }

  // Stand-in for the ~1.5s cover regenerate: no route call.
  const fakeRegenerate = () => {
    if (timer.current) clearTimeout(timer.current)
    setCoverLoading(true)
    timer.current = setTimeout(() => {
      setCoverLoading(false)
      setDraft(null)
    }, 1200)
  }

  const seed: ThCoverSeed = {
    brandColors,
    pillColor,
    livePillColor: draft ?? pillColor,
    coverLoading,
    onPillColorChange: (c) => {
      setPillColor(c)
      fakeRegenerate()
    },
    onLivePillPreview: setDraft,
    coverText,
    onCoverTextChange: setCoverText,
    onCoverRegenerate: fakeRegenerate,
  }

  return (
    <>
      <div
        dir="rtl"
        className="fixed top-16 inset-x-0 z-40 mx-auto flex w-fit max-w-[calc(100%-32px)] flex-wrap items-center gap-1.5 rounded-full border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-1.5 shadow-sm"
      >
        <span className="text-xs font-semibold text-text-primary-default">
          תצוגת סקירה · אופציה {variant === "a" ? "A" : "B"}
        </span>
        <span className="h-4 w-px bg-border-neutral-default" aria-hidden />
        {TH_COVER_STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            aria-pressed={state === s.id}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
              state === s.id
                ? "bg-bg-surface-primary-default-80 font-semibold text-text-primary-default"
                : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {render(seed)}
    </>
  )
}
