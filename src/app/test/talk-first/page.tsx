"use client"

/**
 * State preview — "עריכה עם AI" before there is media (Hani, 2026-11-05:
 * "אם אני בשפה הויזואלית שלי ולחצתי עריכה - זה אומר: אני אייצר לך מדיה בשפה
 * ויזואלית שלך, יש דברים שאני צריך לדעת לפני? תמונות שתרצו שאכניס?").
 *
 * The media panel's "יצירה עם AI" card with the real style tiles — the picked
 * tile carries the existing ✨ "עריכת מדיה עם AI" — and the real AI panel
 * (MediaAiChat). Pressing ✨ opens the panel on a question in the picked style;
 * she can write, attach a reference, paste a link, or skip — then it
 * generates in that style and stays open for edits. With media already there
 * ✨ is the plain edit, as before. The generate button still generates at once.
 *
 * Generation is a stub (a timer) and `fetch` is stubbed — the link preview
 * route answers with a sample picture. Nothing reaches the network: no
 * credits, no DB writes.
 *
 *   ?gate=off — the panel as everyone but Hani sees it (images are looks only)
 *   ?format=image_post|story|b_roll|carousel
 *   &state=tiles | quick | brand | niche-dark | niche-light | blank | ref |
 *          link | ref-link | place-failed | link-failed | generating | done | error | has-media
 */

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MediaAiChat, mediaChatKey, type AiEditFormat } from "@/components/media-ai-chat"
import { MediaStylePicker } from "@/components/media-style-picker"
import { clearChat } from "@/lib/ai-chat-session-store"
import { openingId, requestAiEdit, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import { buildBrandTemplate } from "@/lib/carousel-templates"
import { PLACE_FAILED_GEN, type MediaGenResult } from "@/lib/media-brief"
import type { MediaStyle } from "@/lib/visual-language/types"

const POST_ID = "preview-talk-first-post"
const RESULT = "/images/carousel-templates/ai-amber.png"
const BRAND = buildBrandTemplate({ thumbnailUrl: "/images/carousel-templates/ai-amber.png" })
const SAMPLE_BRIEF = "הפעם יותר אוויר וכותרת גדולה, ובלי אייקונים"
const SAMPLE_REFERENCE = "/images/carousel-templates/ai-dark.png"
const SAMPLE_LINK = "https://www.instagram.com/p/sample-post/"
/** The link's picture — a different one from her attached sample. */
const SAMPLE_LINK_PICTURE = "/images/carousel-templates/ai-light.png"
const FAILED_LINK = "https://example.com/fail-no-preview"

const STATES = [
  { id: "tiles", label: "השפה שלך נבחרה — ✨ על האריח" },
  { id: "quick", label: "כפתור היצירה — יוצר מיד" },
  { id: "brand", label: "✨ בשפה שלך — השאלה" },
  { id: "niche-dark", label: "✨ נישה כהה" },
  { id: "niche-light", label: "✨ נישה בהירה" },
  { id: "blank", label: "✨ חדש לגמרי — כמו היום" },
  { id: "ref", label: "צירפו תמונה — תיכנס כמו שהיא" },
  { id: "link", label: "הדביקו קישור — השראה בלבד" },
  { id: "ref-link", label: "תמונה + קישור" },
  { id: "place-failed", label: "התמונה לא נכנסה" },
  { id: "link-failed", label: "קישור בלי תמונה" },
  { id: "generating", label: "בזמן יצירה" },
  { id: "done", label: "התוצאה + ממשיכים לערוך" },
  { id: "error", label: "שגיאה" },
  { id: "has-media", label: "כבר יש מדיה — עריכה רגילה" },
] as const
const FORMATS: { id: AiEditFormat; label: string }[] = [
  { id: "image_post", label: "פוסט תמונה" },
  { id: "story", label: "סטורי" },
  { id: "b_roll", label: "בי-רול" },
  { id: "carousel", label: "קרוסלה" },
]
type State = (typeof STATES)[number]["id"]

/** A sample picture as a data URL — `fetch` is stubbed, so via canvas. */
function sampleDataUrl(src: string = SAMPLE_REFERENCE): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext("2d")?.drawImage(img, 0, 0)
      resolve(canvas.toDataURL("image/jpeg", 0.85))
    }
    img.src = src
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
        JSON.stringify({ image: await sampleDataUrl(SAMPLE_LINK_PICTURE), title: "פוסט לדוגמה באינסטגרם", host: "instagram.com" }),
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
  const format: AiEditFormat = FORMATS.find((f) => f.id === params.get("format"))?.id ?? "image_post"
  // Placing her pictures is Hani-only (lib/feature-access); ?gate=off shows everyone else's panel.
  const placeOn = params.get("gate") !== "off"
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "tiles") as State
  const startStyle: MediaStyle =
    state === "niche-dark" ? "ai-dark" : state === "niche-light" ? "ai-light" : state === "blank" ? "blank" : "brand"
  const [style, setStyle] = useState<MediaStyle>(startStyle)
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const resultRef = useRef(result)
  resultRef.current = result

  // As the project page: ✨ with media already there = the plain edit.
  useAiEditRequests((req) => {
    setOpen(true)
    setOpening(req.opening.kind === "generate" && req.opening.fromEdit && resultRef.current ? null : req.opening)
  })

  /** Stands in for the generate route: a timer, ending per the state. */
  /** What the last generation was handed — shown on the result card. */
  const [sent, setSent] = useState<{ place: number; looks: number } | null>(null)
  const fakeGenerate = (looks: string[] = [], place: string[] = []): Promise<MediaGenResult> => {
    setSent({ place: place.length, looks: looks.length })
    setBusy(true)
    return new Promise<MediaGenResult>((resolve) => {
      if (stateRef.current === "generating") return // stays running
      setTimeout(() => {
        setBusy(false)
        if (stateRef.current === "place-failed") {
          resolve({ ok: false, message: PLACE_FAILED_GEN.message })
          return
        }
        if (stateRef.current === "error") {
          resolve({ ok: false, message: "היצירה לא הצליחה: נגמר הקרדיט ב-OpenAI. אפשר להטעין קרדיט ולנסות שוב." })
          return
        }
        setResult(RESULT)
        resolve({ ok: true })
      }, stateRef.current === "quick" ? 2400 : 1200)
    })
  }

  /** The card's generate button — the same branch as the media panel. */
  const pressGenerate = (picked: MediaStyle = style) => {
    if (picked === "blank") {
      requestAiEdit({ postId: POST_ID, format, opening: { id: openingId(), kind: "generate", run: (_b, looks, place) => fakeGenerate(looks, place), style: picked, placeRefs: placeOn } })
      return
    }
    void fakeGenerate()
  }

  /** ✨ "עריכה עם AI" on the picked tile. */
  const pressAiEdit = (picked: MediaStyle = style) =>
    requestAiEdit({
      postId: POST_ID,
      format,
      opening: { id: openingId(), kind: "generate", run: (_b, looks, place) => fakeGenerate(looks, place), style: picked, fromEdit: true, placeRefs: placeOn },
    })

  // Land on the state: clean conversation, then press where the state needs it.
  useEffect(() => {
    stubFetch()
    clearChat(mediaChatKey(POST_ID, format))
    const seeded = state === "has-media" ? RESULT : null
    setResult(seeded)
    resultRef.current = seeded
    setBusy(false)
    setSent(null)
    setOpen(false)
    setOpening(null)
    setStyle(startStyle)
    if (state === "tiles") return
    const t = setTimeout(() => (state === "quick" ? pressGenerate(startStyle) : pressAiEdit(startStyle)), 400)
    return () => clearTimeout(t)
    // Once per state / format / gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, format, placeOn])

  // Act inside the open panel per state.
  useEffect(() => {
    if (!opening) return
    const root = panelRef.current
    if (!root) return
    const t = setTimeout(() => {
      if (state === "ref" || state === "ref-link" || state === "place-failed") void attachSample(root)
      if (state === "ref-link") typeInto(root, `שיהיה באווירה של הפוסט הזה ${SAMPLE_LINK}`)
      // place-failed: her picture attached, then sent.
      if (state === "place-failed")
        setTimeout(() => {
          typeInto(root, "לשים את התמונה בצד ימין")
          setTimeout(() => root.querySelector<HTMLButtonElement>('button[aria-label="יצירה"]')?.click(), 300)
        }, 900)
      if (state === "link") typeInto(root, `שיהיה באווירה של הפוסט הזה ${SAMPLE_LINK}`)
      if (state === "link-failed") typeInto(root, FAILED_LINK)
    }, 300)
    return () => clearTimeout(t)
  }, [opening, state])

  const href = (f: AiEditFormat, s: State) => `/test/talk-first?format=${f}&state=${s}${placeOn ? "" : "&gate=off"}`
  const pill = (active: boolean) =>
    `rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
      active ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
    }`

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-neutral-default">פורמט:</span>
        {FORMATS.map((f) => (
          <Link key={f.id} href={href(f.id, state)} className={pill(f.id === format)}>
            {f.label}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s.id} href={href(format, s.id)} className={pill(s.id === state)}>
            {s.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* The media panel's "יצירה עם AI" card. */}
        <div className="flex w-[352px] flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white px-6 py-4 dark:bg-gray-10">
          <MediaStylePicker
            value={style}
            onChange={setStyle}
            brandTemplate={BRAND}
            aspect={format === "image_post" ? "4/5" : "9/16"}
            onAiEdit={() => pressAiEdit()}
            aiVisible={state === "tiles"}
          />
          <Button variant="default" onClick={() => pressGenerate()} disabled={busy && !open} className="w-full gap-1.5">
            {busy && !open && <Loader2 className="size-3.5 animate-spin" />}
            {FORMATS.find((f) => f.id === format)?.id === "carousel" ? "יצירת קרוסלה עם AI" : "יצירה עם AI"}
          </Button>
        </div>

        {/* The format's card on the canvas, where the result lands. */}
        <div className="flex w-[220px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white p-4 dark:bg-gray-10">
          <span className="text-p-bold text-text-primary-default">{FORMATS.find((f) => f.id === format)?.label}</span>
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
          {sent && (sent.place > 0 || sent.looks > 0) && (
            // Review aid: what went to the generation — her pictures to put in, and look-only ones.
            <span className="text-xs text-text-neutral-default">
              נשלחו ליצירה: {sent.place} להכנסה כמו שהן · {sent.looks} להשראה
            </span>
          )}
        </div>
      </div>

      <div ref={panelRef}>
        {open && (
          <MediaAiChat
            key={`${format}-${state}`}
            postId={POST_ID}
            format={format}
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
