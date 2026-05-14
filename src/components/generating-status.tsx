"use client"

import { useEffect, useState } from "react"

interface GeneratingStatusProps {
  messages?: string[]
  intervalMs?: number
  className?: string
  /**
   * Trailing line under the cycling message. Three modes:
   *   - omitted (`undefined`) → render the default "תהליך זה יכול לקחת מספר דקות"
   *   - `null` → hide the subtitle entirely (used for fast loads like the
   *     calendar's "checking posts ready to schedule" cycle, where the
   *     legacy "minutes" copy would lie about duration)
   *   - any `string` → render as-is
   */
  subtitle?: string | null
}

const DEFAULT_MESSAGES = [
  "מנתח את קהל היעד...",
  "מחפש תבניות ויראליות...",
  "משפר את שפת הכתיבה...",
  "בודק רעיונות שאהבת...",
  "משייף את ההוקים...",
]

const DEFAULT_SUBTITLE = "תהליך זה יכול לקחת מספר דקות"

export function GeneratingStatus({
  messages = DEFAULT_MESSAGES,
  intervalMs = 2500,
  className = "",
  subtitle,
}: GeneratingStatusProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), intervalMs)
    return () => clearInterval(id)
  }, [messages.length, intervalMs])

  const resolvedSubtitle = subtitle === undefined ? DEFAULT_SUBTITLE : subtitle

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <p
        key={index}
        className="text-small text-text-primary-default animate-in fade-in duration-300"
      >
        {messages[index]}
      </p>
      {resolvedSubtitle !== null && (
        <p className="text-xs-body text-text-neutral-default">
          {resolvedSubtitle}
        </p>
      )}
    </div>
  )
}
