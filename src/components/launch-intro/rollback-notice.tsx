"use client"

/**
 * Notice under the home title for everyone (Figma 707:2259, Hani 2026-11-09):
 * the launch was rolled back, the new features are closed until the fix.
 * Same card and animated shader fill as the launch banner (blob 1 softer).
 * Takes the launch banner's place while the launch is closed.
 */

import { ShaderFill } from "@/lib/shader-runtime"
import {
  setup as setupRadSoup,
  render as renderRadSoup,
  manifest as manifestRadSoup,
} from "@/lib/custom-effects/CodeComponentId_1374e20473c87adfac24ad91cd3360e455871dd6_1525"

// Module-level so the shader's identity is stable across renders.
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
    blob1: { r: 1, g: 0.8999000787734985, b: 0.6620905995368958, a: 0.20000000298023224 },
    bounciness: 60,
    blur: 100,
    blobScale: 140,
  },
}

export function RollbackNotice({ className }: { className?: string }) {
  return (
    <div
      dir="rtl"
      role="status"
      className={`relative flex w-full items-center gap-4 overflow-hidden rounded-[12px] p-6 ${className ?? ""}`}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[12px]">
        <div className="absolute inset-0 rounded-[12px] bg-gray-98" />
        <ShaderFill className="absolute rounded-[12px]" shader={RAD_SOUP} />
      </div>
      {/* The "oops" picture on the right (Figma 709:2265), cropped as in the design. */}
      <div aria-hidden className="relative h-24 w-[88px] shrink-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/launch/rollback-oops.png"
          alt=""
          className="absolute left-[-14.29%] top-[-11.4%] h-[121.05%] w-[131.43%] max-w-none"
        />
      </div>
      <div className="relative flex min-w-0 flex-col items-start gap-[7px] text-right text-[14px]">
        <p className="font-semibold leading-6 text-text-primary-default">
          האפליקציה תקבל שדרוג ותתעדכן בקרוב!
        </p>
        <p className="leading-[1.4] text-[#475568]">
          אנו נודיע על תאריך השקה מחודש ביום חמישי 12.11 כדי שתוכלו להנות ממש בקרוב מכל השדרוגים החדשים
        </p>
      </div>
    </div>
  )
}
