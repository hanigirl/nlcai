"use client"

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/* ------------------------------------------------------------------ */
/*  ImageCaptionBlock — the post's words, laid over the user's picture  */
/* ------------------------------------------------------------------ */

/**
 * The grey band at the bottom of the media panel, for a still the user
 * brought themselves — now carrying the post's caption instead of a bare
 * photo (Hani, 2026-08-13).
 *
 * ONE component serves both design directions and both surfaces (the real
 * panel and the ?imgcap review links). The parts that are not in question —
 * the image frame, the loading state, the error state, the fall-back-to-the-
 * original affordance — are written once here; only the CONTROLS differ by
 * variant, which is exactly the difference being reviewed.
 *
 *   variant "a" · מוכן מיד — the caption is burned in on upload and the
 *     finished picture is what you see. One binary control underneath: keep
 *     the caption, or go back to the picture you brought. The mental model
 *     is "the app finished my image".
 *
 *   variant "b" · שכבת כיתוב — the caption is also generated on upload, but
 *     it stays something you place: on/off, three positions, and how much of
 *     the post's text it carries. The mental model is "the app gave me a
 *     caption I can put where I want".
 */

export type CaptionPosition = "top" | "center" | "bottom"
export type CaptionContent = "hook" | "hook_body"
export type CaptionState = "idle" | "captioning" | "error"

const POSITION_OPTIONS: Array<{ id: CaptionPosition; label: string }> = [
  { id: "top", label: "למעלה" },
  { id: "center", label: "באמצע" },
  { id: "bottom", label: "למטה" },
]

const CONTENT_OPTIONS: Array<{ id: CaptionContent; label: string }> = [
  { id: "hook", label: "הכותרת בלבד" },
  { id: "hook_body", label: "כותרת + טקסט" },
]

/**
 * Segmented picker on the project's own tokens.
 *
 * Deliberately not `components/ui/tabs`: that one is still on raw shadcn
 * theme colours (`bg-muted`, `text-foreground`), which CLAUDE.md rules out.
 * The selected treatment here is the same yellow ring the carousel template
 * tiles already use, so a selection reads the same everywhere in the panel.
 */
function SegmentedPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-text-neutral-default">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex gap-1.5">
        {options.map((o) => {
          const isSelected = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(o.id)}
              className={`flex-1 rounded-[10px] border px-2 py-1.5 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? "border-yellow-50 ring-1 ring-yellow-50 bg-bg-surface-primary-default text-text-primary-default"
                  : "border-border-neutral-default bg-white text-text-neutral-default hover:border-yellow-50 dark:bg-transparent dark:border-gray-30"
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface ImageCaptionBlockProps {
  variant: "a" | "b"
  /** "4/5" for a feed image post, "9/16" for a b-roll still. */
  aspect: "4/5" | "9/16"
  state: CaptionState
  errorMessage?: string | null
  /** The picture with the post's words on it. */
  captionedUrl: string | null
  /** The picture exactly as the user brought it. */
  originalUrl: string | null
  /** Whether the captioned version is the one the post uses. */
  captionOn: boolean
  onCaptionOnChange: (on: boolean) => void
  /** Variant B only. */
  position?: CaptionPosition
  onPositionChange?: (p: CaptionPosition) => void
  content?: CaptionContent
  onContentChange?: (c: CaptionContent) => void
  onRetry?: () => void
  /** Opens the picture full size. */
  onOpenLightbox?: (src: string) => void
}

export function ImageCaptionBlock({
  variant,
  aspect,
  state,
  errorMessage,
  captionedUrl,
  originalUrl,
  captionOn,
  onCaptionOnChange,
  position = "bottom",
  onPositionChange,
  content = "hook_body",
  onContentChange,
  onRetry,
  onOpenLightbox,
}: ImageCaptionBlockProps) {
  const busy = state === "captioning"
  // While a re-render is in flight the PREVIOUS picture stays on screen under
  // a spinner. Blanking it would make every control change in variant B
  // flash the panel empty, which reads as "I broke it" rather than
  // "it's redrawing".
  const shown = captionOn ? (captionedUrl ?? originalUrl) : originalUrl
  const frameWidth = aspect === "4/5" ? "w-[200px]" : "w-[160px]"
  const frameAspect = aspect === "4/5" ? "aspect-[4/5]" : "aspect-[9/16]"

  return (
    <div
      dir="rtl"
      className="-mx-6 -mb-6 mt-2 flex flex-col items-center gap-4 bg-gray-95 px-6 py-5 dark:bg-gray-10"
    >
      <p className="text-center text-xs text-text-neutral-default">
        התמונה שלך
      </p>

      {/* VARIANT B — the caption is a layer you place, so its controls come
          BEFORE the picture: you read what you can change, then watch the
          picture answer. In variant A there is nothing to set up, so the
          picture leads and its one control follows. */}
      {variant === "b" && (
        <div className="flex w-full max-w-[280px] flex-col gap-3 rounded-[14px] border border-border-neutral-default bg-white px-3.5 py-3 dark:bg-gray-10 dark:border-gray-30">
          <div className="flex items-center justify-between gap-2">
            <span className="text-small-bold text-text-primary-default">
              כיתוב על התמונה
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={captionOn}
              aria-label="כיתוב על התמונה"
              onClick={() => onCaptionOnChange(!captionOn)}
              className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                captionOn
                  ? "bg-button-primary-default"
                  : "bg-gray-90 dark:bg-gray-30"
              }`}
            >
              <span
                aria-hidden
                // RTL: the knob rests at the START (the right edge) when off
                // and travels away from it when on. `start-*`, never `left-*`
                // — this panel is mirrored.
                className={`absolute top-[3px] size-4 rounded-full bg-white transition-all ${
                  captionOn ? "start-[19px]" : "start-[3px]"
                }`}
              />
            </button>
          </div>

          <SegmentedPicker
            label="מיקום"
            options={POSITION_OPTIONS}
            value={position}
            onChange={(v) => onPositionChange?.(v)}
            disabled={!captionOn || busy}
          />
          <SegmentedPicker
            label="מה מופיע"
            options={CONTENT_OPTIONS}
            value={content}
            onChange={(v) => onContentChange?.(v)}
            disabled={!captionOn || busy}
          />
        </div>
      )}

      {/* The picture itself. */}
      <div className={`relative ${frameWidth} ${frameAspect}`}>
        {shown ? (
          <button
            type="button"
            onClick={() => shown && onOpenLightbox?.(shown)}
            aria-label="התמונה שלך — להגדלה"
            className="group relative block size-full overflow-hidden rounded-[10px] border border-border-neutral-default bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shown}
              alt="התמונה שלך"
              className="h-full w-full object-cover"
            />
            {busy && (
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center bg-gray-10/45"
              >
                <Loader2 className="size-6 animate-spin text-white" />
              </span>
            )}
          </button>
        ) : (
          <Skeleton className={`size-full rounded-[10px]`} />
        )}
      </div>

      {/* Progress — named, not a bare spinner. The user just pasted a link
          and something else started happening; it has to say what. */}
      {busy && (
        <p
          className="flex items-center gap-1.5 text-xs text-text-neutral-default"
          role="status"
        >
          <Loader2 className="size-3.5 animate-spin text-yellow-50" />
          מטמיעים את הכיתוב בתמונה...
        </p>
      )}

      {/* Error — the picture is already safe, so this says what failed and
          offers the retry, rather than reading as "your upload is gone". */}
      {state === "error" && (
        <div
          role="alert"
          className="flex w-full max-w-[280px] flex-col items-center gap-2 rounded-[12px] border border-border-neutral-default bg-white px-3.5 py-3 text-center dark:bg-gray-10 dark:border-gray-30"
        >
          {/* The red carries the icon, not the sentence. #F43D3D on white is
              ~3.4:1 — fine for a 16px glyph, short of AA for 12px prose — so
              the message itself is set in the primary text colour and the
              colour stops being the only thing saying "this failed". */}
          <AlertTriangle
            className="size-4 shrink-0 text-button-destructive-default"
            aria-hidden
          />
          <p className="text-xs text-text-primary-default">
            {errorMessage ?? "לא הצלחנו להטמיע את הכיתוב בתמונה."}
          </p>
          <p className="text-xs text-text-neutral-default">
            התמונה שלכם נשמרה — אפשר לנסות שוב.
          </p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              ניסיון חוזר
            </Button>
          )}
        </div>
      )}

      {/* VARIANT A — one binary choice, under the picture: the finished
          version or the one you brought. Nothing to configure. */}
      {variant === "a" && state !== "error" && (
        <div className="w-full max-w-[280px]">
          <SegmentedPicker
            label="גרסה שנשמרת לפוסט"
            options={[
              { id: "on" as const, label: "עם כיתוב" },
              { id: "off" as const, label: "בלי כיתוב" },
            ]}
            value={captionOn ? "on" : "off"}
            onChange={(v) => onCaptionOnChange(v === "on")}
            disabled={busy || !captionedUrl}
          />
        </div>
      )}
    </div>
  )
}
