"use client"

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  type MouseEvent,
  type WheelEvent,
} from "react"
import { Minus, Plus, Maximize } from "lucide-react"
import { Button } from "@/components/ui/button"

interface InfiniteCanvasProps {
  children: ReactNode
}

export function InfiniteCanvas({ children }: InfiniteCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(0.9)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

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
        setIsPanning(true)
        setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
      }
    },
    [offset]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isPanning) return
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    },
    [isPanning, panStart]
  )

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
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
          }}
        >
          {children}
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0 rounded-2xl bg-white dark:bg-gray-10 shadow-md border border-border-neutral-default">
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
