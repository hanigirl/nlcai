"use client"

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  type ReactNode,
  type Ref,
  type MouseEvent,
  type WheelEvent,
} from "react"
import { Minus, Plus, Maximize } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface InfiniteCanvasHandle {
  /**
   * Glide the canvas so `el` sits in the middle of the view. The canvas pans
   * with a transform, so the browser's own `scrollIntoView` does nothing
   * here — anything that wants to show the user a card has to ask the canvas.
   */
  focusOn: (el: HTMLElement, opts?: FocusOptions) => void
}

export interface FocusOptions {
  /**
   * "follow": for the canvas following work as it is made. Centres the card
   * horizontally, moves vertically only as far as needed to bring it into
   * view, and does nothing while the user is moving the canvas herself (a pan
   * in progress, or a drag / wheel in the last moment) — it never fights her.
   */
  mode?: "centre" | "follow"
}

/** How long after her last drag / wheel the canvas counts as "hers". */
const USER_IDLE_MS = 1200

interface InfiniteCanvasProps {
  children: ReactNode
  handleRef?: Ref<InfiniteCanvasHandle>
}

/** How long a programmatic glide takes; hand panning stays instant. */
const FOCUS_MS = 450

export function InfiniteCanvas({ children, handleRef }: InfiniteCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(0.9)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [gliding, setGliding] = useState(false)
  const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panningRef = useRef(false)
  const lastUserMoveAt = useRef(0)
  const markUserMove = () => { lastUserMoveAt.current = Date.now() }

  useImperativeHandle(handleRef, () => ({
    focusOn: (el, opts) => {
      const view = containerRef.current?.getBoundingClientRect()
      if (!view) return
      const follow = opts?.mode === "follow"
      if (follow && (panningRef.current || Date.now() - lastUserMoveAt.current < USER_IDLE_MS)) return
      const box = el.getBoundingClientRect()
      // Centre it; a card taller than the view keeps its top in sight instead.
      const dx = view.left + view.width / 2 - (box.left + box.width / 2)
      let dy =
        box.height > view.height * 0.8
          ? view.top + 80 - box.top
          : view.top + view.height / 2 - (box.top + box.height / 2)
      if (follow) {
        // Lanes run sideways: keep the row where it is unless the card's top
        // is out of sight, and then bring it just inside the view.
        // The canvas element can run taller than the window; what she sees
        // ends at the window's bottom edge.
        const top = Math.max(view.top, 0)
        const bottom = Math.min(view.bottom, window.innerHeight)
        const margin = 80
        if (box.top >= top + margin && box.top <= bottom - margin * 2) dy = 0
        else dy = top + margin - box.top
        if (Math.abs(dx) < 4 && dy === 0) return
      }
      setGliding(true)
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
      if (glideTimer.current) clearTimeout(glideTimer.current)
      glideTimer.current = setTimeout(() => setGliding(false), FOCUS_MS)
    },
  }), [])

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      // Don't pan when interacting with form elements or elements that opt out
      const target = e.target as HTMLElement
      if (
        target.closest("textarea, input, select, [data-no-pan], [contenteditable]") ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.tagName === "SELECT"
      ) {
        return
      }
      if (e.button === 0 || e.button === 1) {
        panningRef.current = true
        markUserMove()
        setIsPanning(true)
        setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
      }
    },
    [offset]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isPanning) return
      markUserMove()
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    },
    [isPanning, panStart]
  )

  const handleMouseUp = useCallback(() => {
    if (panningRef.current) markUserMove()
    panningRef.current = false
    setIsPanning(false)
  }, [])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      markUserMove()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.05 : 0.05
        setScale((s) => Math.min(2, Math.max(0.2, s + delta)))
      } else {
        setOffset((o) => ({
          x: o.x - e.deltaX,
          y: o.y - e.deltaY,
        }))
      }
    },
    []
  )

  // Prevent default scroll on the canvas container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const prevent = (e: globalThis.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    el.addEventListener("wheel", prevent, { passive: false })
    return () => el.removeEventListener("wheel", prevent)
  }, [])

  const zoomIn = () => setScale((s) => Math.min(2, s + 0.1))
  const zoomOut = () => setScale((s) => Math.max(0.2, s - 0.1))
  const fitToScreen = () => {
    setScale(0.9)
    setOffset({ x: 0, y: 0 })
  }

  const dotSize = 0.8
  const dotSpacing = 20 * scale
  const dotOffsetX = (offset.x % dotSpacing + dotSpacing) % dotSpacing
  const dotOffsetY = (offset.y % dotSpacing + dotSpacing) % dotSpacing

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{
          backgroundColor: "var(--canvas-bg, #f7f7f7)",
          backgroundImage: `radial-gradient(circle, var(--canvas-dot, #d9d9d9) ${dotSize}px, transparent ${dotSize}px)`,
          backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
          backgroundPosition: `${dotOffsetX}px ${dotOffsetY}px`,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "0 0",
            transition: gliding ? `transform ${FOCUS_MS}ms ease-out` : undefined,
          }}
        >
          {children}
        </div>
      </div>

      {/* Zoom controls — floating, fixed to viewport */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0 rounded-2xl bg-white dark:bg-gray-10 shadow-md border border-border-neutral-default">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-l-none rounded-r-2xl h-[45px] w-[47px]"
          onClick={zoomOut}
        >
          <Minus className="size-5" />
        </Button>
        <div className="flex h-[45px] w-[71px] items-center justify-center border-x border-border-neutral-default">
          <span className="text-small text-text-neutral-default">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-none h-[45px] w-[47px]"
          onClick={zoomIn}
        >
          <Plus className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-r-none rounded-l-2xl h-[45px] w-[45px] border-l border-border-neutral-default"
          onClick={fitToScreen}
        >
          <Maximize className="size-4" />
        </Button>
      </div>
    </div>
  )
}
