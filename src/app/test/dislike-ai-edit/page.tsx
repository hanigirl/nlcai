"use client"

/**
 * REVIEW-ONLY harness for "לא אהבתי → עריכה עם AI" (Joey, 2026-10-29).
 *
 * Route: /test/dislike-ai-edit?dislike=a|b&state=idle|asking|generating|done|error
 *
 * A carousel result card as it sits on /project (same header, same 👍/👎 row
 * — the real CardStyleFeedback — and the real MediaAiChat panel), with seeded
 * slides. Nothing reaches the server: lib/dislike-review simulates the save
 * and the edit. No credits, no DB writes.
 */

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { GalleryHorizontalEnd } from "lucide-react"
import { CardStyleFeedback } from "@/components/style-feedback-strip"
import { MediaAiChat, type AiEditFormat } from "@/components/media-ai-chat"
import { AiRefineButton } from "@/components/ai-refine-button"
import { dislikeInstruction, openingId, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import { getDislikeReview } from "@/lib/dislike-review"

const POST_ID = "review-dislike-post"
const SLIDES = ["/images/carousel-templates/ai-dark.png", "/images/carousel-templates/ai-amber.png"]
const SEEDED_FEEDBACK = dislikeInstruction(["הצבעים", "עמוס מדי"], "יותר מדי טקסט בכל שקופית, והצבעים חזקים מדי. תנו יותר אוויר.")

const STATES = [
  { id: "idle", label: "ברירת מחדל" },
  { id: "asking", label: "שואלים מה לא עבד" },
  { id: "generating", label: "בזמן עריכה" },
  { id: "done", label: "העריכה הסתיימה" },
  { id: "error", label: "שגיאה" },
] as const

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Harness />
    </Suspense>
  )
}

function Harness() {
  const params = useSearchParams()
  const variant = params.get("dislike") === "b" ? "b" : "a"
  const state = params.get("state") ?? "idle"
  const [format, setFormat] = useState<AiEditFormat | null>(null)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)
  // The 👍/👎 row reads localStorage — render after mount (no hydration diff).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useAiEditRequests((req) => {
    setFormat(req.format)
    setOpening(req.opening)
  })

  // Land straight on the state: B's "asking" is the panel's question; the
  // running / done / error states start from the feedback already sent.
  useEffect(() => {
    if (!getDislikeReview()) return
    if (variant === "b" && state === "asking") {
      setFormat("carousel")
      setOpening({ id: openingId(), kind: "dislike", onFeedback: () => {} })
    } else if (state === "generating" || state === "done" || state === "error") {
      setFormat("carousel")
      setOpening({ id: openingId(), kind: "autorun", text: SEEDED_FEEDBACK, source: variant === "a" ? "dislike" : "review-b" })
    }
  }, [variant, state])

  if (params.get("dislike") !== "a" && params.get("dislike") !== "b") {
    return (
      <div dir="rtl" className="p-8 text-small">
        פתחו עם <code>?dislike=a</code> או <code>?dislike=b</code>.
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      {/* Review-only state toggle */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border-neutral-default bg-white dark:bg-gray-10 p-3 text-xs">
        <span className="text-text-neutral-default">סקירה בלבד:</span>
        {(["a", "b"] as const).map((v) =>
          STATES.map((s) => (
            <Link
              key={`${v}-${s.id}`}
              href={`/test/dislike-ai-edit?dislike=${v}&state=${s.id}`}
              className={`rounded-full border px-2.5 py-1 ${
                v === variant && s.id === state
                  ? "border-yellow-50 bg-bg-surface-primary-default text-text-primary-default"
                  : "border-border-neutral-default text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
              }`}
            >
              {v === "a" ? "A" : "B"} · {s.label}
            </Link>
          )),
        )}
      </div>

      <div className="mx-auto flex w-[340px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6">
        <div className="flex items-center gap-2 rounded-t-[20px] px-6 py-3">
          <span className="text-p-bold text-text-primary-default">הקרוסלה שלכם</span>
          <GalleryHorizontalEnd className="size-4 text-text-neutral-default" />
        </div>
        {mounted && <CardStyleFeedback key={`${variant}-${state}`} postId={POST_ID} format="carousel" mediaUrl={SLIDES[0]} />}
        <div className="flex gap-2 overflow-hidden px-6">
          {SLIDES.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="aspect-[4/5] w-[140px] shrink-0 rounded-xl border border-border-neutral-default object-cover" />
          ))}
        </div>
        <div className="px-6">
          <AiRefineButton
            onClick={() => {
              setFormat("carousel")
              setOpening(null)
            }}
            className="w-full"
          />
        </div>
      </div>

      {format && (
        <MediaAiChat
          postId={POST_ID}
          format={format}
          open
          opening={opening}
          onOpenChange={(o) => {
            if (!o) {
              setFormat(null)
              setOpening(null)
            }
          }}
        />
      )}
    </div>
  )
}
