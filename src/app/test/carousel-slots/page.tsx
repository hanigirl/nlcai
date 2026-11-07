"use client"

/**
 * State preview for the carousel's slide slots in the AI panel (Hani,
 * 2026-11-06: "תן למשתמש להחליט מתי הוא רוצה סרטון").
 *
 * Route: /test/carousel-slots?state=one|mixed|six|emptied|ask|three|full|first|none
 *   one   — a 6-slide carousel, one picture attached (in slide 1): the panel
 *           says where it went, offers more media, says empty = AI.
 *   mixed — a picture in slide 1 and a video in slide 3 (play mark).
 *   six   — every slide of a 6-slide carousel filled in one go (5 pictures
 *           and a video) — past the old 3-attachment cap.
 *   emptied — the six, after she removed slide 4's media: slot 4 shows
 *           the AI mark and the panel says it will be made with AI.
 *   ask   — before the first generation, she pressed send with slides 2
 *           and 4 still empty: the panel
 *           asks first ("ליצור אותן עם AI?"), nothing is sent yet.
 *   three — no carousel yet, 3 slides planned, 3 pictures attached: the live
 *           bug's start (2026-11-07). Remove one with the X, then press send
 *           or "להעלות כמו שזה" — the panel must ask about the empty slide.
 *   live  — no carousel yet, 3 slides planned, nothing attached: attach from
 *           the computer yourself (the real add menu), X one, then
 *           "להעלות כמו שזה" — the real path of the 2026-11-07 bug.
 *   full  — a 3-slide carousel, every slot filled: no line about the AI.
 *   first — no carousel yet (first generation): 6 slots from the script's
 *           planned count, a picture in slide 2.
 *   none  — nothing attached: the composer as before, no slots.
 *
 * The REAL MediaAiChat, seeded with sample attachments. Clicking an empty
 * slot points the next file there (and opens the add menu); dragging moves
 * between slots. Nothing is sent: no generation, no credits, no DB write.
 */

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaAiChat } from "@/components/media-ai-chat"
import { openingId, type AiEditOpening } from "@/lib/ai-edit-intent"

const STATES = [
  { id: "one", label: "תמונה אחת בקרוסלה של 6" },
  { id: "mixed", label: "תמונה + סרטון" },
  { id: "six", label: "כל 6 השקופיות בבת אחת" },
  { id: "emptied", label: "אחרי מחיקה משקופית 4" },
  { id: "ask", label: "שאלה לפני יצירה עם AI" },
  { id: "live", label: "ריק, לפני היצירה — לצרף בעצמכם מהמחשב" },
  { id: "three", label: "3 תמונות, לפני היצירה (להסיר אחת ולשלוח)" },
  { id: "full", label: "כל השקופיות מלאות" },
  { id: "first", label: "לפני היצירה הראשונה" },
  { id: "none", label: "בלי מדיה" },
] as const
type State = (typeof STATES)[number]["id"]

const SLIDES = [
  "/images/carousel-templates/default.png",
  "/images/carousel-templates/ai-light.png",
  "/images/carousel-templates/ai-dark.png",
  "/images/carousel-templates/ai-amber.png",
  "/images/carousel-templates/ai-minimal.png",
  "/images/carousel-templates/ai-ice.png",
]

async function fileOf(path: string, name: string): Promise<File> {
  const blob = await (await fetch(path)).blob()
  return new File([blob], name, { type: blob.type || "image/png" })
}

type Seed = { preview: File; kind: "image" | "video"; at?: number }

function Panel({ state }: { state: State }) {
  const [seed, setSeed] = useState<Seed[] | null>(null)
  const [loadId] = useState(() => Math.random().toString(36).slice(2, 8))
  useEffect(() => {
    let live = true
    void (async () => {
      const pic = await fileOf("/images/carousel-templates/ai-amber.png", "photo.png")
      const frame = await fileOf("/images/carousel-templates/ai-dark.png", "clip-frame.png")
      const pic2 = await fileOf("/images/carousel-templates/ai-ice.png", "photo2.png")
      const six = await Promise.all(SLIDES.map((p, i) => fileOf(p, `slide-${i + 1}.png`)))
      const next: Seed[] =
        state === "six"
          ? six.map((f, i) => ({ preview: f, kind: i === 3 ? "video" : "image", at: i }))
          : state === "three"
            ? six.slice(0, 3).map((f, i): Seed => ({ preview: f, kind: "image", at: i }))
          : state === "ask"
            ? six.flatMap((f, i): Seed[] => (i === 1 || i === 3 ? [] : [{ preview: f, kind: "image", at: i }]))
          : state === "emptied"
            ? six.flatMap((f, i): Seed[] => (i === 3 ? [] : [{ preview: f, kind: "image", at: i }]))
          : state === "one"
          ? [{ preview: pic, kind: "image", at: 0 }]
          : state === "mixed"
            ? [
                { preview: pic, kind: "image", at: 0 },
                { preview: frame, kind: "video", at: 2 },
              ]
            : state === "full"
              ? [
                  { preview: pic, kind: "image", at: 0 },
                  { preview: frame, kind: "video", at: 1 },
                  { preview: pic2, kind: "image", at: 2 },
                ]
              : state === "first"
                ? [{ preview: pic, kind: "image", at: 1 }]
                : []
      if (live) setSeed(next)
    })()
    return () => {
      live = false
    }
  }, [state])

  const opening = useMemo<AiEditOpening | null>(
    () =>
      state === "first" || state === "ask" || state === "three" || state === "live"
        ? {
            id: openingId(),
            kind: "generate",
            style: "niche",
            placeRefs: true,
            // A preview: nothing runs.
            run: async () => ({ ok: false, message: "זו תצוגה מקדימה — לא נוצר כלום." }),
          }
        : null,
    [state],
  )
  // "ask": she pressed send with slides still empty — press it for her once
  // the seeded attachments are in (the real send, the real question).
  useEffect(() => {
    if (state !== "ask" || !seed) return
    const t = setTimeout(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="יצירה"], button[aria-label="שליחה"]')?.click()
    }, 1500)
    return () => clearTimeout(t)
  }, [state, seed])
  if (!seed) return null
  const current = state === "full" ? SLIDES.slice(0, 3) : state === "first" || state === "ask" || state === "three" || state === "live" ? [] : SLIDES
  return (
    <MediaAiChat
      key={state}
      // A fresh conversation on every load (the chat store keeps threads).
      postId={`test-carousel-slots-${state}-${loadId}`}
      format="carousel"
      open
      opening={opening}
      currentUrls={current}
      slideCount={state === "three" || state === "live" ? 3 : state === "first" || state === "ask" ? 6 : undefined}
      seedAttachments={seed}
      seedEmptied={state === "emptied" ? 3 : undefined}
      onOpenChange={() => {}}
    />
  )
}

function Page() {
  const params = useSearchParams()
  const raw = params.get("state")
  const state: State = STATES.find((s) => s.id === raw)?.id ?? "one"
  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
      on ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
    }`
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s.id} href={`/test/carousel-slots?state=${s.id}`} className={pill(s.id === state)}>
            {s.label}
          </Link>
        ))}
      </div>
      <Panel state={state} />
    </div>
  )
}

export default function CarouselSlotsTestPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  )
}
