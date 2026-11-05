"use client"

/**
 * State preview — "חדש לגמרי" (Hani, 2026-11-05).
 *
 * The media panel's "יצירה עם AI" card with the real style tiles
 * (MediaStylePicker) and the real AI panel (MediaAiChat):
 *   - "חדש לגמרי" + generate → the panel asks "איך תרצו להתחיל?", generates
 *     from her answer (a blank page), and stays open for edits;
 *   - any other tile ("השפה הוויזואלית שלך", כהה, בהיר) → generates right away,
 *     no question.
 *
 * The generation is a stub (a timer) and `fetch` is stubbed for the routes the
 * panel calls afterwards — nothing reaches the network: no credits, no DB
 * writes.
 *
 *   ?state=tiles | ask | generating | done | error | brand
 */

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MediaAiChat, mediaChatKey } from "@/components/media-ai-chat"
import { MediaStylePicker } from "@/components/media-style-picker"
import { clearChat } from "@/lib/ai-chat-session-store"
import { openingId, requestAiEdit, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import { buildBrandTemplate } from "@/lib/carousel-templates"
import type { MediaGenResult } from "@/lib/media-brief"
import type { MediaStyle } from "@/lib/visual-language/types"

const POST_ID = "preview-blank-tile-post"
const RESULT = "/images/carousel-templates/ai-light.png"
const BRAND = buildBrandTemplate({ thumbnailUrl: "/images/carousel-templates/ai-amber.png" })
const SAMPLE_BRIEF = "רקע לבן ונקי, הרבה אוויר, כותרת שחורה גדולה ובלי איורים"

const STATES = [
  { id: "tiles", label: "אריח ״חדש לגמרי״ נבחר" },
  { id: "ask", label: "הפאנל שואל איך להתחיל" },
  { id: "generating", label: "בזמן יצירה" },
  { id: "done", label: "התוצאה + ממשיכים לערוך" },
  { id: "error", label: "שגיאה" },
  { id: "brand", label: "״השפה הוויזואלית שלך״ — יוצר מיד" },
] as const
type State = (typeof STATES)[number]["id"]

/** Edits after the generation: a canned answer, so "continue editing" works too. */
function stubFetch() {
  window.fetch = ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/api/media/ai-edit"))
      return new Promise<Response>((r) =>
        setTimeout(() => r(new Response(JSON.stringify({ urls: [RESULT], remembered: null }), { status: 200 })), 900),
      )
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
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "tiles") as State
  const [style, setStyle] = useState<MediaStyle>(state === "brand" ? "brand" : "blank")
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useAiEditRequests((req) => {
    setOpen(true)
    setOpening(req.opening)
  })

  /** Stands in for the generate route: a timer, ending per the state. */
  const fakeGenerate = (): Promise<MediaGenResult> => {
    setBusy(true)
    return new Promise<MediaGenResult>((resolve) => {
      if (stateRef.current === "generating") return // stays running
      setTimeout(() => {
        setBusy(false)
        if (stateRef.current === "error") {
          resolve({ ok: false, message: "היצירה לא הצליחה: נגמר הקרדיט ב-OpenAI. אפשר להטעין קרדיט ולנסות שוב." })
          return
        }
        setResult(RESULT)
        resolve({ ok: true })
      }, 1200)
    })
  }

  /** The card's "יצירה עם AI" — the same branch as the media panel. */
  const pressGenerate = (picked: MediaStyle = style) => {
    if (picked === "blank") {
      requestAiEdit({ postId: POST_ID, format: "image_post", opening: { id: openingId(), kind: "generate", run: () => fakeGenerate() } })
      return
    }
    void fakeGenerate()
  }

  // Land on the state: clean conversation, then press generate where the state needs it.
  useEffect(() => {
    stubFetch()
    clearChat(mediaChatKey(POST_ID, "image_post"))
    setResult(null)
    setBusy(false)
    setOpen(false)
    setOpening(null)
    const picked: MediaStyle = state === "brand" ? "brand" : "blank"
    setStyle(picked)
    if (state === "tiles") return
    const t = setTimeout(() => pressGenerate(picked), 400)
    return () => clearTimeout(t)
    // Once per state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={`/test/media-blank-tile?state=${s.id}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* The media panel's "יצירה עם AI" card, as in the image-post panel. */}
        <div className="flex w-[352px] flex-col gap-3 rounded-[18px] border border-border-neutral-default bg-white px-6 py-4 dark:bg-gray-10">
          <MediaStylePicker value={style} onChange={setStyle} brandTemplate={BRAND} aspect="4/5" />
          <Button variant="default" onClick={() => pressGenerate()} disabled={busy} className="w-full gap-1.5">
            {busy && style !== "blank" && <Loader2 className="size-3.5 animate-spin" />}
            יצירת תמונה עם AI
          </Button>
        </div>

        {/* The format's card on the canvas, where the result lands. */}
        <div className="flex w-[220px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white p-4 dark:bg-gray-10">
          <span className="text-p-bold text-text-primary-default">פוסט תמונה</span>
          <div className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-xl border border-border-neutral-default bg-bg-surface">
            {result ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result} alt="" className="size-full object-cover" />
            ) : busy ? (
              <Loader2 className="size-5 animate-spin text-text-neutral-default" />
            ) : (
              <span className="text-xs text-text-neutral-default">עוד אין מדיה</span>
            )}
          </div>
        </div>
      </div>

      {open && (
        <MediaAiChat
          key={state}
          postId={POST_ID}
          format="image_post"
          open
          opening={opening}
          // generating / done / error: her answer, typed and sent.
          autoSend={["generating", "done", "error"].includes(state) ? SAMPLE_BRIEF : undefined}
          onOpenChange={(o) => {
            if (!o) {
              setOpen(false)
              setOpening(null)
            }
          }}
        />
      )}
    </div>
  )
}
