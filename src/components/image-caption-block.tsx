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
 * The caption is generated on upload and stays something you place: on/off
 * and three positions. The mental model is "the app gave me a caption I can
 * put where I want".
 *
 * It always carries the post's FULL text (Hani, 2026-08-13) — there is no
 * headline-only mode. Half a caption is not a placement decision, it is a
 * different post, and the words on the picture have to match the words in
 * the post everywhere else in the product.
 */

export type CaptionPosition = "top" | "center" | "bottom"
export type CaptionState = "idle" | "captioning" | "error"

const POSITION_OPTIONS: Array<{ id: CaptionPosition; label: string }> = [
  { id: "top", label: "למעלה" },
  { id: "center", label: "באמצע" },
  { id: "bottom", label: "למטה" },
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
                  : "border-border-neutral-default bg-white text-text-neutral-default hover:border-gray-80 dark:bg-transparent dark:border-gray-30"
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

/**
 * The whole caption control, and deliberately the whole of it: a switch for
 * with / without, then the word "מיקום", then the three placements. Nothing
 * else (Hani, 2026-08-13) — no explainer, no heading beyond its own name.
 *
 * Exported because the carousel needs the SAME card, not a second one that
 * resembles it. A slide the user brought is captioned by the same renderer as
 * a feed image, so "is there a caption, and where does it sit" has to be one
 * decision, worded and drawn identically wherever it is asked. Two copies
 * would drift the first time either was touched.
 */
export function CaptionControls({
  label,
  captionOn,
  onCaptionOnChange,
  position,
  onPositionChange,
  busy,
  progress,
}: {
  /** Names what carries the caption — "כיתוב על התמונה" / "...על השקופיות". */
  label: string
  captionOn: boolean
  onCaptionOnChange: (on: boolean) => void
  position: CaptionPosition
  onPositionChange: (p: CaptionPosition) => void
  /** A render is in flight: the controls lock, nothing is hidden. */
  busy?: boolean
  /** Named progress, shown under the controls while `busy`. */
  progress?: React.ReactNode
}) {
  return (
    <div className="flex w-full max-w-[280px] flex-col gap-3 rounded-[14px] border border-border-neutral-default bg-white px-3.5 py-3 dark:bg-gray-10 dark:border-gray-30">
      <div className="flex items-center justify-between gap-2">
        <span className="text-small-bold text-text-primary-default">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={captionOn}
          aria-label={label}
          onClick={() => onCaptionOnChange(!captionOn)}
          className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
            captionOn ? "bg-button-primary-default" : "bg-gray-90 dark:bg-gray-30"
          }`}
        >
          <span
            aria-hidden
            // RTL: the knob rests at the START (the right edge) when off and
            // travels away from it when on. `start-*`, never `left-*` — this
            // panel is mirrored.
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
        onChange={onPositionChange}
        disabled={!captionOn || busy}
      />

      {busy && progress}
    </div>
  )
}

export interface ImageCaptionBlockProps {
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
  position?: CaptionPosition
  onPositionChange?: (p: CaptionPosition) => void
  onRetry?: () => void
  /** Opens the picture full size. */
  onOpenLightbox?: (src: string) => void
}

export function ImageCaptionBlock({
  aspect,
  state,
  errorMessage,
  captionedUrl,
  originalUrl,
  captionOn,
  onCaptionOnChange,
  position = "bottom",
  onPositionChange,
  onRetry,
  onOpenLightbox,
}: ImageCaptionBlockProps) {
  const busy = state === "captioning"
  // While a re-render is in flight the PREVIOUS picture stays on screen under
  // a spinner. Blanking it would make every control change flash the panel
  // empty, which reads as "I broke it" rather than "it's redrawing".
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

      {/* The caption is a layer you place, so its controls come BEFORE the
          picture: you read what you can change, then watch the picture
          answer. */}
      <CaptionControls
        label="כיתוב על התמונה"
        captionOn={captionOn}
        onCaptionOnChange={onCaptionOnChange}
        position={position}
        onPositionChange={(v) => onPositionChange?.(v)}
        busy={busy}
      />

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

    </div>
  )
}
