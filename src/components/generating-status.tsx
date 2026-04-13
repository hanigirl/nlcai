"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

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
  intervalMs = 2800,
  className = "",
}: GeneratingStatusProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % messages.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [messages.length, intervalMs])

  return (
    <div className={`flex items-center justify-center gap-2 py-3 ${className}`}>
      <Loader2 className="size-4 animate-spin text-yellow-50 shrink-0" />
      <span
        key={index}
        className="text-small text-text-neutral-default animate-[fade-in_0.4s_ease-out]"
      >
        {messages[index]}
      </span>
    </div>
  )
}
