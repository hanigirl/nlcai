"use client"

/**
 * State preview — a carousel AI edit that changes the PICTURE itself (Hani,
 * 2026-11-05: "כשאני מבקשת שמשהו ישתלב הוא כבר יעשה את זה כמו שצריך").
 *
 * She asks to remove the caption from her photo on slide 1. Before: the
 * layout engine cropped the photo to a thin strip to hide it. Now (Hani only,
 * lib/feature-access) the photo goes through the image model and the result
 * is placed back on the slide (lib/picture-edit). If the picture didn't
 * change, or it no longer looks like hers, nothing is saved and she is told.
 *
 * The real AI panel (MediaAiChat) in edit mode; `fetch` is stubbed with the
 * route's real answers for each outcome — no credits, no DB writes.
 *
 *   ?state=done | unchanged | not-hers | missing
 */

import { Suspense, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaAiChat, mediaChatKey } from "@/components/media-ai-chat"
import { clearChat } from "@/lib/ai-chat-session-store"
import { PICTURE_MISSING, PICTURE_NOT_HERS, PICTURE_UNCHANGED } from "@/lib/picture-edit-copy"

const POST_ID = "preview-picture-edit-post"
const BEFORE = "/images/carousel-templates/ai-dark.png"
const AFTER = "/images/carousel-templates/ai-amber.png"
const ASK = "תורידי את הכיתוב מהתמונה שלי בשקופית 1"

const STATES = [
  { id: "done", label: "התמונה נערכה והוחזרה לשקופית" },
  { id: "unchanged", label: "התמונה לא השתנתה — לא נשמר" },
  { id: "not-hers", label: "כבר לא נראית כמו שלה — לא נשמר" },
  { id: "missing", label: "אין תמונה בשקופית" },
] as const
type State = (typeof STATES)[number]["id"]

const noSubscribe = () => () => {}

function stubFetch(state: State, onSaved: () => void) {
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    // The chat's visual-memory check: nothing to remember here.
    if (url.includes("/api/visual-language/style-memory"))
      return new Response(JSON.stringify({ edit: true, editInstruction: ASK, memory: { kind: "none" } }), { status: 200 })
    if (url.includes("/api/media/ai-edit")) {
      await new Promise((r) => setTimeout(r, 1200))
      if (state === "done") {
        onSaved()
        return new Response(JSON.stringify({ urls: [AFTER], edited: [1] }), { status: 200 })
      }
      const message = state === "unchanged" ? PICTURE_UNCHANGED : state === "not-hers" ? PICTURE_NOT_HERS : PICTURE_MISSING
      return new Response(JSON.stringify({ error: "picture_edit_failed", message }), { status: 422 })
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
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "done") as State
  return <Stage key={state} state={state} />
}

function Stage({ state }: { state: State }) {
  const [slide, setSlide] = useState(BEFORE)
  // Client only: the stubs and a clean conversation before the panel sends.
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false)
  useEffect(() => {
    // Before the panel's scripted request goes out (it waits 300ms).
    clearChat(mediaChatKey(POST_ID, "carousel"))
    stubFetch(state, () => setSlide(AFTER))
  }, [state])

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={`/test/picture-edit?state=${s.id}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {/* The carousel result card's slide 1 — where the edited picture lands. */}
      <div className="flex w-[260px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white p-4 dark:bg-gray-10">
        <span className="text-p-bold text-text-primary-default">הקרוסלה שלכם · שקופית 1</span>
        <div className="aspect-[4/5] w-full overflow-hidden rounded-xl border border-border-neutral-default bg-bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide} alt="שקופית 1" className="size-full object-cover" />
        </div>
        <p className="text-xs-body text-text-neutral-default">
          {slide === AFTER ? "התמונה עברה עריכה אמיתית והוחזרה לשקופית." : "השקופית כמו שהיא עכשיו."}
        </p>
      </div>

      {ready && <MediaAiChat
        key={state}
        postId={POST_ID}
        format="carousel"
        open
        autoSend={ASK}
        onOpenChange={() => {}}
      />}
    </div>
  )
}
