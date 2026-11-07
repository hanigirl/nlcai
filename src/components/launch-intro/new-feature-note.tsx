"use client"

/**
 * "פיצ׳ר חדש" — the note that sits beside a new feature for NOTE_DAYS from the
 * user's first visit after launch. It is also the walkthrough's anchor for
 * that feature (`data-launch-anchor`), so a step can only appear where the
 * note is rendered — inside the feature's own (possibly gated) JSX.
 *
 *   A — a small pill: "חדש" + a play button. Marks; doesn't explain.
 *   B — a callout: "פיצ׳ר חדש" + one line on what changed + "להדגמה".
 *
 * "להדגמה" only shows when the feature has a video (lib/launch-features).
 */

import { useState } from "react"
import { Play, Sparkles } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getLaunchFeature, type LaunchFeature, type LaunchFeatureId } from "@/lib/launch-features"
import { useLaunchIntro, type LaunchVariant } from "./launch-intro-state"

/** Review only: `&demo=sample` gives every note a sample video so the demo popover can be seen. */
const SAMPLE_VIDEO = "/images/test/carousel-video-slide.mp4"

function useDemoVideo(feature: LaunchFeature, review: boolean): string | null {
  if (feature.video) return feature.video
  if (!review || typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("demo") === "sample" ? SAMPLE_VIDEO : null
}

interface NewFeatureNoteProps {
  feature: LaunchFeatureId
  className?: string
  /** Variant B only: drop the explanation line where there's no room. */
  compact?: boolean
}

export function NewFeatureNote({ feature: id, className, compact }: NewFeatureNoteProps) {
  const intro = useLaunchIntro()
  const feature = getLaunchFeature(id)
  const video = useDemoVideo(feature, intro.review)
  if (!intro.ready || !intro.notesOn) return null
  return (
    <NewFeatureNoteView
      feature={feature}
      variant={intro.variant}
      video={video}
      className={className}
      compact={compact}
    />
  )
}

/** Presentational — exported so a state can be rendered without the account. */
export function NewFeatureNoteView({
  feature,
  variant,
  video,
  className,
  compact,
  defaultDemoOpen,
}: {
  feature: LaunchFeature
  variant: LaunchVariant
  video: string | null
  className?: string
  compact?: boolean
  defaultDemoOpen?: boolean
}) {
  if (variant === "a") {
    return (
      <span
        data-launch-anchor={feature.id}
        dir="rtl"
        className={cn(
          "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border border-border-neutral-default bg-white ps-2 pe-1 text-xs-body text-text-primary-default dark:border-gray-30 dark:bg-gray-10",
          !video && "pe-2",
          className,
        )}
      >
        <Sparkles className="size-3 text-text-neutral-default" aria-hidden />
        <span>חדש</span>
        {video && (
          <DemoPopover feature={feature} video={video} defaultOpen={defaultDemoOpen}>
            <button
              type="button"
              aria-label={`הדגמה: ${feature.title}`}
              className="inline-flex size-4 items-center justify-center rounded-full bg-text-primary-default text-white transition-colors hover:bg-gray-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 dark:bg-gray-90 dark:text-gray-10 dark:hover:bg-gray-70"
            >
              <Play className="size-2.5 fill-current" aria-hidden />
            </button>
          </DemoPopover>
        )}
      </span>
    )
  }

  return (
    <div
      data-launch-anchor={feature.id}
      dir="rtl"
      className={cn(
        "flex w-fit max-w-full items-center gap-3 rounded-xl border border-border-neutral-default bg-bg-surface px-3 py-2 dark:border-gray-30 dark:bg-gray-20",
        className,
      )}
    >
      <Sparkles className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs-body font-semibold text-text-primary-default">פיצ׳ר חדש</p>
        {!compact && <p className="text-xs-body text-text-neutral-default">{feature.body}</p>}
      </div>
      {video && (
        <DemoPopover feature={feature} video={video} defaultOpen={defaultDemoOpen}>
          <Button type="button" variant="outline" size="xs" className="h-7 shrink-0 rounded-full px-3">
            <Play className="fill-current" aria-hidden />
            להדגמה
          </Button>
        </DemoPopover>
      )}
    </div>
  )
}

function DemoPopover({
  feature,
  video,
  children,
  defaultOpen,
}: {
  feature: LaunchFeature
  video: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [failed, setFailed] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent dir="rtl" side="bottom" align="start" className="w-[22rem] p-3">
        <p className="mb-2 text-small-bold text-text-primary-default">{feature.title}</p>
        {failed ? (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-bg-surface text-xs-body text-text-neutral-default">
            הסרטון לא נטען. נסו שוב מאוחר יותר.
          </div>
        ) : (
          <video
            key={video}
            src={video}
            poster={feature.poster ?? undefined}
            className="aspect-video w-full rounded-lg bg-gray-10 object-contain"
            controls
            autoPlay
            muted
            playsInline
            onError={() => setFailed(true)}
          />
        )}
        <p className="mt-2 text-xs-body text-text-neutral-default">{feature.body}</p>
      </PopoverContent>
    </Popover>
  )
}
