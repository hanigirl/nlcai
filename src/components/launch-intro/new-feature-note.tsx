"use client"

/**
 * "פיצ׳ר חדש" — the yellow "חדש" tag beside new features, for NOTE_DAYS from
 * the user's first visit after launch. Clicking it opens a card with what
 * changed and, when the feature has one, its demo video ("להדגמה").
 *
 * The tag is also the walkthrough's anchor (`data-launch-anchor`), so a step
 * can only appear where the tag is rendered — inside the feature's own
 * (possibly gated) JSX.
 *
 * One spot, one tag (Hani, 2026-11-08): when several new features live in
 * the same place, the tag takes them all and its card is a carousel
 * (‹ › + "1/2"), each slide with its own title, line and video.
 */

import { brandTerms } from "@/lib/brand-terms"
import { useQaFixes1112 } from "@/lib/use-scheduling-access"
import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getLaunchFeature, type LaunchFeature, type LaunchFeatureId } from "@/lib/launch-features"
import { useLaunchIntro } from "./launch-intro-state"

/** Review only: `&demo=sample` gives every feature a sample video so the demo can be seen. */
const SAMPLE_VIDEO = "/images/test/carousel-video-slide.mp4"

export function demoVideoFor(feature: LaunchFeature, review: boolean): string | null {
  if (feature.video) return feature.video
  if (!review || typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("demo") === "sample" ? SAMPLE_VIDEO : null
}

/** The anchor attribute: one or more feature ids, comma-separated. */
export function anchorValue(ids: LaunchFeatureId[]): string {
  return ids.join(",")
}

interface NewFeatureNoteProps {
  /** One feature, or every new feature that lives in this spot. */
  feature: LaunchFeatureId | LaunchFeatureId[]
  className?: string
}

export function NewFeatureNote({ feature, className }: NewFeatureNoteProps) {
  const intro = useLaunchIntro()
  const ids = (Array.isArray(feature) ? feature : [feature]).filter(Boolean)
  if (!intro.ready || !intro.notesOn || ids.length === 0) return null
  return (
    <NewFeatureNoteView
      features={ids.map(getLaunchFeature)}
      review={intro.review}
      className={className}
    />
  )
}

/** The yellow "חדש" tag — the same in A and B, light and dark. */
export function NewTag({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center rounded-full bg-yellow-50 px-2.5 text-xs-body font-semibold text-yellow-10",
        className,
      )}
      {...props}
    >
      חדש
    </span>
  )
}

export function NewFeatureNoteView({
  features,
  review,
  className,
}: {
  features: LaunchFeature[]
  review: boolean
  className?: string
}) {
  const ids = features.map((f) => f.id)
  const label = `חדש: ${features.map((f) => f.title).join(", ")}`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-launch-anchor={anchorValue(ids)}
          aria-label={label}
          className={cn(
            "w-fit shrink-0 rounded-full transition-shadow hover:ring-2 hover:ring-gray-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 dark:hover:ring-gray-40",
            className,
          )}
        >
          <NewTag />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" side="bottom" align="start" className="w-80 p-4">
        <FeatureCarousel features={features} review={review} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The features of one spot, one at a time. Used by the tag's card and by the
 * walkthrough step, so both switch the same way. The demo video plays by
 * default, and switching features plays the next one right away (Hani,
 * 2026-11-08): no "להדגמה" click.
 */
export function FeatureCarousel({ features, review }: { features: LaunchFeature[]; review: boolean }) {
  const [i, setI] = useState(0)
  const qaTerms = useQaFixes1112() === true
  const f = features[Math.min(i, features.length - 1)]
  const video = demoVideoFor(f, review)
  const many = features.length > 1
  const go = (next: number) => {
    setI((next + features.length) % features.length)
  }
  const arrow =
    "inline-flex size-6 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-gray-95 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 dark:hover:bg-gray-20"

  return (
    <div dir="rtl" className="flex flex-col">
      <div aria-live="polite">
        <p className="text-p-bold text-text-primary-default">{brandTerms(f.title, qaTerms)}</p>
        <p className="mt-0.5 text-small text-text-neutral-default">{brandTerms(f.body, qaTerms)}</p>
      </div>

      {video && <DemoVideo key={video} feature={f} video={video} className="mt-3" />}

      {many && (
        <div className="mt-3 flex items-center gap-2">
          {many && (
            <div className="flex items-center gap-0.5" role="group" aria-label="מעבר בין החידושים">
              <button type="button" onClick={() => go(i - 1)} aria-label="החידוש הקודם" className={arrow}>
                <ChevronRight className="size-4" aria-hidden />
              </button>
              <span className="min-w-7 text-center text-xs-body tabular-nums text-text-neutral-default" dir="ltr">
                {i + 1}/{features.length}
              </span>
              <button type="button" onClick={() => go(i + 1)} aria-label="החידוש הבא" className={arrow}>
                <ChevronLeft className="size-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DemoVideo({ feature, video, className }: { feature: LaunchFeature; video: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div
        className={cn(
          "flex aspect-video w-full items-center justify-center rounded-lg bg-bg-surface text-xs-body text-text-neutral-default",
          className,
        )}
      >
        הסרטון לא נטען. נסו שוב מאוחר יותר.
      </div>
    )
  }
  return (
    <video
      key={video}
      src={video}
      poster={feature.poster ?? undefined}
      aria-label={`הדגמה: ${feature.title}`}
      className={cn("aspect-video w-full rounded-lg bg-gray-10 object-contain", className)}
      controls
      autoPlay
      loop
      muted
      playsInline
      onError={() => setFailed(true)}
    />
  )
}
