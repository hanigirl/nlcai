"use client"

import { useEffect, useState } from "react"

interface GeneratingStatusProps {
  messages?: string[]
  intervalMs?: number
  className?: string
}

const DEFAULT_MESSAGES = [
  "מנתח את הקהל...",
  "בודק סגנון כתיבה...",
  "מחפש תבניות חזקות...",
  "בודק זוויות לתכני חימום...",
  "כותב הוקים בשפת הקהל...",
  "מסיים נגיעות אחרונות...",
]

export function GeneratingStatus({
  messages = DEFAULT_MESSAGES,
  intervalMs = 2500,
  className = "",
}: GeneratingStatusProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), intervalMs)
    return () => clearInterval(id)
  }, [messages.length, intervalMs])

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <p
        key={index}
        className="text-small text-text-primary-default animate-in fade-in duration-300"
      >
        {messages[index]}
      </p>
      <p className="text-xs-body text-text-neutral-default">
        תהליך זה יכול לקחת מספר דקות
      </p>
    </div>
  )
}
