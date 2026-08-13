"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Image as ImageIcon, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ImageCaptionBlock,
  type CaptionContent,
  type CaptionPosition,
  type CaptionState,
} from "@/components/image-caption-block"

/* ------------------------------------------------------------------ */
/*  Review harness for the two caption directions (?imgcap=a|b)        */
/* ------------------------------------------------------------------ */

/**
 * Lands straight on the thing being reviewed.
 *
 * The real panel needs a saved post, a format variant, a Drive round trip and
 * a Storage write before it can show a captioned picture — none of which a
 * reviewer should have to walk through, and one of which (the flow that makes
 * a post) costs credits. So this mounts the SAME `ImageCaptionBlock` the real
 * panel mounts, inside the same 400px rail, seeded with a sample picture and
 * sample post text.
 *
 * Everything here is free and inert:
 *   · the only request it makes is `preview: true` to the caption renderer,
 *     which reads no table, writes no table, writes no file and calls no
 *     paid API — it takes bytes and text in and hands a PNG back;
 *   · the picture is either one shipped in /public or one the reviewer picks
 *     from their own machine, read in the browser and never uploaded.
 *
 * The state row at the top is review-only: it forces the states the caption
 * can be in, so error and in-progress can be looked at without having to make
 * them happen.
 */

/** Sample post text — the lines a real image_post variant would carry. */
const SAMPLE_HOOK = "העיצוב שלכם נראה ׳בסדר׳ אבל לא מקצועי"
const SAMPLE_BODY =
  "יש 4 פרטים קטנים שמפרידים בין עבודה חובבנית לעבודה שנראית יקרה — וכולם בשליטה שלכם."

const SAMPLES: Array<{ id: string; label: string; file: string }> = [
  { id: "photo", label: "תמונה מהטלפון", file: "sample-photo.jpg" },
  { id: "light", label: "עיצוב בהיר מקנבה", file: "sample-light.jpg" },
]

const REVIEW_STATES: Array<{ id: CaptionState; label: string }> = [
  { id: "idle", label: "רגיל" },
  { id: "captioning", label: "מטמיעים כיתוב" },
  { id: "error", label: "שגיאה" },
]

async function toBase64(blobOrFile: Blob): Promise<string> {
  const buf = await blobOrFile.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function ImageCaptionReview({
  variant,
  format,
  onClose,
}: {
  variant: "a" | "b"
  format: "image_post" | "b_roll"
  onClose: () => void
}) {
  const aspect = format === "image_post" ? "4/5" : "9/16"

  const [forcedState, setForcedState] = useState<CaptionState>("idle")
  // Either a shipped sample (rendered from disk, server side) or bytes the
  // reviewer picked off their own machine. Exactly one of the two is set.
  const [sample, setSample] = useState<string | null>(SAMPLES[0].file)
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [captionedUrl, setCaptionedUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [captionOn, setCaptionOn] = useState(true)
  const [position, setPosition] = useState<CaptionPosition>("bottom")
  const [content, setContent] = useState<CaptionContent>("hook_body")
  const fileRef = useRef<HTMLInputElement>(null)

  const render = useCallback(async () => {
    setRendering(true)
    try {
      const res = await fetch("/api/media/caption-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preview: true,
          format,
          position,
          content,
          sample: sample ?? undefined,
          imageBase64: uploadedBase64 ?? undefined,
          hook: SAMPLE_HOOK,
          bodyText: SAMPLE_BODY,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        image?: string
        original?: string
      }
      if (data.image) setCaptionedUrl(`data:image/png;base64,${data.image}`)
      // A sample comes back with its own bytes; an upload we already hold.
      if (data.original) setOriginalUrl(`data:image/jpeg;base64,${data.original}`)
      else if (uploadedBase64) {
        setOriginalUrl(`data:image/*;base64,${uploadedBase64}`)
      }
    } finally {
      setRendering(false)
    }
  }, [sample, uploadedBase64, format, position, content])

  // Re-render whenever the picture or the caption settings change — which is
  // exactly the behaviour variant B ships.
  useEffect(() => {
    void render()
  }, [render])

  const state: CaptionState =
    forcedState !== "idle" ? forcedState : rendering ? "captioning" : "idle"

  return (
    <div
      dir="rtl"
      className="fixed left-0 top-14 bottom-0 z-30 w-[400px] overflow-y-auto border-r border-border-neutral-default bg-white dark:bg-gray-10"
    >
      {/* Panel header — the real one, so the block is judged in its frame. */}
      <div className="flex items-center justify-between border-b border-border-neutral-default px-6 py-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="size-4 text-text-primary-default" />
          <span className="text-p-bold text-text-primary-default">
            {format === "image_post" ? "פוסט תמונה" : "בי-רול"}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="סגירה"
          className="rounded-lg p-1 transition-colors hover:bg-bg-surface"
        >
          <X className="size-4 text-text-neutral-default" />
        </button>
      </div>

      <div className="px-6 py-6">
        {/* Review-only controls. Not part of either design — they exist so
            the states can be looked at without having to cause them. */}
        <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-dashed border-border-neutral-default bg-bg-surface px-3.5 py-3">
          <p className="text-xs-body text-text-neutral-default">
            מסך סקירה — הצעה {variant === "a" ? "א׳" : "ב׳"}. לא נשמר כלום,
            לא נגבים קרדיטים.
          </p>
          <div className="flex gap-1.5">
            {REVIEW_STATES.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setForcedState(st.id)}
                aria-pressed={forcedState === st.id}
                className={`flex-1 rounded-[10px] border px-2 py-1.5 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                  forcedState === st.id
                    ? "border-yellow-50 bg-bg-surface-primary-default text-text-primary-default ring-1 ring-yellow-50"
                    : "border-border-neutral-default bg-white text-text-neutral-default hover:border-yellow-50 dark:border-gray-30 dark:bg-transparent"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {SAMPLES.map((sm) => (
              <button
                key={sm.id}
                type="button"
                onClick={() => {
                  setSample(sm.file)
                  setUploadedBase64(null)
                }}
                aria-pressed={sample === sm.file}
                className={`flex-1 rounded-[10px] border px-2 py-1.5 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                  sample === sm.file
                    ? "border-yellow-50 bg-bg-surface-primary-default text-text-primary-default ring-1 ring-yellow-50"
                    : "border-border-neutral-default bg-white text-text-neutral-default hover:border-yellow-50 dark:border-gray-30 dark:bg-transparent"
                }`}
              >
                {sm.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-3.5" />
            תמונה מהמחשב שלכם
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setSample(null)
              setUploadedBase64(await toBase64(file))
            }}
          />
        </div>

        {/* THE THING BEING REVIEWED — the same component the panel mounts. */}
        <ImageCaptionBlock
          variant={variant}
          aspect={aspect}
          state={state}
          errorMessage="הקובץ בדרייב כבר לא משותף, אז לא הצלחנו להטמיע את הכיתוב."
          captionedUrl={captionedUrl}
          originalUrl={originalUrl}
          captionOn={captionOn}
          onCaptionOnChange={setCaptionOn}
          position={position}
          onPositionChange={setPosition}
          content={content}
          onContentChange={setContent}
          onRetry={() => {
            setForcedState("idle")
            void render()
          }}
        />
      </div>
    </div>
  )
}
