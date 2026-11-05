"use client"

/**
 * State preview — the carousel panel's "בחרו טמפלט" (Hani, 2026-11-05).
 *
 * 1. The grid is the media style picker's 2×2: חדש לגמרי + השפה הוויזואלית
 *    שלך on top, the niche dark + light below — identical 4:5 tiles, labels
 *    aligned (it was a ragged 3-column grid of different shapes).
 * 2. "עריכה עם AI" (✨) is always shown on the picked tile, not only on
 *    hover. Before there is a carousel it opens the AI panel on the question
 *    in the picked style — also while a carousel is being drawn.
 *
 * The real grid (CarouselTemplateGrid) and the real AI panel (MediaAiChat).
 * Generation is a stub and `fetch` is stubbed — no credits, no DB writes.
 *
 *   ?state=grid | ask | generating | ask-while-generating | no-brand
 */

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CarouselTemplateGrid } from "@/components/media-panel"
import { MediaAiChat, mediaChatKey } from "@/components/media-ai-chat"
import { clearChat } from "@/lib/ai-chat-session-store"
import { openingId, requestAiEdit, useAiEditRequests, type AiEditOpening } from "@/lib/ai-edit-intent"
import {
  BLANK_TEMPLATE,
  BLANK_TEMPLATE_ID,
  BRAND_TEMPLATE_ID,
  CAROUSEL_TEMPLATES,
  buildBrandTemplate,
} from "@/lib/carousel-templates"
import type { MediaGenResult } from "@/lib/media-brief"
import type { MediaStyle } from "@/lib/visual-language/types"

const POST_ID = "preview-carousel-grid-post"
const BRAND = buildBrandTemplate({ thumbnailUrl: "/images/carousel-templates/ai-amber.png" })

const STATES = [
  { id: "grid", label: "הגריד 2×2 + ✨ על הנבחר" },
  { id: "ask", label: "✨ — השאלה בשפה שלך" },
  { id: "generating", label: "בזמן ציור הקרוסלה" },
  { id: "ask-while-generating", label: "✨ בזמן שהקרוסלה מצוירת" },
  { id: "no-brand", label: "בלי שפה ויזואלית (3 אריחים)" },
] as const
type State = (typeof STATES)[number]["id"]

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}

function Preview() {
  const params = useSearchParams()
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "grid") as State
  const withBrand = state !== "no-brand"
  const templates = useMemo(
    () => [BLANK_TEMPLATE, ...(withBrand ? [BRAND] : []), ...CAROUSEL_TEMPLATES],
    [withBrand],
  )
  const [selected, setSelected] = useState<string>(withBrand ? BRAND_TEMPLATE_ID : "ai-dark")
  const [generating, setGenerating] = useState(false)
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState<AiEditOpening | null>(null)

  useAiEditRequests((req) => {
    setOpen(true)
    setOpening(req.opening)
  })

  const styleOf = (id: string): MediaStyle =>
    id === BLANK_TEMPLATE_ID ? "blank" : id === BRAND_TEMPLATE_ID ? "brand" : id === "ai-dark" || id === "ai-light" ? id : "niche"

  /** A stub generation that never lands — nothing is drawn or saved. */
  const fakeGenerate = (): Promise<MediaGenResult> => new Promise<MediaGenResult>(() => setGenerating(true))

  const pressAiEdit = (id: string = selected) =>
    requestAiEdit({
      postId: POST_ID,
      format: "carousel",
      opening: { id: openingId(), kind: "generate", run: () => fakeGenerate(), style: styleOf(id), fromEdit: true, placeRefs: true },
    })

  useEffect(() => {
    window.fetch = (() => Promise.reject(new Error("preview: network disabled"))) as typeof fetch
    clearChat(mediaChatKey(POST_ID, "carousel"))
    const first = withBrand ? BRAND_TEMPLATE_ID : "ai-dark"
    setSelected(first)
    setOpen(false)
    setOpening(null)
    setGenerating(state === "generating" || state === "ask-while-generating")
    if (state === "ask" || state === "ask-while-generating") {
      const t = setTimeout(() => pressAiEdit(first), 400)
      return () => clearTimeout(t)
    }
    // Once per state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={`/test/carousel-template-grid?state=${s.id}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {/* The carousel media panel's body, as on the canvas (panel width). */}
      <div className="flex w-[400px] flex-col gap-5 rounded-[20px] border border-border-neutral-default bg-white p-6 dark:bg-gray-10">
        <div className="flex flex-col gap-2">
          <p className="text-small-bold text-text-primary-default">בחרו טמפלט</p>
          <CarouselTemplateGrid
            templates={templates}
            selected={selected}
            onSelect={setSelected}
            previewOf={() => undefined}
            isCurrent={() => false}
            onAiEdit={() => pressAiEdit()}
          />
        </div>
        <Button onClick={() => setGenerating(true)} disabled={generating} className="w-full gap-2">
          {generating ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              מציירים עם AI... כמה דקות
            </>
          ) : (
            "יצירת קרוסלה עם AI"
          )}
        </Button>
      </div>

      {open && (
        <MediaAiChat
          key={state}
          postId={POST_ID}
          format="carousel"
          open
          opening={opening}
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
