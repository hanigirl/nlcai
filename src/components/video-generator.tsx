"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import type { Avatar } from "@/components/avatar-picker"

interface VideoGeneratorProps {
  avatar: Avatar
  audioBlob: Blob
  onStartOver: () => void
}

export function VideoGenerator({ avatar, audioBlob, onStartOver }: VideoGeneratorProps) {
  const [phase, setPhase] = useState<"idle" | "generating" | "done">("idle")
  const [progress, setProgress] = useState("")
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pollVideoStatus = useCallback((id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${id}`)
        const data = await res.json()

        if (data.status === "completed" && data.video_url) {
          clearInterval(interval)
          setVideoUrl(data.video_url)
          setPhase("done")
        } else if (data.status === "failed" || data.error) {
          clearInterval(interval)
          setError(data.error?.message || data.error || "יצירת הוידאו נכשלה")
          setPhase("done")
        } else {
          setProgress(
            data.status === "processing"
              ? "HeyGen מרנדר את הוידאו..."
              : `סטטוס: ${data.status}`
          )
        }
      } catch {
        clearInterval(interval)
        setError("החיבור אבד בזמן בדיקת סטטוס הוידאו")
        setPhase("done")
      }
    }, 5000)
  }, [])

  const handleGenerate = async () => {
    setPhase("generating")
    setProgress("מעלה את ההקלטה...")
    setError(null)
    setVideoUrl(null)

    try {
      // 1. Upload audio to HeyGen
      const formData = new FormData()
      formData.append("audio", audioBlob, "recording.webm")

      const uploadRes = await fetch("/api/upload-audio", {
        method: "POST",
        body: formData,
      })
      const uploadData = await uploadRes.json()

      if (uploadData.error) {
        setError(uploadData.error)
        setPhase("done")
        return
      }

      // 2. Generate video
      setProgress("שולח ל-HeyGen...")
      const genRes = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatar_id: avatar.avatar_id,
          audio_url: uploadData.url,
        }),
      })

      const genData = await genRes.json()

      if (genData.error) {
        setError(genData.error)
        setPhase("done")
        return
      }

      setProgress("HeyGen מרנדר את הוידאו...")
      pollVideoStatus(genData.video_id)
    } catch {
      setError("שגיאה בתחילת יצירת הוידאו")
      setPhase("done")
    }
  }

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-center gap-4">
        <Button onClick={handleGenerate}>
          צור וידאו
        </Button>
      </div>
    )
  }

  if (phase === "generating") {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4">
        <div className="relative size-12">
          <div className="absolute inset-0 rounded-full border-4 border-gray-90" />
          <div className="absolute inset-0 rounded-full border-4 border-yellow-50 border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-text-neutral-default">{progress}</p>
        <p className="text-xs text-text-primary-disabled">
          זה בדרך כלל לוקח 1-3 דקות
        </p>
      </div>
    )
  }

  // done
  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="text-center">
          <p className="text-sm font-medium text-button-destructive-default">יצירת הוידאו נכשלה</p>
          <p className="text-xs text-text-neutral-default mt-1">{error}</p>
        </div>
      )}

      {videoUrl && (
        <div className="w-full">
          <video
            src={videoUrl}
            controls
            autoPlay
            className="w-full rounded-xl shadow-lg"
          />
          <div className="flex gap-3 mt-4 justify-center">
            <Button asChild>
              <a
                href={videoUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
              >
                הורד וידאו
              </a>
            </Button>
          </div>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onStartOver}>
        התחל מחדש
      </Button>
    </div>
  )
}
