"use client"

import { NewFeatureNote } from "@/components/launch-intro/new-feature-note"
import { useState } from "react"
import { ImageIcon, Play, X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { cn } from "@/lib/utils"

/**
 * The carousel's slide slots in the AI panel (Hani, 2026-11-06: "תן למשתמש
 * להחליט מתי הוא רוצה סרטון"). As soon as she attaches media — a picture or
 * a video, from her computer or from Drive — the composer shows one slot per
 * slide: what she attached sits in its slot, the rest are empty placeholders.
 *
 *   - An empty slot is marked AI: that slide is made by the AI.
 *   - Clicking an empty slot points there: the next file she attaches goes in.
 *   - Dragging moves media between slots (onto a filled one: they swap).
 *   - On send, each filled slot becomes exactly that slide; empty slots are
 *     made by the AI as usual. The slide count never changes.
 *
 * Pure view: MediaAiChat owns which attachment is in which slot.
 */
export function CarouselSlideSlots({
  slots,
  videos,
  target,
  aiEmpty = true,
  onPick,
  onMove,
  onRemove,
  disabled,
}: {
  /** One entry per slide: the attachment's preview in it, or null. */
  slots: (string | null)[]
  /** Previews that stand for a video (shown with a play mark). */
  videos: string[]
  /** The empty slot she pointed at — the next attachment goes there. */
  target: number | null
  /** An empty slot is made by AI (false on her own carousel: it keeps her slide). */
  aiEmpty?: boolean
  onPick: (slot: number) => void
  onMove: (from: number, to: number) => void
  onRemove: (slot: number) => void
  disabled?: boolean
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  if (!slots.length) return null
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <NewFeatureNote feature="carousel-video" compact />
      <p className="text-xs-body text-text-neutral-default">
        {target !== null
          ? `הקובץ הבא שתצרפו ייכנס לשקופית ${target + 1}.`
          : slots.some((x) => !x)
            ? "לחצו על שקופית ריקה כדי לבחור לאן ייכנס הקובץ הבא, או גררו בין השקופיות."
            : "גררו בין השקופיות כדי להחליף מקום."}
      </p>
      <ol className="flex gap-1.5" aria-label="השקופיות בקרוסלה">
        {slots.map((src, i) => {
          const isVideo = !!src && videos.includes(src)
          const isTarget = target === i && !src
          return (
            <li
              key={i}
              className="relative w-11 shrink-0"
              onDragOver={(e) => {
                if (dragFrom === null || disabled) return
                e.preventDefault()
                setOver(i)
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i)
                setDragFrom(null)
                setOver(null)
              }}
            >
              {src ? (
                <div
                  draggable={!disabled}
                  onDragStart={(e) => {
                    setDragFrom(i)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setOver(null)
                  }}
                  aria-label={`שקופית ${i + 1}: ${isVideo ? "סרטון" : "תמונה"} שצירפתם`}
                  className={cn(
                    "relative aspect-[4/5] w-full cursor-grab overflow-hidden rounded-md border border-border-neutral-default active:cursor-grabbing",
                    over === i && "ring-2 ring-gray-80",
                    dragFrom === i && "opacity-50",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="size-full object-cover" draggable={false} />
                  {isVideo && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex size-5 items-center justify-center rounded-full bg-black/60 text-white">
                        <Play className="size-2.5 fill-current" aria-hidden />
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    disabled={disabled}
                    aria-label={`הסרה משקופית ${i + 1}`}
                    className="absolute end-0.5 top-0.5 inline-flex size-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  disabled={disabled}
                  aria-pressed={isTarget}
                  aria-label={`שקופית ${i + 1}, ריקה${aiEmpty ? " — תיווצר עם AI" : ""}. בחירה כמקום לקובץ הבא`}
                  className={cn(
                    "flex aspect-[4/5] w-full flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-gray-80 bg-bg-surface text-text-neutral-default transition-colors hover:bg-gray-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 dark:hover:bg-gray-20",
                    isTarget && "border-solid border-yellow-50 ring-2 ring-yellow-50",
                    over === i && "bg-gray-95 dark:bg-gray-20",
                  )}
                >
                  {/* Empty = made by AI (Hani, 2026-11-06) — no confirming needed. */}
                  {aiEmpty ? (
                    <>
                      <AiSparkle className="size-3.5" />
                      <span className="text-xs-body font-medium leading-none text-text-neutral-default" aria-hidden>
                        AI
                      </span>
                    </>
                  ) : (
                    <ImageIcon className="size-3.5" aria-hidden />
                  )}
                </button>
              )}
              <span className="mt-0.5 block text-center text-xs-body tabular-nums text-text-neutral-default">{i + 1}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
