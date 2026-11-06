"use client"

/**
 * State preview for the carousel's slide slots in the AI panel (Hani,
 * 2026-11-06: "תן למשתמש להחליט מתי הוא רוצה סרטון").
 *
 * Route: /test/carousel-slots?state=one|mixed|full|first|none
 *   one   — a 6-slide carousel, one picture attached (in slide 1): the panel
 *           says where it went, offers more media, says empty = AI.
 *   mixed — a picture in slide 1 and a video in slide 3 (play mark).
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
  useEffect(() => {
    let live = true
    void (async () => {
      const pic = await fileOf("/images/carousel-templates/ai-amber.png", "photo.png")
      const frame = await fileOf("/images/carousel-templates/ai-dark.png", "clip-frame.png")
      const pic2 = await fileOf("/images/carousel-templates/ai-ice.png", "photo2.png")
      const next: Seed[] =
        state === "one"
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
      state === "first"
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
  if (!seed) return null
  const current = state === "full" ? SLIDES.slice(0, 3) : state === "first" ? [] : SLIDES
  return (
    <MediaAiChat
      key={state}
      postId={`test-carousel-slots-${state}`}
      format="carousel"
      open
      opening={opening}
      currentUrls={current}
      slideCount={state === "first" ? 6 : undefined}
      seedAttachments={seed}
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
