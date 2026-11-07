"use client"

/**
 * The launch walkthrough. Mounted once in AppShell, so it runs on every page.
 *
 * It doesn't know the pages: it looks for the "פיצ׳ר חדש" notes on screen
 * (`[data-launch-anchor]`, rendered by NewFeatureNote inside each feature's
 * own JSX) and walks through the ones the user hasn't acknowledged yet, in
 * the order of lib/launch-features. A feature that isn't on screen — another
 * page, a closed panel, an email gate — simply isn't a step here. Each "הבנתי"
 * is saved per feature, so every feature is introduced exactly once, on the
 * first screen where the user meets it.
 *
 * The page dims around the tag, the card counts the steps on this screen
 * ("2 מתוך 4"), and the page waits until "הבנתי" or "דלגו על הסיור". A spot
 * that holds several features is one step; its card is the same carousel as
 * the tag's, and "הבנתי" marks every feature in it as seen.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { getLaunchFeature, launchOrder, type LaunchFeature, type LaunchFeatureId } from "@/lib/launch-features"
import { FeatureCarousel, NewTag } from "./new-feature-note"
import { useLaunchIntro } from "./launch-intro-state"

const FIRST_STEP_DELAY_MS = 1200
const POLL_MS = 700

function visibleInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  if (getComputedStyle(el).visibility === "hidden") return false
  return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
}

function findAnchors(seen: LaunchFeatureId[]): Spot[] {
  const out = new Map<string, Spot>()
  document.querySelectorAll<HTMLElement>("[data-launch-anchor]").forEach((el) => {
    const raw = el.dataset.launchAnchor ?? ""
    const ids = raw.split(",").filter(Boolean) as LaunchFeatureId[]
    // A spot is still a step while any of its features is unseen.
    if (!ids.some((id) => !seen.includes(id)) || out.has(raw) || !visibleInViewport(el)) return
    out.set(raw, { key: raw, ids, el })
  })
  const first = (s: Spot) => Math.min(...s.ids.map(launchOrder))
  return Array.from(out.values()).sort((a, b) => first(a) - first(b))
}

interface Spot {
  key: string
  ids: LaunchFeatureId[]
  el: HTMLElement
}

export function LaunchTour() {
  const intro = useLaunchIntro()
  const [step, setStep] = useState<Spot | null>(null)
  const [settled, setSettled] = useState(false)
  // Steps acknowledged on this screen — for A's "N מתוך M".
  const [doneHere, setDoneHere] = useState(0)
  const [remaining, setRemaining] = useState(0)

  const seenKey = intro.state.seen.join(",")
  const active = intro.ready && intro.tourOn

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => setSettled(true), FIRST_STEP_DELAY_MS)
    return () => clearTimeout(t)
  }, [active])

  useEffect(() => {
    if (!active || !settled) return
    const seen = seenKey ? (seenKey.split(",") as LaunchFeatureId[]) : []
    const tick = () => {
      const anchors = findAnchors(seen)
      setRemaining(anchors.length)
      setStep((cur) => {
        if (cur && cur.el.isConnected && cur.ids.some((id) => !seen.includes(id))) return cur
        return anchors[0] ?? null
      })
    }
    tick()
    const iv = setInterval(tick, POLL_MS)
    return () => clearInterval(iv)
  }, [active, settled, seenKey])

  if (!step || !active) return null
  const ack = () => {
    setDoneHere((n) => n + 1)
    setStep(null)
    // "הבנתי" on a shared spot covers every feature in it.
    intro.markSeen(step.ids)
  }
  return (
    <TourStep
      key={step.key}
      review={intro.review}
      features={step.ids.map(getLaunchFeature)}
      anchor={step.el}
      index={doneHere + 1}
      total={doneHere + Math.max(remaining, 1)}
      onAck={ack}
      onSkip={() => {
        setStep(null)
        intro.skipAll()
      }}
    />
  )
}

function TourStep({
  review,
  features,
  anchor,
  index,
  total,
  onAck,
  onSkip,
}: {
  review: boolean
  features: LaunchFeature[]
  anchor: HTMLElement
  index: number
  total: number
  onAck: () => void
  onSkip: () => void
}) {
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor])
  const okRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Spotlight el={anchor} />
      <Popover open>
        <PopoverPrimitive.Anchor virtualRef={anchorRef} />
        <PopoverContent
          dir="rtl"
          side="bottom"
          align="start"
          sideOffset={10}
          role="dialog"
          aria-label={features.map((f) => f.title).join(", ")}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            okRef.current?.focus()
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            onAck()
          }}
          className="z-[60] w-80"
        >
          <PopoverPrimitive.Arrow className="fill-white dark:fill-gray-10" width={14} height={7} />
          <div className="mb-2 flex items-center gap-2">
            <NewTag />
            <span className="text-xs-body text-text-neutral-default">
              {index} מתוך {total}
            </span>
          </div>
          <FeatureCarousel features={features} review={review} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-1 text-xs-body text-text-neutral-default transition-colors hover:bg-gray-95 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 dark:hover:bg-gray-20"
            >
              דלגו על הסיור
            </button>
            <Button ref={okRef} type="button" size="sm" onClick={onAck}>
              הבנתי
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

/** Dims the page around the anchor and blocks clicks behind the step (A only). */
function Spotlight({ el }: { el: HTMLElement }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setRect(el.getBoundingClientRect())
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [el])
  if (!rect) return null
  const pad = 6
  return (
    <div className="fixed inset-0 z-[55]" aria-hidden>
      <div
        className="pointer-events-none fixed rounded-xl shadow-[0_0_0_9999px_rgb(0_0_0/0.4)] transition-[top,left,width,height] duration-200"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }}
      />
    </div>
  )
}
