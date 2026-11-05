"use client"

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Merge, Scissors } from "lucide-react"
import { RichBodyEditor } from "@/components/rich-body-editor"
import { TooltipLabel } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  framesToScript,
  hasMarkedFrames,
  mergeWithNext,
  moveBoundary,
  splitFrame,
  storyFrames,
} from "@/lib/story-text-split"

/**
 * The story script, shown as the stories it will become (Hani, 2026-11-05).
 * The frames are EXACTLY what the generator makes (lib/story-text-split
 * storyFrames), and anything she changes is written back with the marker
 * lines ("סטורי 1"…) that the same split reads — so the card and the
 * generated story never disagree.
 *
 * REVIEW (joey/story-frame-split): two ways, behind `?variant=a|b` on
 * /project; with no param the card is the single text box it was.
 *   a — StoryFramesEditor: the text itself is written in one box per story.
 *   b — StoryFrameStrip: the text box stays as is, with a strip of the
 *       stories under it to see and adjust the split.
 */
export type StoryFramesVariant = "a" | "b"

/** The "is this split hers or ours?" line both variants show. */
function SplitNote({ value, count }: { value: string; count: number }) {
  const mine = hasMarkedFrames(value)
  return (
    <p className="text-xs-body text-text-neutral-default" aria-live="polite">
      {count === 0
        ? "עוד אין טקסט לסטורי."
        : mine
          ? `${count === 1 ? "סטורי אחד" : `${count} סטוריז`}, בחלוקה שלכם.`
          : `${count === 1 ? "סטורי אחד" : `${count} סטוריז`}, בחלוקה אוטומטית לפי הפסקאות והאורך. שינוי בחלוקה יישמר כחלוקה שלכם.`}
    </p>
  )
}

/** A small icon action in our grey hover (never yellow). */
function FrameAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <TooltipLabel label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-gray-95 hover:text-text-primary-default disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70"
      >
        {children}
      </button>
    </TooltipLabel>
  )
}

/** The boundary between two stories: pull a line up, merge, push a line down. */
function Boundary({
  frames,
  index,
  set,
  vertical,
}: {
  frames: string[]
  index: number
  set: (next: string[] | null) => void
  /** a: between stacked boxes (up / down); b: between cards in a row (right / left). */
  vertical: boolean
}) {
  const back = moveBoundary(frames, index, "back")
  const forward = moveBoundary(frames, index, "forward")
  return (
    <div className={cn("flex items-center justify-center gap-0.5", vertical ? "flex-row" : "flex-col self-center")}>
      <FrameAction label={`העברת שורה לסטורי ${index + 1}`} disabled={!back} onClick={() => set(back)}>
        {vertical ? <ChevronUp className="size-4" /> : <ChevronRight className="size-4" />}
      </FrameAction>
      <FrameAction label={`איחוד סטורי ${index + 1} ו-${index + 2}`} onClick={() => set(mergeWithNext(frames, index))}>
        <Merge className="size-4" />
      </FrameAction>
      <FrameAction label={`העברת שורה לסטורי ${index + 2}`} disabled={!forward} onClick={() => set(forward)}>
        {vertical ? <ChevronDown className="size-4" /> : <ChevronLeft className="size-4" />}
      </FrameAction>
    </div>
  )
}

/**
 * a — one box per story. She writes inside the stories; the split is the
 * shape of the card itself.
 */
export function StoryFramesEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  editorClassName,
}: {
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  /** The card's own text-box look, so a story box reads as the same editor. */
  editorClassName?: string
}) {
  const frames = storyFrames(value)
  const set = (next: string[] | null) => next && onChange(framesToScript(next))
  if (frames.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <RichBodyEditor value={value} onChange={onChange} onFocus={onFocus} onBlur={onBlur} className={editorClassName} />
        <SplitNote value={value} count={0} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="הסטוריז">
      {frames.map((text, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <span className="text-xs-body font-medium text-text-primary-default">סטורי {i + 1}</span>
            <span className="ms-auto">
              <FrameAction
                label={`פיצול סטורי ${i + 1} לשניים`}
                disabled={!splitFrame(frames, i)}
                onClick={() => set(splitFrame(frames, i))}
              >
                <Scissors className="size-4" />
              </FrameAction>
            </span>
          </div>
          <RichBodyEditor
            value={text}
            onChange={(t) => set(frames.map((f, j) => (j === i ? t : f)))}
            onFocus={onFocus}
            onBlur={onBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={editorClassName}
          />
          {i < frames.length - 1 && (
            <div className="flex items-center gap-2" aria-label={`הגבול בין סטורי ${i + 1} לסטורי ${i + 2}`}>
              <span className="h-px flex-1 border-t border-dashed border-border-neutral-default" />
              <Boundary frames={frames} index={i} set={set} vertical />
              <span className="h-px flex-1 border-t border-dashed border-border-neutral-default" />
            </div>
          )}
        </div>
      ))}
      <SplitNote value={value} count={frames.length} />
    </div>
  )
}

/**
 * b — the text box stays one box; under it, the stories it becomes, as small
 * 9:16 cards she can split, merge and shift. Typing "סטורי 2" on a line in
 * the box splits there too.
 */
export function StoryFrameStrip({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const frames = storyFrames(value)
  const set = (next: string[] | null) => next && onChange(framesToScript(next))
  if (frames.length === 0) return <SplitNote value={value} count={0} />
  return (
    <div className="flex flex-col gap-2">
      <SplitNote value={value} count={frames.length} />
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1" role="group" aria-label="הסטוריז">
        {frames.map((text, i) => (
          <div key={i} className="flex items-stretch gap-1">
            <div className="flex w-[104px] shrink-0 flex-col gap-1 rounded-lg border border-border-neutral-default bg-bg-surface p-1.5">
              <div className="flex items-center">
                <span className="text-[11px] font-medium text-text-primary-default">סטורי {i + 1}</span>
                <span className="ms-auto">
                  <FrameAction
                    label={`פיצול סטורי ${i + 1} לשניים`}
                    disabled={!splitFrame(frames, i)}
                    onClick={() => set(splitFrame(frames, i))}
                  >
                    <Scissors className="size-3.5" />
                  </FrameAction>
                </span>
              </div>
              <div className="aspect-[9/16] w-full overflow-hidden rounded-md bg-white p-1.5 dark:bg-gray-10">
                <p className="line-clamp-[12] whitespace-pre-line text-[10px] leading-snug text-text-primary-default">{text}</p>
              </div>
            </div>
            {i < frames.length - 1 && <Boundary frames={frames} index={i} set={set} vertical={false} />}
          </div>
        ))}
      </div>
    </div>
  )
}
