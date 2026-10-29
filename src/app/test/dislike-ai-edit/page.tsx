"use client"

/**
 * State preview for "לא אהבתי → עריכה עם AI".
 *
 * Route: /test/dislike-ai-edit?state=idle|asking|generating|done|error
 *
 * A carousel result card as on /project — the real 👍/👎 row
 * (CardStyleFeedback) and the real AI-edit panel (MediaAiChat) — with sample
 * slides. `fetch` is stubbed on this page for the two routes the flow calls,
 * so nothing reaches the network: no credits, no DB writes.
 */

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { GalleryHorizontalEnd } from "lucide-react"
import { CardStyleFeedback } from "@/components/style-feedback-strip"
import { MediaAiChat, type AiEditFormat } from "@/components/media-ai-chat"
import { AiRefineButton } from "@/components/ai-refine-button"
import { openingId, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import { recordAiStyleVote } from "@/lib/ai-style-provenance"
import { setFormatMeta } from "@/lib/timing-storage"

const POST_ID = "preview-dislike-post"
const SLIDES = ["/images/carousel-templates/ai-dark.png", "/images/carousel-templates/ai-amber.png"]

const STATES = [
  { id: "idle", label: "ברירת מחדל" },
  { id: "asking", label: "הפאנל שואל מה לא אהבתם" },
  { id: "generating", label: "בזמן עריכה" },
  { id: "done", label: "העריכה הסתיימה" },
  { id: "error", label: "שגיאה" },
] as const
type State = (typeof STATES)[number]["id"]

/** Canned answers for the flow's two routes; everything else is refused. */
function stubFetch(state: State) {
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
  window.fetch = ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/api/visual-language/style-feedback"))
      return json({ ok: true, message: "עדכנו את השפה: פחות עומס וצבעים רכים יותר." })
    if (url.includes("/api/media/ai-edit")) {
      if (state === "generating") return new Promise<Response>(() => {})
      return new Promise<Response>((resolve) =>
        setTimeout(
          () =>
            resolve(
              state === "error"
                ? new Response(JSON.stringify({ message: "העריכה לא הצליחה הפעם. נסו שוב, או נסחו את הבקשה אחרת." }), { status: 500 })
                : new Response(JSON.stringify({ urls: SLIDES, remembered: null }), { status: 200 }),
            ),
          900,
        ),
      )
    }
    return Promise.reject(new Error("preview: network disabled"))
  }) as typeof fetch
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}

function Preview() {
  const params = useSearchParams()
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "idle") as State
  const [ready, setReady] = useState(false)
  const [format, setFormat] = useState<AiEditFormat | null>(null)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useAiEditRequests((req) => {
    setFormat(req.format)
    setOpening(req.opening)
  })

  // Stub the network, reset the sample vote, then land on the state.
  useEffect(() => {
    stubFetch(state)
    recordAiStyleVote(POST_ID, "carousel", state === "idle" ? null : "dislike")
    setReady(true)
    if (state === "idle") return
    setFormat("carousel")
    setOpening({ id: openingId(), kind: "dislike", onFeedback: () => {} })
  }, [state])

  // generating / done / error: her answer already sent from the panel.
  useEffect(() => {
    if (!opening || !["generating", "done", "error"].includes(state)) return
    const t = setTimeout(() => {
      const root = panelRef.current
      if (!root) return
      root.querySelector<HTMLButtonElement>('[aria-pressed="false"]')?.click()
      const ta = root.querySelector("textarea")
      if (ta) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, "יותר מדי טקסט בכל שקופית")
        ta.dispatchEvent(new Event("input", { bubbles: true }))
      }
      setTimeout(() => root.querySelector<HTMLButtonElement>('[aria-label="שליחה"]')?.click(), 50)
    }, 100)
    return () => clearTimeout(t)
  }, [opening, state])

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={`/test/dislike-ai-edit?state=${s.id}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="mx-auto flex w-[340px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6">
        <div className="flex items-center gap-2 rounded-t-[20px] px-6 py-3">
          <span className="text-p-bold text-text-primary-default">הקרוסלה שלכם</span>
          <GalleryHorizontalEnd className="size-4 text-text-neutral-default" />
        </div>
        {ready && <PreviewFeedbackRow key={state} />}
        <div className="flex gap-2 overflow-hidden px-6">
          {SLIDES.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="aspect-[4/5] w-[140px] shrink-0 rounded-xl border border-border-neutral-default object-cover" />
          ))}
        </div>
        <div className="px-6">
          <AiRefineButton onClick={() => { setFormat("carousel"); setOpening(null) }} className="w-full" />
        </div>
      </div>

      <div ref={panelRef}>
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
    </div>
  )
}

/**
 * CardStyleFeedback shows only on media the AI made in a known style — a
 * carousel's template is its provenance, so give the sample one.
 */
function PreviewFeedbackRow() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    setFormatMeta(POST_ID, "carousel", { templateId: "ai-dark" })
    setOk(true)
  }, [])
  return ok ? <CardStyleFeedback postId={POST_ID} format="carousel" mediaUrl={SLIDES[0]} /> : null
}
