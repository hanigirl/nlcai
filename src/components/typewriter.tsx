"use client"

import { useState, useEffect, useCallback } from "react"

const TYPEWRITER_PHRASES = [
  "איך רזיתי 15 קילו ב 5 ימים",
  "3 שיטות לגרום לכל בחורה לא להוריד ממך את העיניים",
  "תפסיקו לעזור לילדים שלכם לצחצח שיניים",
  "הטעות הכי גדולה שעשיתי בקריירה שלי",
  "למה אני לא משתמש יותר בפיגמה",
  "הפסקתי לקרוא ספרים וזה מה שקרה",
]

interface TypewriterProps {
  className?: string
}

export function Typewriter({ className }: TypewriterProps) {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [text, setText] = useState("")

  const tick = useCallback(() => {
    const currentPhrase = TYPEWRITER_PHRASES[phraseIndex]

    if (!isDeleting) {
      setText(currentPhrase.substring(0, charIndex + 1))
      setCharIndex((prev) => prev + 1)

      if (charIndex + 1 === currentPhrase.length) {
        setTimeout(() => setIsDeleting(true), 2000)
        return
      }
    } else {
      setText(currentPhrase.substring(0, charIndex - 1))
      setCharIndex((prev) => prev - 1)

      if (charIndex - 1 === 0) {
        setIsDeleting(false)
        setPhraseIndex((prev) => (prev + 1) % TYPEWRITER_PHRASES.length)
        return
      }
    }
  }, [charIndex, isDeleting, phraseIndex])

  useEffect(() => {
    const speed = isDeleting ? 30 : 50
    const timer = setTimeout(tick, speed)
    return () => clearTimeout(timer)
  }, [tick, isDeleting])

  return (
    <p className={className}>
      {text}
      <span className="animate-pulse">|</span>
    </p>
  )
}
