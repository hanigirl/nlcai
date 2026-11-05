"use client"

/**
 * State preview — "לדבר איתו קודם" (Hani, 2026-11-05).
 *
 * The media panel's "יצירה עם AI" card with the real style tiles, the real
 * talk-first control (components/media-talk-first) and the real AI panel
 * (MediaAiChat). Two places for the option:
 *   ?talk=a — a quieter second button under the generate button;
 *   ?talk=b — a checkbox under the tiles that turns the generate button into
 *             "פתיחת שיחה עם AI" (remembered on this device).
 * The generate button alone still generates at once — the quick path.
 *
 * Generation is a stub (a timer) and `fetch` is stubbed — the link preview
 * route answers with a sample picture. Nothing reaches the network: no
 * credits, no DB writes.
 *
 *   ?talk=a|b&state=tiles | quick | ask | ask-ref | ask-link | link-failed |
 *                   generating | done | error | niche | blank
 */

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MediaAiChat, mediaChatKey } from "@/components/media-ai-chat"
import { MediaStylePicker } from "@/components/media-style-picker"
import { TALK_FIRST_BUTTON, TalkFirstControl, useTalkFirst, type TalkFirstVariant } from "@/components/media-talk-first"
import { clearChat } from "@/lib/ai-chat-session-store"
import { openingId, requestAiEdit, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import { buildBrandTemplate } from "@/lib/carousel-templates"
import type { MediaGenResult } from "@/lib/media-brief"
import type { MediaStyle } from "@/lib/visual-language/types"

const POST_ID = "preview-talk-first-post"
const RESULT = "/images/carousel-templates/ai-amber.png"
const BRAND = buildBrandTemplate({ thumbnailUrl: "/images/carousel-templates/ai-amber.png" })
const SAMPLE_BRIEF = "הפעם יותר אוויר וכותרת גדולה, ובלי אייקונים"
const SAMPLE_REFERENCE = "/images/carousel-templates/ai-dark.png"
const SAMPLE_LINK = "https://www.instagram.com/p/sample-post/"
const FAILED_LINK = "https://example.com/fail-no-preview"

const STATES = [
  { id: "tiles", label: "השפה שלך נבחרה — האפשרות מופיעה" },
  { id: "quick", label: "לחיצה על יצירה — יוצר מיד" },
  { id: "ask", label: "מדברים קודם — השאלה" },
  { id: "ask-ref", label: "צירפו תמונת רפרנס" },
  { id: "ask-link", label: "הדביקו קישור" },
  { id: "link-failed", label: "קישור בלי תמונה" },
  { id: "generating", label: "בזמן יצירה" },
  { id: "done", label: "התוצאה + ממשיכים לערוך" },
  { id: "error", label: "שגיאה" },
  { id: "niche", label: "נישה כהה — מדברים קודם" },
  { id: "blank", label: "״חדש לגמרי״ — בלי שינוי" },
] as const
type State = (typeof STATES)[number]["id"]

/** A sample picture as a data URL — `fetch` is stubbed, so via canvas. */
function sampleDataUrl(): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext("2d")?.drawImage(img, 0, 0)
      resolve(canvas.toDataURL("image/jpeg", 0.85))
    }
    img.src = SAMPLE_REFERENCE
  })
}

/** The panel's routes, answered locally. */
function stubFetch() {
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/api/media/link-reference")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string }
      await new Promise((r) => setTimeout(r, 1100))
      if (body.url?.includes("fail"))
        return new Response(
          JSON.stringify({ error: "link_failed", message: "לא מצאנו בקישור הזה תמונה לשתף. אפשר לצרף צילום מסך במקום." }),
          { status: 422 },
        )
      return new Response(
        JSON.stringify({ image: await sampleDataUrl(), title: "פוסט לדוגמה באינסטגרם", host: "instagram.com" }),
        { status: 200 },
      )
    }
    if (url.includes("/api/media/ai-edit"))
      return new Promise<Response>((r) =>
        setTimeout(() => r(new Response(JSON.stringify({ urls: [RESULT], remembered: null }), { status: 200 })), 900),
      )
    return Promise.reject(new Error("preview: network disabled"))
  }) as typeof fetch
}

/** Types into the panel's composer the way she would (React sees the change). */
function typeInto(root: HTMLElement, text: string) {
  const el = root.querySelector<HTMLTextAreaElement>("textarea")
  if (!el) return
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Attaches the sample screenshot through the panel's real file input. */
async function attachSample(root: HTMLElement) {
  const dataUrl = await sampleDataUrl()
  const blob = dataUrlToBlob(dataUrl)
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) return
  const dt = new DataTransfer()
  dt.items.add(new File([blob], "reference.jpg", { type: "image/jpeg" }))
  input.files = dt.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function dataUrlToBlob(dataUrl: string): Blob {
  const bin = atob(dataUrl.split(",")[1])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: "image/jpeg" })
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
  const variant: TalkFirstVariant = params.get("talk") === "b" ? "b" : "a"
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "tiles") as State
  const talk = useTalkFirst(variant)
  const startStyle: MediaStyle = state === "niche" ? "ai-dark" : state === "blank" ? "blank" : "brand"
  const [style, setStyle] = useState<MediaStyle>(startStyle)
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const blank = style === "blank"

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
      }, stateRef.current === "quick" ? 2400 : 1200)
    })
  }

  /** The card's buttons — the same branch as the media panel. */
  const pressGenerate = (askFirst: boolean, picked: MediaStyle = style) => {
    if (picked === "blank" || askFirst) {
      requestAiEdit({
        postId: POST_ID,
        format: "image_post",
        opening: { id: openingId(), kind: "generate", run: () => fakeGenerate(), style: picked },
      })
      return
    }
    void fakeGenerate()
  }

  // Land on the state: clean conversation, then press where the state needs it.
  useEffect(() => {
    stubFetch()
    clearChat(mediaChatKey(POST_ID, "image_post"))
    setResult(null)
    setBusy(false)
    setOpen(false)
    setOpening(null)
    setStyle(startStyle)
    const talking = !["tiles", "quick", "blank"].includes(state)
    // b: the checkbox is the habit — on for the talking states.
    if (variant === "b") talk.setHabit(talking)
    if (state === "tiles") return
    const t = setTimeout(() => pressGenerate(talking, startStyle), 400)
    return () => clearTimeout(t)
    // Once per state / variant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, variant])

  // Act inside the open panel per state.
  useEffect(() => {
    if (!opening) return
    const root = panelRef.current
    if (!root) return
    const t = setTimeout(() => {
      if (state === "ask-ref") void attachSample(root)
      if (state === "ask-link") typeInto(root, `שיהיה באווירה של הפוסט הזה ${SAMPLE_LINK}`)
      if (state === "link-failed") typeInto(root, FAILED_LINK)
    }, 300)
    return () => clearTimeout(t)
  }, [opening, state])

  const href = (v: TalkFirstVariant, s: State) => `/test/talk-first?talk=${v}&state=${s}`

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-text-neutral-default">איפה האפשרות:</span>
        {(["a", "b"] as const).map((v) => (
          <Link
            key={v}
            href={href(v, state)}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              v === variant ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {v === "a" ? "A · כפתור שני מתחת ליצירה" : "B · תיבת סימון מעל היצירה"}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={href(variant, s.id)}
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
        <div className="flex w-[352px] flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white px-6 py-4 dark:bg-gray-10">
          <MediaStylePicker value={style} onChange={setStyle} brandTemplate={BRAND} aspect="4/5" />
          <TalkFirstControl talk={talk} slot="above" blank={blank} id="talk-first-preview" onTalk={() => pressGenerate(true)} />
          <Button variant="default" onClick={() => pressGenerate(talk.askFirst)} disabled={busy && !open} className="w-full gap-1.5">
            {busy && !open && <Loader2 className="size-3.5 animate-spin" />}
            {talk.askFirst && !blank ? TALK_FIRST_BUTTON : "יצירת תמונה עם AI"}
          </Button>
          <TalkFirstControl talk={talk} slot="below" blank={blank} disabled={busy && !open} onTalk={() => pressGenerate(true)} />
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

      <div ref={panelRef}>
        {open && (
          <MediaAiChat
            key={`${variant}-${state}`}
            postId={POST_ID}
            format="image_post"
            open
            opening={opening}
            // generating / done / error: her words, typed and sent.
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
    </div>
  )
}
