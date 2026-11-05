"use client"

/**
 * State preview — "think first, then generate" (Hani, 2026-11-05).
 *
 * The media panel's generate button opens the real AI panel (MediaAiChat) on
 * the question "your visual language, or a direction of your own?"; the
 * generation runs from there and the same panel carries on as the AI edit.
 *
 * The generation is a stub (a timer), and `fetch` is stubbed for the routes
 * the panel calls afterwards — nothing reaches the network: no credits, no DB
 * writes.
 *
 *   ?state=choose | brief | generating | done | error
 *   ?format=image_post | story | b_roll | carousel   (default image_post)
 *   ?style=brand | dark                               (default brand)
 */

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MediaAiChat, mediaChatKey, type AiEditFormat } from "@/components/media-ai-chat"
import { clearChat } from "@/lib/ai-chat-session-store"
import { openingId, requestAiEdit, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import type { MediaGenResult } from "@/lib/media-brief"

const POST_ID = "preview-generate-brief-post"
const SAMPLE = "/images/carousel-templates/ai-light.png"

const STATES = [
  { id: "choose", label: "הפאנל שואל איך ליצור" },
  { id: "brief", label: "כותבים כיוון משלכם" },
  { id: "generating", label: "בזמן יצירה" },
  { id: "done", label: "התוצאה + ממשיכים לערוך" },
  { id: "error", label: "שגיאה" },
] as const
type State = (typeof STATES)[number]["id"]

const FORMATS: { id: AiEditFormat; label: string; button: string }[] = [
  { id: "image_post", label: "פוסט תמונה", button: "יצירת תמונה עם AI" },
  { id: "story", label: "סטורי", button: "יצירת תמונה לסטורי עם AI" },
  { id: "b_roll", label: "בי-רול", button: "יצירת בי-רול עם AI" },
  { id: "carousel", label: "קרוסלה", button: "יצירת קרוסלה עם AI" },
]

const SAMPLE_BRIEF = "רקע לבן ונקי, הרבה אוויר, כותרת שחורה גדולה ובלי איורים"

/** Edits after the generation: a canned answer, so "continue editing" works too. */
function stubFetch() {
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
  window.fetch = ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/api/visual-language/style-memory")) return json({ ok: true, summary: "רקע לבן ונקי, בלי איורים" })
    if (url.includes("/api/media/ai-edit") || url.includes("/api/b-roll/edit"))
      return new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify({ urls: [SAMPLE], url: SAMPLE, remembered: null }), { status: 200 })), 900))
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
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "choose") as State
  const format = (FORMATS.find((f) => f.id === params.get("format"))?.id ?? "image_post") as AiEditFormat
  const brand = params.get("style") !== "dark"
  const [open, setOpen] = useState<AiEditFormat | null>(null)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useAiEditRequests((req) => {
    setOpen(req.format)
    setOpening(req.opening)
  })

  /** The media panel's generate button — opens the brief, as on /project. */
  const pressGenerate = () => {
    const run = (brief?: string): Promise<MediaGenResult> => {
      setBusy(true)
      return new Promise<MediaGenResult>((resolve) => {
        if (state === "generating") return // stays running
        setTimeout(() => {
          setBusy(false)
          if (state === "error") {
            resolve({ ok: false, message: "היצירה לא הצליחה: נגמר הקרדיט ב-OpenAI. אפשר להטעין קרדיט ולנסות שוב." })
            return
          }
          setResult(SAMPLE)
          void brief
          resolve({ ok: true })
        }, 1200)
      })
    }
    requestAiEdit({
      postId: POST_ID,
      format,
      opening: {
        id: openingId(),
        kind: "generate",
        styleName: brand ? "השפה הוויזואלית שלכם" : "כהה",
        isVisualLanguage: brand,
        run,
      },
    })
  }

  // Land on the state: clean conversation, press generate, then drive the panel.
  useEffect(() => {
    stubFetch()
    clearChat(mediaChatKey(POST_ID, format))
    setResult(null)
    setBusy(false)
    const t = setTimeout(pressGenerate, 400)
    return () => clearTimeout(t)
    // Once per state / format / style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, format, brand])

  // brief: she picked "יש לי כיוון משלי" and is typing (not sent yet).
  useEffect(() => {
    if (!opening || state !== "brief") return
    const t = setTimeout(() => {
      const root = panelRef.current
      if (!root) return
      const chip = (label: string) =>
        Array.from(root.querySelectorAll<HTMLButtonElement>('[data-slot="chip"]')).find((b) => b.textContent === label)
      chip("יש לי כיוון משלי")?.click()
      setTimeout(() => {
        const ta = root.querySelector("textarea")
        if (!ta) return
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, SAMPLE_BRIEF)
        ta.dispatchEvent(new Event("input", { bubbles: true }))
      }, 200)
    }, 120)
    return () => clearTimeout(t)
  }, [opening, state])

  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ state, format, ...(brand ? {} : { style: "dark" }), ...patch })
    if (q.get("style") === "brand") q.delete("style")
    return `/test/media-generate-brief?${q}`
  }
  const f = FORMATS.find((x) => x.id === format)!

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={href({ state: s.id })}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {FORMATS.map((x) => (
          <Link
            key={x.id}
            href={href({ format: x.id })}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              x.id === format ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {x.label}
          </Link>
        ))}
        <span className="text-text-neutral-default">·</span>
        <Link
          href={href({ style: brand ? "dark" : "brand" })}
          className="rounded-full border border-border-neutral-default px-2.5 py-1 text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
        >
          {brand ? "סגנון שנבחר: השפה הוויזואלית" : "סגנון שנבחר: כהה"}
        </Link>
      </div>

      {/* The media card on the canvas, where the result lands. */}
      <div className="flex w-[300px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white p-5 dark:bg-gray-10">
        <span className="text-p-bold text-text-primary-default">{f.label}</span>
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
        {/* The media panel's AI card button — on /project it lives in the left panel. */}
        <Button onClick={pressGenerate} disabled={busy} className="w-full gap-1.5">
          {f.button}
        </Button>
      </div>

      <div ref={panelRef}>
        {open && (
          <MediaAiChat
            key={state + format + brand}
            postId={POST_ID}
            format={open}
            open
            opening={opening}
            // generating / done / error: her brief, typed and sent.
            autoSend={["generating", "done", "error"].includes(state) ? SAMPLE_BRIEF : undefined}
            onOpenChange={(o) => {
              if (!o) {
                setOpen(null)
                setOpening(null)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
