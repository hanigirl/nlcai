"use client"

/**
 * Launch banner under the home title (Figma 702:1705, Hani 2026-11-08):
 * "מהיום האפליקציה עובדת מקצה לקצה!" on an animated shader fill, with a link
 * that opens a modal playing the edited video of all 15 launch features.
 * Shown while the launch notes are live for this user (useLaunchIntro).
 */

import { useState } from "react"
import { Play, X } from "lucide-react"
import { ShaderFill } from "@/lib/shader-runtime"
import {
  setup as setupRadSoup,
  render as renderRadSoup,
  manifest as manifestRadSoup,
} from "@/lib/custom-effects/CodeComponentId_1374e20473c87adfac24ad91cd3360e455871dd6_1525"
import { Dialog, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { useLaunchIntro } from "./launch-intro-state"

/** The 15 demo videos cut together (HyperFrames, ~3 min). */
const ALL_FEATURES_VIDEO = "/launch/all-features.mp4"

// Module-level so the shader's identity is stable across renders (the runtime
// re-runs setup when it changes).
const RAD_SOUP = {
  setup: setupRadSoup,
  render: renderRadSoup,
  manifest: manifestRadSoup,
  params: {
    seed: 18,
    blob3: { r: 0.7877561450004578, g: 0.9217740893363953, b: 0.9792104959487915, a: 1 },
    blob2: { r: 0.9044222235679626, g: 0.9375346302986145, b: 0.9495755434036255, a: 1 },
    blob4: { r: 0.9822903871536255, g: 0.9610389471054077, b: 0.943329393863678, a: 1 },
    collisions: false,
    interactionStrength: 56,
    drift: 100,
    paletteRandomize: 0,
    background: { r: 0.9725490212440491, g: 0.9803921580314636, b: 0.9882352948188782, a: 1 },
    blob1: { r: 1, g: 0.8999000787734985, b: 0.6620905995368958, a: 1 },
    bounciness: 60,
    blur: 100,
    blobScale: 140,
  },
}

export function LaunchBanner({ className }: { className?: string }) {
  const { notesOn } = useLaunchIntro()
  const [open, setOpen] = useState(false)
  if (!notesOn) return null

  return (
    <>
      <div
        dir="rtl"
        className={`relative flex w-full flex-col items-start gap-[7px] overflow-hidden rounded-[12px] p-6 ${className ?? ""}`}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[12px]">
          <div className="absolute inset-0 rounded-[12px] bg-gray-98" />
          <ShaderFill className="absolute rounded-[12px]" shader={RAD_SOUP} />
        </div>
        <p className="relative w-full text-right text-[16px] font-semibold leading-6 text-text-primary-default">
          מהיום האפליקציה עובדת מקצה לקצה!
        </p>
        {/* Body + "להדגמה" on one row, the link at the left end (Hani, 2026-11-08). */}
        <div className="relative flex w-full items-end gap-4">
          <p className="flex-1 text-right text-[16px] leading-6 text-text-neutral-default">
            עיקר החידושים עוסקים בהפעלת המערכת כמקום אחד בו הכל קורה: כתיבה, יצירת מדיה ותזמון לכל הרשתות
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="להדגמה של כל החידושים"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-[14px] font-medium leading-6 text-text-primary-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 cursor-pointer"
          >
            להדגמה
            <Play className="size-3.5 fill-current" aria-hidden />
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-w-[min(92vw,1100px)] sm:max-w-[min(92vw,1100px)] gap-0 overflow-hidden p-0" dir="rtl">
          <DialogTitle className="sr-only">כל החידושים</DialogTitle>
          {/* X on the left (Hani). */}
          <DialogClose
            aria-label="סגירה"
            className="absolute left-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-text-primary-default shadow-sm transition-colors hover:bg-gray-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 cursor-pointer"
          >
            <X className="size-4" aria-hidden />
          </DialogClose>
          <video
            src={ALL_FEATURES_VIDEO}
            className="aspect-video w-full bg-gray-10"
            controls
            autoPlay
            muted
            playsInline
            aria-label="סרטון הדגמה של כל החידושים"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
