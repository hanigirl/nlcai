"use client"

/**
 * StoryPlayer — plays a story frame set the way Instagram plays it, so the
 * preview answers the question the user actually has: "what will my audience
 * see, and for how long?" A static image with prev/next arrows can't answer
 * that. This auto-advances on Instagram's real clock.
 *
 * Timing (Hani, 2026-07-28 — "ממש כאילו אני באינסטגרם"):
 *   - An image frame holds for IMAGE_FRAME_MS (5s), Instagram's fixed image
 *     duration.
 *   - A video frame runs for its own length, capped at MAX_VIDEO_SEGMENT_MS
 *     (15s) — Instagram splits anything longer across segments, and a preview
 *     that ran a 60s clip in one bar would misrepresent the post.
 *
 * Interaction, also mirroring Instagram:
 *   - Press and hold anywhere pauses; release resumes. This is how people
 *     read a frame they didn't finish.
 *   - Tap the right side to go forward, the left side to go back. Forward is
 *     RIGHT because the app is Hebrew/RTL and that's the reading direction —
 *     the opposite of an LTR Instagram.
 *   - The bar row is laid out LTR-in-DOM but rendered RTL so bar 1 sits on
 *     the right, matching the tap direction.
 *   - At the end it stops on the last frame and offers replay, rather than
 *     looping forever (a silent loop makes it hard to tell the set ended).
 *
 * The progress bars are driven by requestAnimationFrame against a wall-clock
 * start stamp, NOT by a CSS animation or an interval counter. Intervals drift
 * and CSS animations can't be paused mid-frame and resumed at the same offset
 * without restarting — both would break "exactly the seconds".
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react"

/** Instagram holds a still image for 5 seconds. */
const IMAGE_FRAME_MS = 5000

/** Instagram's per-segment ceiling for video. */
const MAX_VIDEO_SEGMENT_MS = 15000

/** Frames arrive either as storage URLs or as raw base64 straight from a generation. */
export function storyFrameSrc(frame: string): string {
  return frame.startsWith("http") || frame.startsWith("data:")
    ? frame
    : `data:image/png;base64,${frame}`
}

function isVideoFrame(frame: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(frame)
}

export type StoryPlayerProps = {
  /** Ordered frames — storage URLs or base64 PNG payloads. */
  frames: string[]
  /** Start playing on mount. Off for surfaces where autoplay would surprise. */
  autoPlay?: boolean
  /** Extra classes for the 9:16 stage (width is the caller's decision). */
  className?: string
}

export function StoryPlayer({
  frames,
  autoPlay = true,
  className = "",
}: StoryPlayerProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [finished, setFinished] = useState(false)
  /** 0..1 fill of the CURRENT frame's bar. */
  const [progress, setProgress] = useState(0)
  /**
   * A video's real length, once its metadata loads. Null means "not measured
   * yet" and the derived `frameMs` below falls back to the cap, so the bar
   * re-scales when the true duration lands instead of jumping.
   */
  const [measuredVideoMs, setMeasuredVideoMs] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  /** Wall-clock ms already elapsed on this frame, preserved across pauses. */
  const elapsedRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const frame = frames[Math.min(index, frames.length - 1)]
  const isVideo = !!frame && isVideoFrame(frame)
  const isLast = index >= frames.length - 1

  // How long the frame on screen should hold. Derived — an effect that synced
  // this on every index change was both redundant and a cascading render.
  const frameMs = isVideo
    ? (measuredVideoMs ?? MAX_VIDEO_SEGMENT_MS)
    : IMAGE_FRAME_MS

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return
      if (next >= frames.length) {
        // Park on the last frame, fully filled, and wait for replay.
        setIndex(frames.length - 1)
        setProgress(1)
        setPlaying(false)
        setFinished(true)
        return
      }
      // Reset the clock here rather than in an effect keyed on `index`:
      // this is the only path that changes frames, so it's the honest place
      // for it, and it keeps render free of state syncing.
      elapsedRef.current = 0
      setProgress(0)
      setMeasuredVideoMs(null)
      setFinished(false)
      setIndex(next)
    },
    [frames.length],
  )

  // The clock. One rAF loop, started when playing and torn down when not —
  // so a paused player costs nothing.
  useEffect(() => {
    if (!playing || frames.length === 0) return
    // Resume from wherever the frame was paused, not from zero.
    const start = performance.now() - elapsedRef.current

    const tick = (now: number) => {
      const elapsed = now - start
      elapsedRef.current = elapsed
      const ratio = frameMs > 0 ? Math.min(1, elapsed / frameMs) : 1
      setProgress(ratio)
      if (ratio >= 1) {
        goTo(index + 1)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      // `elapsedRef` already holds the exact offset (tick writes it every
      // frame), so a pause resumes mid-frame instead of restarting it.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing, index, frameMs, frames.length, goTo])

  // Keep the <video> element in step with our own play/pause state.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (playing) void v.play().catch(() => {})
    else v.pause()
  }, [playing, index])

  const replay = () => {
    elapsedRef.current = 0
    setProgress(0)
    setMeasuredVideoMs(null)
    setFinished(false)
    setIndex(0)
    setPlaying(true)
  }

  // Press-and-hold to pause. Kept off the nav buttons so a tap on a chevron
  // isn't also read as a hold.
  const holdPausedRef = useRef(false)
  const onHoldStart = () => {
    if (!playing) return
    holdPausedRef.current = true
    setPlaying(false)
  }
  const onHoldEnd = () => {
    if (!holdPausedRef.current) return
    holdPausedRef.current = false
    if (!finished) setPlaying(true)
  }

  if (frames.length === 0) return null

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-gray-10 select-none ${className}`}
      onPointerDown={onHoldStart}
      onPointerUp={onHoldEnd}
      onPointerLeave={onHoldEnd}
      // The canvas behind this pans on drag; keep both to ourselves.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Frame ------------------------------------------------------- */}
      {isVideo ? (
        <video
          ref={videoRef}
          src={frame}
          className="h-full w-full object-cover"
          playsInline
          muted
          preload="metadata"
          onLoadedMetadata={(e) => {
            const secs = e.currentTarget.duration
            if (Number.isFinite(secs) && secs > 0) {
              setMeasuredVideoMs(Math.min(secs * 1000, MAX_VIDEO_SEGMENT_MS))
            }
          }}
          onEnded={() => goTo(index + 1)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={storyFrameSrc(frame)}
          alt={`פריים ${index + 1} מתוך ${frames.length}`}
          className="h-full w-full object-cover"
          draggable={false}
        />
      )}

      {/* Progress bars — one per frame, newest fill on the current one.
          `flex-row-reverse` puts frame 1 on the right so the bars advance in
          the same direction as the tap-forward zone. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-row-reverse gap-1 p-2">
        {frames.map((_, i) => (
          <div
            key={i}
            className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35"
          >
            <div
              className="h-full rounded-full bg-white"
              style={{
                width:
                  i < index ? "100%" : i === index ? `${progress * 100}%` : "0%",
                // Only the live bar animates; the rest snap, so seeking
                // backwards doesn't play a rewind animation.
                transition: i === index ? "none" : "width 120ms linear",
              }}
            />
          </div>
        ))}
      </div>

      {/* Tap zones. RIGHT advances — Hebrew reads right-to-left, so forward
          is rightward here, mirrored from an LTR Instagram. */}
      <button
        type="button"
        aria-label="הפריים הבא"
        onClick={() => (isLast ? goTo(frames.length) : goTo(index + 1))}
        className="group absolute inset-y-0 right-0 flex w-1/3 items-center justify-start pr-2 focus-visible:outline-none"
      >
        <ChevronRight className="size-5 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-80" />
      </button>
      <button
        type="button"
        aria-label="הפריים הקודם"
        onClick={() => goTo(Math.max(0, index - 1))}
        disabled={index === 0}
        className="group absolute inset-y-0 left-0 flex w-1/3 items-center justify-end pl-2 focus-visible:outline-none disabled:cursor-default"
      >
        <ChevronLeft className="size-5 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-80" />
      </button>

      {/* Transport — play / pause, or replay once the set has run out. */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => (finished ? replay() : setPlaying((p) => !p))}
          aria-label={finished ? "צפייה מחדש" : playing ? "השהייה" : "ניגון"}
          className="flex size-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {finished ? (
            <RotateCcw className="size-3.5" />
          ) : playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </button>
        <span className="rounded-full bg-black/45 px-2 py-0.5 text-xs tabular-nums text-white backdrop-blur">
          {index + 1}/{frames.length}
        </span>
      </div>
    </div>
  )
}
