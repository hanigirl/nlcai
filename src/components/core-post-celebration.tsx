"use client"

import { useEffect, useRef, useState } from "react"
import confetti from "canvas-confetti"

interface CorePostCelebrationProps {
  /** Increment to retrigger the celebration. Initial value of 0 is treated as
      "never fired" so loading an existing post on mount doesn't celebrate. */
  trigger: number
}

const CONFETTI_COLORS = [
  "#FFC300", // yellow-50 (brand)
  "#FFCF33", // yellow-60
  "#FFDB66", // yellow-70
  "#FFE799", // yellow-80
  "#332700", // yellow-10 (dark accent)
]

/* Tied to .paper-plane-celebrate / .paper-plane-rotor in globals.css.
   Keep ANIMATION_DURATION_MS in sync with the keyframe duration. */
const ANIMATION_DURATION_MS = 1600
/* ~25% — plane has just finished fading in and is mid-spin. Confetti
   bursts above so it's airborne while the loader-spin completes. */
const CONFETTI_DELAY_MS = 400

export function CorePostCelebration({ trigger }: CorePostCelebrationProps) {
  const planeRef = useRef<HTMLImageElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (trigger === 0) return
    setIsPlaying(true)

    const confettiTimer = setTimeout(() => {
      // Anchor confetti to the STABLE card wrapper (two levels up:
      // img → celebration (orbiting) → stable wrapper). The orbit
      // element's rect moves; we need a non-animated ancestor for a
      // fixed origin. Origin sits ~30px above the card top so the
      // particles fall down toward the orbiting plane.
      const stable = planeRef.current?.parentElement?.parentElement
      const rect = stable?.getBoundingClientRect()
      const origin = rect
        ? {
            x: (rect.left + rect.width / 2) / window.innerWidth,
            y: Math.max(0.04, (rect.top - 30) / window.innerHeight),
          }
        : { x: 0.5, y: 0.18 }
      confetti({
        particleCount: 90,
        spread: 80,
        startVelocity: 38,
        scalar: 0.9,
        origin,
        colors: CONFETTI_COLORS,
      })
    }, CONFETTI_DELAY_MS)

    const endTimer = setTimeout(() => setIsPlaying(false), ANIMATION_DURATION_MS)
    return () => {
      clearTimeout(confettiTimer)
      clearTimeout(endTimer)
    }
  }, [trigger])

  if (!isPlaying) return null

  return (
    <div className="paper-plane-celebrate" aria-hidden>
      <img
        ref={planeRef}
        src="/images/letter-min.png"
        alt=""
        className="block size-[72px]"
      />
    </div>
  )
}
