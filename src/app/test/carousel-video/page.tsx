"use client"

/**
 * State preview for carousel VIDEO slides (Hani, 2026-11-06): a carousel that
 * mixes picture slides and clips.
 *
 * Route: /test/carousel-video?state=preview|panel|too-long
 *   preview  — the calendar preview (the real FormatMedia + SlideStrip):
 *              slide 3 is a video, it plays in place, the strip numbers it.
 *   panel    — "הקרוסלה שלך" in the carousel media panel (the real tile and
 *              band), with a video as the FIRST slide — the thumb is a frame
 *              of the clip, not a broken image.
 *   too-long — what she reads when a clip is longer than a carousel video
 *              slide can be, where she picked it (the real Drive entry).
 * No param = all three, one under the other.
 *
 * Sample slides are static files in /public (the video is a 4:5 slide made
 * by the same ffmpeg pad filter api/carousel/video-slide runs). No generation,
 * no DB write.
 */

import { Suspense, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import { FormatMedia, SlideDots, SlideStrip, type FormatPreviewData } from "@/components/format-preview/shared"
import { YourCarouselBand, YourCarouselTile } from "@/components/media-panel"
import { DriveFolderEntry } from "@/components/drive-folder-review"
import { carouselVideoTooLongMessage } from "@/lib/carousel-video"

const STATES = ["preview", "panel", "too-long"] as const
type State = (typeof STATES)[number]

const STATE_LABEL: Record<State, string> = {
  preview: "תצוגה מקדימה בלוח — קרוסלה מעורבת, שקופית 3 היא סרטון",
  panel: "״הקרוסלה שלך״ בפאנל המדיה — סרטון כשקופית ראשונה",
  "too-long": "סרטון ארוך מדי — ההודעה במקום שבו בחרו אותו",
}

const IMAGES = [
  "/images/carousel-templates/default.png",
  "/images/carousel-templates/ai-light.png",
  "/images/carousel-templates/ai-dark.png",
  "/images/carousel-templates/ai-amber.png",
]
const VIDEO = "/images/test/carousel-video-slide.mp4"

function Preview({ origin }: { origin: string }) {
  const [index, setIndex] = useState(2)
  const urls = [IMAGES[0], IMAGES[1], VIDEO, IMAGES[2], IMAGES[3]]
  const data: FormatPreviewData = {
    corePostId: "test",
    format: "carousel",
    hook: "3 טעויות שעולות לכם בלקוחות",
    caption: "",
    slides: urls.map((u) => ({ url: `${origin}${u}`, type: u.endsWith(".mp4") ? "video" : "image" })),
    handle: "noa.cohen",
    scheduledDate: "2026-11-10",
    scheduledTime: "09:00",
    publish: { kind: "unscheduled" },
  }
  return (
    <div dir="rtl" className="flex w-[360px] flex-col gap-3 rounded-xl border border-border-neutral-default bg-white p-4 dark:bg-gray-10">
      <FormatMedia data={data} content="ready" index={index} onIndexChange={setIndex} rounded="rounded-lg" />
      <SlideDots total={data.slides.length} index={index} />
      <SlideStrip slides={data.slides} index={index} onIndexChange={setIndex} />
    </div>
  )
}

function Panel({ origin }: { origin: string }) {
  const slides = [`${origin}${VIDEO}`, ...IMAGES.map((u) => `${origin}${u}`)]
  return (
    <div
      dir="rtl"
      className="flex w-[400px] flex-col gap-4 overflow-hidden rounded-xl border border-border-neutral-default bg-white px-6 pt-6 pb-6 dark:bg-gray-10"
    >
      <YourCarouselTile images={slides} onOpen={() => undefined} />
      <YourCarouselBand images={slides} onOpen={() => undefined} />
    </div>
  )
}

function TooLong() {
  return (
    <div
      dir="rtl"
      className="flex w-[400px] flex-col gap-4 rounded-xl border border-border-neutral-default bg-white p-6 dark:bg-gray-10"
    >
      <DriveFolderEntry format="carousel" onOpen={() => undefined} error={`${carouselVideoTooLongMessage(94)} (שקופית 3)`} />
    </div>
  )
}

function Page() {
  const params = useSearchParams()
  const raw = params.get("state")
  const state = STATES.find((s) => s === raw) ?? null
  // isVideoSlide reads full URLs (stored slides always are) — use this origin.
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  )
  if (!origin) return null
  const shown = state ? [state] : STATES
  return (
    <main dir="rtl" className="flex min-h-screen flex-col gap-10 bg-bg-surface p-8">
      {shown.map((s) => (
        <section key={s} className="flex flex-col gap-2">
          <h2 className="text-small-bold text-text-primary-default">{STATE_LABEL[s]}</h2>
          {s === "preview" ? <Preview origin={origin} /> : s === "panel" ? <Panel origin={origin} /> : <TooLong />}
        </section>
      ))}
    </main>
  )
}

export default function CarouselVideoTestPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  )
}
