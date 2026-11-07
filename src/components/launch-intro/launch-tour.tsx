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
 *   A — spotlight: the page dims around the feature, a step counter
 *       ("2 מתוך 4"), the page waits until "הבנתי" or "דלגו".
 *   B — quiet: no dim, no counter, the page stays usable; the next feature
 *       is introduced when it scrolls into view.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getLaunchFeature, launchOrder, type LaunchFeature, type LaunchFeatureId } from "@/lib/launch-features"
import { useLaunchIntro, type LaunchVariant } from "./launch-intro-state"

const FIRST_STEP_DELAY_MS = 1200
const POLL_MS = 700

function visibleInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  if (getComputedStyle(el).visibility === "hidden") return false
  return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
}

function findAnchors(seen: LaunchFeatureId[]): { id: LaunchFeatureId; el: HTMLElement }[] {
  const out = new Map<LaunchFeatureId, HTMLElement>()
  document.querySelectorAll<HTMLElement>("[data-launch-anchor]").forEach((el) => {
    const id = el.dataset.launchAnchor as LaunchFeatureId
    if (seen.includes(id) || out.has(id) || !visibleInViewport(el)) return
    out.set(id, el)
  })
  return Array.from(out, ([id, el]) => ({ id, el })).sort((a, b) => launchOrder(a.id) - launchOrder(b.id))
}

export function LaunchTour() {
  const intro = useLaunchIntro()
  const [step, setStep] = useState<{ id: LaunchFeatureId; el: HTMLElement } | null>(null)
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
        if (cur && cur.el.isConnected && !seen.includes(cur.id)) return cur
        return anchors[0] ?? null
      })
    }
    tick()
    const iv = setInterval(tick, POLL_MS)
    return () => clearInterval(iv)
  }, [active, settled, seenKey])

  if (!step || !active) return null
  const feature = getLaunchFeature(step.id)
  const ack = () => {
    setDoneHere((n) => n + 1)
    setStep(null)
    intro.markSeen(step.id)
  }
  return (
    <TourStep
      key={step.id}
      variant={intro.variant}
      feature={feature}
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
  variant,
  feature,
  anchor,
  index,
  total,
  onAck,
  onSkip,
}: {
  variant: LaunchVariant
  feature: LaunchFeature
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
      {variant === "a" && <Spotlight el={anchor} />}
      <Popover open>
        <PopoverPrimitive.Anchor virtualRef={anchorRef} />
        <TourStepCard
          variant={variant}
          feature={feature}
          index={index}
          total={total}
          onAck={onAck}
          onSkip={onSkip}
          okRef={okRef}
        />
      </Popover>
    </>
  )
}

/** The popover body. Exported pieces stay in one place so A and B share it. */
function TourStepCard({
  variant,
  feature,
  index,
  total,
  onAck,
  onSkip,
  okRef,
}: {
  variant: LaunchVariant
  feature: LaunchFeature
  index: number
  total: number
  onAck: () => void
  onSkip: () => void
  okRef: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <PopoverContent
      dir="rtl"
      side="bottom"
      align="start"
      sideOffset={10}
      role="dialog"
      aria-label={feature.title}
      // A holds focus on "הבנתי"; B never steals focus from what she's doing.
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        if (variant === "a") okRef.current?.focus()
      }}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => {
        e.preventDefault()
        onAck()
      }}
      className={cn("z-[60] w-80", variant === "b" && "shadow-md")}
    >
      <PopoverPrimitive.Arrow className="fill-white dark:fill-gray-10" width={14} height={7} />
      <p className="text-xs-body text-text-neutral-default">
        {variant === "a" ? `חדש · ${index} מתוך ${total}` : "חדש"}
      </p>
      <p className="mt-1 text-p-bold text-text-primary-default">{feature.title}</p>
      {/* B's note beside the feature already says what changed — the step just points at it. */}
      <p className="mt-1 text-small text-text-neutral-default">
        {variant === "a" ? feature.body : "ההסבר נשאר כאן ליד, לשבועיים הקרובים."}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md px-1 text-xs-body text-text-neutral-default underline-offset-4 transition-colors hover:bg-gray-95 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 dark:hover:bg-gray-20"
        >
          {variant === "a" ? "דלגו על הסיור" : "בלי הסברים"}
        </button>
        <Button ref={okRef} type="button" size="sm" onClick={onAck}>
          הבנתי
        </Button>
      </div>
    </PopoverContent>
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
