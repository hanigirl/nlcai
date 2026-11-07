"use client"

import { forwardRef, useImperativeHandle, useRef, useState } from "react"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A <video> that reads as a video at rest: a large play button over it while
 * it's paused (Hani, 2026-11-08: the play button should be visible from the
 * start, not only after a click). The native control bar stays for seeking.
 *
 * The overlay is a real <button>: on a canvas card (MediaPreviewZone) a click
 * on it plays — the zone leaves buttons alone — while a click elsewhere on the
 * picture still opens the media panel.
 */
export const VideoWithPlay = forwardRef<
  HTMLVideoElement,
  React.VideoHTMLAttributes<HTMLVideoElement> & { wrapperClassName?: string; playLabel?: string }
>(function VideoWithPlay({ wrapperClassName, playLabel = "הפעלת הסרטון", onPlay, onPause, onEnded, ...video }, ref) {
  const inner = useRef<HTMLVideoElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLVideoElement)
  const [paused, setPaused] = useState(true)
  return (
    <div className={cn("relative size-full", wrapperClassName)}>
      <video
        ref={inner}
        {...video}
        onPlay={(e) => {
          setPaused(false)
          onPlay?.(e)
        }}
        onPause={(e) => {
          setPaused(true)
          onPause?.(e)
        }}
        onEnded={(e) => {
          setPaused(true)
          onEnded?.(e)
        }}
      />
      {paused && (
        <button
          type="button"
          aria-label={playLabel}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            void inner.current?.play()
          }}
          className="absolute left-1/2 top-1/2 z-10 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 shadow-lg backdrop-blur-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <Play className="size-6 fill-white text-white ms-0.5" aria-hidden />
        </button>
      )}
    </div>
  )
})
