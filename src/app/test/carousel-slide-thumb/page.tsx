"use client"

/**
 * State preview for "הקרוסלה שלך" in the carousel media panel (bug,
 * 2026-11-05: the first slide showed as a broken image).
 *
 * Route: /test/carousel-slide-thumb?state=saved|fresh|before
 *   saved  — a saved carousel, slides as storage URLs (how the post loads
 *            them, and how the AI edit panel hands them back). This was broken.
 *   fresh  — a carousel just generated in the panel, slides as base64.
 *   before — the old render, for comparison: a URL forced into a data: prefix.
 * No param = all three side by side.
 *
 * Renders the REAL tiles exported from the panel inside its 400px frame.
 * Sample slides are the static template thumbnails in /public — no API call,
 * no DB read or write.
 */

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { YourCarouselBand, YourCarouselTile } from "@/components/media-panel"

const STATES = ["saved", "fresh", "before"] as const
type State = (typeof STATES)[number]

const STATE_LABEL: Record<State, string> = {
  saved: "קרוסלה שמורה (קישורים מהאחסון) — אחרי התיקון",
  fresh: "קרוסלה שנוצרה עכשיו (base64)",
  before: "לפני התיקון — קישור שנעטף כ-base64",
}

const SAMPLE_PATHS = [
  "/images/carousel-templates/default.png",
  "/images/carousel-templates/ai-light.png",
  "/images/carousel-templates/ai-dark.png",
  "/images/carousel-templates/ai-amber.png",
  "/images/carousel-templates/ai-minimal.png",
  "/images/carousel-templates/ai-ice.png",
]

/** Raw base64 (no prefix) of a same-origin static file — a generation's shape. */
async function toBase64(path: string): Promise<string> {
  const blob = await (await fetch(path)).blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function Frame({ state, urls, b64s }: { state: State; urls: string[]; b64s: string[] | null }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-small-bold text-text-primary-default">{STATE_LABEL[state]}</h2>
      <div
        dir="rtl"
        className="flex w-[400px] flex-col gap-4 overflow-hidden rounded-xl border border-border-neutral-default bg-white px-6 pt-6 pb-6 dark:bg-gray-10"
      >
        {state === "before" ? (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${urls[0]}`}
              alt="השקופית הראשונה של הקרוסלה שלך"
              className="w-[200px] rounded-[10px] border border-border-neutral-default"
            />
            <p className="text-xs text-text-neutral-default">כך זה נראה באתר החי</p>
          </div>
        ) : state === "fresh" && !b64s ? (
          <p className="text-xs text-text-neutral-default">טוען דוגמה...</p>
        ) : (
          <>
            <YourCarouselTile images={state === "saved" ? urls : b64s!} onOpen={() => {}} />
            <YourCarouselBand images={state === "saved" ? urls : b64s!} onOpen={() => {}} />
          </>
        )}
      </div>
    </section>
  )
}

function Inner() {
  const params = useSearchParams()
  const raw = params.get("state")
  const only = raw && (STATES as readonly string[]).includes(raw) ? (raw as State) : null
  const [urls, setUrls] = useState<string[]>([])
  const [b64s, setB64s] = useState<string[] | null>(null)

  useEffect(() => {
    // Absolute, like a real storage URL (https://…/user-media/…/carousel/x.png).
    setUrls(SAMPLE_PATHS.map((p) => new URL(p, window.location.origin).href))
    Promise.all(SAMPLE_PATHS.map(toBase64)).then(setB64s).catch(() => setB64s([]))
  }, [])

  if (urls.length === 0) return null
  const shown = only ? [only] : STATES

  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <h1 className="mb-6 text-p-bold text-text-primary-default">הקרוסלה שלך — תצוגת השקופית הראשונה</h1>
      <div className="flex flex-wrap items-start gap-6">
        {shown.map((s) => (
          <Frame key={s} state={s} urls={urls} b64s={b64s} />
        ))}
      </div>
    </main>
  )
}

export default function CarouselSlideThumbPreview() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
