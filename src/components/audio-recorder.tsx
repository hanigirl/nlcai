"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"

interface AudioRecorderProps {
  onRecorded: (blob: Blob) => void
}

export function AudioRecorder({ onRecorded }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [hasRecording, setHasRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(blob))
        setHasRecording(true)
        onRecorded(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      setHasRecording(false)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
      setError(null)

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1)
      }, 1000)
    } catch {
      setError("לא ניתן לגשת למיקרופון. אנא אפשר גישה.")
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <p className="text-button-destructive-default text-sm">{error}</p>
      )}

      {/* Mic button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        className={`relative size-24 rounded-full flex items-center justify-center transition-all ${
          isRecording
            ? "bg-button-destructive-default text-white scale-110"
            : "bg-button-primary-default text-white hover:bg-button-primary-hover hover:scale-105"
        }`}
      >
        {isRecording && (
          <span className="absolute inset-0 rounded-full bg-button-destructive-default/30 animate-ping" />
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-10"
        >
          {isRecording ? (
            <rect x="6" y="6" width="12" height="12" rx="2" />
          ) : (
            <>
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </>
          )}
        </svg>
      </button>

      {/* Timer / Instructions */}
      {isRecording ? (
        <div className="text-center">
          <p className="text-xl font-mono font-bold text-button-destructive-default">
            {formatTime(recordingTime)}
          </p>
          <p className="text-sm text-text-neutral-default mt-1">
            מקליט... לחץ לעצירה
          </p>
        </div>
      ) : (
        <p className="text-text-neutral-default text-center text-sm">
          {hasRecording
            ? "ההקלטה נשמרה. אפשר להאזין או להקליט מחדש."
            : "לחץ על המיקרופון כדי להתחיל הקלטה"}
        </p>
      )}

      {/* Playback */}
      {audioUrl && !isRecording && (
        <div className="w-full max-w-sm">
          <audio src={audioUrl} controls className="w-full" />
        </div>
      )}

      {/* Re-record */}
      {hasRecording && !isRecording && (
        <Button variant="outline" size="sm" onClick={startRecording}>
          הקלט מחדש
        </Button>
      )}
    </div>
  )
}
