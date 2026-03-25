"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import { X, Smartphone, Video, Layers, Image as ImageIcon, ImagePlus, Mic, Square, RefreshCw, ChevronDown, Loader2, CircleCheck, Download, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react"

import { AvatarPicker, type Avatar } from "@/components/avatar-picker"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { SlideData } from "@/lib/carousel-templates"
import { CAROUSEL_TEMPLATES } from "@/lib/carousel-templates"

const FORMAT_META: Record<string, { label: string; icon: LucideIcon }> = {
  story: { label: "סטורי", icon: Smartphone },
  talking_head: { label: "דיבור למצלמה", icon: Video },
  carousel: { label: "קרוסלה", icon: Layers },
  image_post: { label: "פוסט תמונה", icon: ImageIcon },
}

interface MediaPanelProps {
  formatId: string | null
  onClose: () => void
  // Talking head state (lifted)
  thAvatar: Avatar | null
  thAudioBlob: Blob | null
  thTranscript: string
  thVideoUrl: string | null
  thSourceMode: "choose" | "upload" | "avatar"
  onThAvatarChange: (avatar: Avatar | null) => void
  onThAudioBlobChange: (blob: Blob | null) => void
  onThTranscriptChange: (text: string) => void
  onThVideoUrlChange: (url: string | null) => void
  onThSourceModeChange: (mode: "choose" | "upload" | "avatar") => void
  onScrollToVideo?: () => void
  // Carousel state (lifted)
  carouselImages: string[] | null
  carouselSlides: SlideData[] | null
  onCarouselImagesChange: (images: string[] | null) => void
  onCarouselSlidesChange: (slides: SlideData[] | null) => void
  carouselText: string
  onScrollToCarousel?: () => void
}

export function MediaPanel({
  formatId,
  onClose,
  thAvatar,
  thAudioBlob,
  thTranscript,
  thVideoUrl,
  thSourceMode,
  onThAvatarChange,
  onThAudioBlobChange,
  onThTranscriptChange,
  onThVideoUrlChange,
  onThSourceModeChange,
  onScrollToVideo,
  carouselImages,
  carouselSlides,
  onCarouselImagesChange,
  onCarouselSlidesChange,
  carouselText,
  onScrollToCarousel,
}: MediaPanelProps) {
  const isOpen = formatId !== null
  const meta = formatId ? FORMAT_META[formatId] : null
  const Icon = meta?.icon

  return (
    <div
      className={`fixed left-0 top-14 bottom-0 w-[400px] bg-white border-r border-border-neutral-default z-30 transition-transform duration-300 ease-in-out ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`}
      dir="rtl"
    >
      {/* Header */}
      {meta && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-neutral-default">
          <div className="flex items-center gap-2">
            {formatId === "talking_head" && (thAvatar || thSourceMode === "avatar") && (
              <button
                onClick={() => {
                  if (thAvatar) {
                    onThAvatarChange(null)
                    onThSourceModeChange("choose")
                  } else {
                    onThSourceModeChange("choose")
                  }
                }}
                className="p-0.5 rounded-lg hover:bg-bg-surface transition-colors cursor-pointer"
              >
                <ChevronRight className="size-4 text-text-neutral-default" />
              </button>
            )}
            <span className="text-p-bold text-text-primary-default">{meta.label}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-bg-surface transition-colors"
          >
            <X className="size-4 text-text-neutral-default" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="overflow-y-auto h-[calc(100%-57px)] px-6 py-6">
        {formatId === "talking_head" && (
          <TalkingHeadFlow
            avatar={thAvatar}
            audioBlob={thAudioBlob}
            transcript={thTranscript}
            videoUrl={thVideoUrl}
            sourceMode={thSourceMode}
            onAvatarChange={onThAvatarChange}
            onAudioBlobChange={onThAudioBlobChange}
            onTranscriptChange={onThTranscriptChange}
            onVideoUrlChange={onThVideoUrlChange}
            onSourceModeChange={onThSourceModeChange}
            onScrollToVideo={onScrollToVideo}
          />
        )}

        {formatId === "carousel" && (
          <CarouselFlow
            carouselText={carouselText}
            images={carouselImages}
            slides={carouselSlides}
            onImagesChange={onCarouselImagesChange}
            onSlidesChange={onCarouselSlidesChange}
            onScrollToCarousel={onScrollToCarousel}
          />
        )}

        {formatId && formatId !== "talking_head" && formatId !== "carousel" && (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="rounded-2xl border-2 border-dashed border-border-neutral-default p-8">
              <ImagePlus className="size-10 text-text-neutral-default mx-auto mb-3" />
              <p className="text-small text-text-neutral-default">
                גרור תמונה לכאן או לחץ להעלאה
              </p>
            </div>
            <p className="text-xs text-text-primary-disabled">
              בקרוב — יצירת תמונות עם AI
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Talking Head — single continuous flow                              */
/* ------------------------------------------------------------------ */

function TalkingHeadFlow({
  avatar,
  audioBlob,
  transcript,
  videoUrl: liftedVideoUrl,
  sourceMode,
  onAvatarChange,
  onAudioBlobChange,
  onTranscriptChange,
  onVideoUrlChange,
  onSourceModeChange,
  onScrollToVideo,
}: {
  avatar: Avatar | null
  audioBlob: Blob | null
  transcript: string
  videoUrl: string | null
  sourceMode: "choose" | "upload" | "avatar"
  onAvatarChange: (a: Avatar | null) => void
  onAudioBlobChange: (b: Blob | null) => void
  onTranscriptChange: (t: string) => void
  onVideoUrlChange: (url: string | null) => void
  onSourceModeChange: (mode: "choose" | "upload" | "avatar") => void
  onScrollToVideo?: () => void
}) {
  // --- upload video state ---
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  // --- recording state ---
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // --- video generation state ---
  const [videoPhase, setVideoPhase] = useState<"idle" | "generating" | "done">("idle")
  const [videoProgress, setVideoProgress] = useState("")
  const [videoError, setVideoError] = useState<string | null>(null)

  // --- cover generation state ---
  const [coverImages, setCoverImages] = useState<string[] | null>(null)
  const [coverLoading, setCoverLoading] = useState(false)
  const [selectedCover, setSelectedCover] = useState(0)

  // Load mic devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => {
      const mics = all.filter((d) => d.kind === "audioinput")
      setDevices(mics)
      if (mics.length > 0 && !selectedDevice) {
        setSelectedDevice(mics[0].deviceId)
      }
    }).catch(() => {})
  }, [selectedDevice])

  // Cleanup audio URL
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const startRecording = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice ? { deviceId: { exact: selectedDevice } } : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(blob))
        onAudioBlobChange(blob)
        stream.getTracks().forEach((t) => t.stop())

        // Transcribe
        setTranscribing(true)
        try {
          const formData = new FormData()
          formData.append("audio", blob, "recording.webm")
          const res = await fetch("/api/transcribe", { method: "POST", body: formData })
          const data = await res.json()
          if (data.text) {
            onTranscriptChange(data.text)
          }
        } catch {
          // transcription is optional, fail silently
        } finally {
          setTranscribing(false)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      setRecError(null)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
      onAudioBlobChange(null)
      onTranscriptChange("")

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1)
      }, 1000)
    } catch {
      setRecError("לא ניתן לגשת למיקרופון. אנא אפשר גישה.")
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

  // --- Video generation ---
  const pollVideoStatus = useCallback((id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${id}`)
        const data = await res.json()
        if (data.status === "completed" && data.video_url) {
          clearInterval(interval)
          onVideoUrlChange(data.video_url)
          setVideoPhase("done")
          // Auto-generate cover if thumbnail available
          if (data.thumbnail_url) {
            generateCover(data.thumbnail_url)
          }
        } else if (data.status === "failed" || data.error) {
          clearInterval(interval)
          setVideoError(data.error?.message || data.error || "יצירת הוידאו נכשלה")
          setVideoPhase("done")
        } else {
          setVideoProgress(
            data.status === "processing"
              ? "HeyGen מרנדר את הוידאו..."
              : `סטטוס: ${data.status}`
          )
        }
      } catch {
        clearInterval(interval)
        setVideoError("החיבור אבד בזמן בדיקת סטטוס הוידאו")
        setVideoPhase("done")
      }
    }, 5000)
  }, [onVideoUrlChange])

  const handleGenerate = async () => {
    if (!avatar || !audioBlob) return
    setVideoPhase("generating")
    setVideoProgress("מעלה את ההקלטה...")
    setVideoError(null)
    onVideoUrlChange(null)

    try {
      const formData = new FormData()
      formData.append("audio", audioBlob, "recording.webm")
      const uploadRes = await fetch("/api/upload-audio", { method: "POST", body: formData })
      const uploadData = await uploadRes.json()
      if (uploadData.error) {
        setVideoError(uploadData.error)
        setVideoPhase("done")
        return
      }

      setVideoProgress("שולח ל-HeyGen...")
      const genRes = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_id: avatar.avatar_id, audio_url: uploadData.url }),
      })
      const genData = await genRes.json()
      if (genData.error) {
        setVideoError(genData.error)
        setVideoPhase("done")
        return
      }

      setVideoProgress("HeyGen מרנדר את הוידאו...")
      pollVideoStatus(genData.video_id)
    } catch {
      setVideoError("שגיאה בתחילת יצירת הוידאו")
      setVideoPhase("done")
    }
  }

  const generateCover = async (thumbnailUrl: string) => {
    setCoverLoading(true)
    try {
      const res = await fetch("/api/reel-cover/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnail_url: thumbnailUrl, title: transcript || "ריל חדש" }),
      })
      const data = await res.json()
      if (data.covers) {
        setCoverImages(data.covers)
        setSelectedCover(0)
      }
    } catch {
      // Cover generation is optional, fail silently
    } finally {
      setCoverLoading(false)
    }
  }

  const handleDownloadCover = () => {
    if (!coverImages || !coverImages[selectedCover]) return
    const a = document.createElement("a")
    a.href = `data:image/png;base64,${coverImages[selectedCover]}`
    a.download = "reel-cover.png"
    a.click()
  }

  const handleStartOver = () => {
    onAvatarChange(null)
    onAudioBlobChange(null)
    onTranscriptChange("")
    setAudioUrl(null)
    setVideoPhase("idle")
    onVideoUrlChange(null)
    setVideoError(null)
    setCoverImages(null)
    setCoverLoading(false)
    onSourceModeChange("choose")
    setUploadedVideoUrl(null)
  }

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setUploadedVideoUrl(url)
    onVideoUrlChange(url)
    setVideoPhase("done")
  }

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith("video/")) return
    const url = URL.createObjectURL(file)
    setUploadedVideoUrl(url)
    onVideoUrlChange(url)
    setVideoPhase("done")
  }

  // Determine current step for progress bar
  const currentStep = !avatar ? 0 : (videoPhase === "done" && liftedVideoUrl) ? 2 : 1

  const STEPS = ["בחירת אווטאר", "הקלטת הסקריפט", "סיום"]

  const progressBar = (
    <div className="flex items-center justify-center gap-3 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-3">
          <span
            className={
              i === currentStep
                ? "text-small-bold text-text-primary-default"
                : i < currentStep
                  ? "text-small text-text-neutral-default"
                  : "text-small text-text-primary-disabled"
            }
          >
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <div className="h-px w-8 bg-border-neutral-default" />
          )}
        </div>
      ))}
    </div>
  )

  // --- Choose source: upload or avatar ---
  if (!avatar && sourceMode === "choose") {
    return (
      <div className="flex flex-col gap-6">
        {/* Upload video drop zone */}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoUpload}
          className="hidden"
        />
        <div
          onClick={() => videoInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleVideoDrop}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border-neutral-default p-8 hover:border-yellow-50 hover:bg-bg-surface-primary-default transition-all cursor-pointer"
        >
          <Video className="size-8 text-text-neutral-default" />
          <span className="text-small font-semibold text-text-primary-default">העלה סרטון</span>
          <span className="text-xs text-text-neutral-default">גרור לכאן או לחץ לבחירה</span>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border-neutral-default" />
          <span className="text-xs text-text-neutral-default">או בחירת אווטאר</span>
          <div className="h-px flex-1 bg-border-neutral-default" />
        </div>

        {/* Avatar button */}
        <Button
          variant="outline"
          onClick={() => onSourceModeChange("avatar")}
          className="w-full gap-2"
        >
          טען אווטארים
        </Button>
      </div>
    )
  }

  // --- Avatar picker ---
  if (!avatar && sourceMode === "avatar") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-neutral-default">בחר אווטאר:</p>
        <AvatarPicker onSelect={(a) => onAvatarChange(a)} />
      </div>
    )
  }

  // --- Video done → show only success message ---
  if (videoPhase === "done" && liftedVideoUrl) {
    return (
      <div className="flex flex-col gap-6">
        {progressBar}
        <Alert className="border-green-200 bg-green-50 [&>svg]:text-green-600">
          <CircleCheck className="size-4" />
          <AlertTitle className="text-green-800">הוידאו נוצר בהצלחה!</AlertTitle>
          <AlertDescription className="text-green-700">
            הוידאו מוצג מתחת לכרטיס דיבור למצלמה.{" "}
            <button
              onClick={onScrollToVideo}
              className="underline font-medium hover:text-green-900 transition-colors"
            >
              קח אותי לוידאו
            </button>
          </AlertDescription>
        </Alert>

        {/* Cover generation */}
        {coverLoading && (
          <div className="flex items-center gap-2 text-sm text-text-neutral-default">
            <Loader2 className="size-4 animate-spin" />
            מייצר cover לריל...
          </div>
        )}

        {coverImages && coverImages.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-small-bold text-text-primary-default">בחר cover לריל:</p>
            <div className="grid grid-cols-3 gap-2">
              {coverImages.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedCover(i)}
                  className={`relative aspect-[9/16] rounded-lg overflow-hidden transition-all cursor-pointer ${
                    selectedCover === i
                      ? "ring-2 ring-yellow-50"
                      : "opacity-60 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${img}`}
                    alt={`cover ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
            <Button onClick={handleDownloadCover} className="w-full gap-2">
              <Download className="size-4" />
              הורד cover
            </Button>
          </div>
        )}

        <div className="flex flex-col items-center gap-2">
          <Button variant="outline" onClick={handleStartOver} className="w-full">
            התחלה מחדש
          </Button>
          <p className="text-xs text-text-neutral-default">התחלה מחדש תבטל את האווטאר הקיים</p>
        </div>
      </div>
    )
  }

  // --- Avatar selected → single continuous view ---
  return (
    <div className="flex flex-col gap-6">
      {progressBar}

      {/* Selected avatar preview */}
      {avatar && <div className="rounded-2xl bg-gray-95 flex items-center justify-center py-6">
        <div className="relative w-[150px] aspect-[9/16] rounded-xl overflow-hidden">
          <Image
            src={avatar.preview_image_url}
            alt={avatar.avatar_name}
            fill
            className="object-cover"
            sizes="150px"
          />
        </div>
      </div>}

      {/* Mic device selector */}
      {devices.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-text-neutral-default">מיקרופון</label>
          <div className="relative">
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              className="h-9 w-full appearance-none rounded-lg border border-border-neutral-default bg-white pe-8 ps-3 text-sm text-text-primary-default outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `מיקרופון ${devices.indexOf(d) + 1}`}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default pointer-events-none" />
          </div>
        </div>
      )}

      {/* Recording controls */}
      <div className="flex flex-col items-center gap-3">
        {recError && (
          <p className="text-button-destructive-default text-sm">{recError}</p>
        )}

        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`relative size-16 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? "bg-button-destructive-default text-white scale-110"
              : "bg-button-primary-default text-white hover:bg-button-primary-hover hover:scale-105"
          }`}
        >
          {isRecording && (
            <span className="absolute inset-0 rounded-full bg-button-destructive-default/30 animate-ping" />
          )}
          {isRecording ? (
            <Square className="size-6" fill="currentColor" />
          ) : (
            <Mic className="size-6" />
          )}
        </button>

        {isRecording ? (
          <div className="text-center">
            <p className="text-lg font-mono font-bold text-button-destructive-default">
              {formatTime(recordingTime)}
            </p>
            <p className="text-xs text-text-neutral-default mt-1">מקליט... לחץ לעצירה</p>
          </div>
        ) : (
          !audioBlob && (
            <p className="text-text-neutral-default text-center text-xs">
              לחץ על המיקרופון כדי להתחיל הקלטה
            </p>
          )
        )}
      </div>

      {/* Playback */}
      {audioUrl && !isRecording && (
        <div className="flex flex-col gap-2">
          <audio src={audioUrl} controls className="w-full" />
          <button
            onClick={startRecording}
            className="flex items-center gap-1.5 text-sm text-text-neutral-default hover:text-text-primary-default transition-colors self-start"
          >
            <RefreshCw className="size-3.5" />
            הקלט מחדש
          </button>
        </div>
      )}

      {/* Transcription */}
      {transcribing && (
        <div className="flex items-center gap-2 text-sm text-text-neutral-default">
          <Loader2 className="size-4 animate-spin" />
          מתמלל...
        </div>
      )}

      {transcript && !transcribing && (
        <div className="rounded-lg border border-border-neutral-default bg-bg-surface p-3">
          <p className="text-xs text-text-neutral-default mb-1">תמלול</p>
          <p className="text-small text-text-primary-default leading-relaxed whitespace-pre-wrap">
            {transcript}
          </p>
        </div>
      )}

      {/* Video generation section */}
      {audioBlob && !isRecording && videoPhase === "idle" && (
        <Button onClick={handleGenerate} className="w-full">
          צור וידאו
        </Button>
      )}

      {videoPhase === "generating" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="relative size-10">
            <div className="absolute inset-0 rounded-full border-4 border-gray-90" />
            <div className="absolute inset-0 rounded-full border-4 border-yellow-50 border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-text-neutral-default">{videoProgress}</p>
          <p className="text-xs text-text-primary-disabled">זה בדרך כלל לוקח 1-3 דקות</p>
        </div>
      )}

      {videoPhase === "done" && videoError && (
        <div className="text-center">
          <p className="text-sm font-medium text-button-destructive-default">יצירת הוידאו נכשלה</p>
          <p className="text-xs text-text-neutral-default mt-1">{videoError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setVideoPhase("idle")}>
            נסה שוב
          </Button>
        </div>
      )}

    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Carousel — template selection + PNG generation                     */
/* ------------------------------------------------------------------ */

function CarouselFlow({
  carouselText,
  images,
  slides,
  onImagesChange,
  onSlidesChange,
  onScrollToCarousel,
}: {
  carouselText: string
  images: string[] | null
  slides: SlideData[] | null
  onImagesChange: (imgs: string[] | null) => void
  onSlidesChange: (slides: SlideData[] | null) => void
  onScrollToCarousel?: () => void
}) {
  const [selectedTemplate, setSelectedTemplate] = useState(CAROUSEL_TEMPLATES[0].id)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)

  // Parse carousel text into slides
  const parseTextToSlides = (text: string): SlideData[] => {
    const slideBlocks = text.split(/\n\n+/).filter(Boolean)
    const parsed: SlideData[] = []
    let slideNum = 1

    for (const block of slideBlocks) {
      const lines = block.trim().split("\n")
      const headerLine = lines[0]

      let type: SlideData["type"] = "content"
      if (headerLine.includes("כריכה")) type = "cover"
      else if (headerLine.includes("סיום")) type = "cta"

      // Extract title from "כותרת: ..." line
      const titleLine = lines.find((l) => l.startsWith("כותרת:"))
      const title = titleLine ? titleLine.replace("כותרת:", "").trim() : lines[0].replace(/^\[.*\]\s*/, "").trim()

      // Body is remaining lines after header and title
      const bodyLines = lines.filter(
        (l) => l !== headerLine && l !== titleLine,
      )
      const body = bodyLines.join("\n").trim()

      parsed.push({ slide: slideNum, type, title, body })
      slideNum++
    }

    return parsed
  }

  const handleGenerate = async () => {
    if (!carouselText.trim()) return
    setGenerating(true)
    setError(null)

    try {
      const parsedSlides = parseTextToSlides(carouselText)
      if (parsedSlides.length === 0) {
        setError("לא נמצאו סליידים בטקסט הקרוסלה")
        setGenerating(false)
        return
      }

      onSlidesChange(parsedSlides)

      const res = await fetch("/api/carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slides: parsedSlides,
          templateId: selectedTemplate,
        }),
      })

      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else if (data.images) {
        onImagesChange(data.images)
        setPreviewIndex(0)
      }
    } catch {
      setError("שגיאה ביצירת הקרוסלה")
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadAll = async () => {
    if (!images) return
    setDownloading(true)

    try {
      const res = await fetch("/api/carousel/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      })

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "carousel.zip"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError("שגיאה בהורדת הקבצים")
    } finally {
      setDownloading(false)
    }
  }

  const handleStartOver = () => {
    onImagesChange(null)
    onSlidesChange(null)
    setPreviewIndex(0)
    setError(null)
  }

  // --- Images generated → show success ---
  if (images && images.length > 0) {
    return (
      <div className="flex flex-col gap-5">
        <Alert className="border-green-200 bg-green-50 [&>svg]:text-green-600">
          <CircleCheck className="size-4" />
          <AlertTitle className="text-green-800">הקרוסלה נוצרה!</AlertTitle>
          <AlertDescription className="text-green-700">
            {images.length} סליידים נוצרו בהצלחה.{" "}
            <button
              onClick={onScrollToCarousel}
              className="underline font-medium hover:text-green-900 transition-colors"
            >
              הצג בקנבס
            </button>
          </AlertDescription>
        </Alert>

        {/* Preview carousel */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-gray-95">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${images[previewIndex]}`}
              alt={`סלייד ${previewIndex + 1}`}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
              disabled={previewIndex === 0}
              className="p-1.5 rounded-lg hover:bg-bg-surface disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="size-4 text-text-primary-default" />
            </button>
            <span className="text-small text-text-neutral-default">
              {previewIndex + 1} / {images.length}
            </span>
            <button
              onClick={() => setPreviewIndex(Math.min(images.length - 1, previewIndex + 1))}
              disabled={previewIndex === images.length - 1}
              className="p-1.5 rounded-lg hover:bg-bg-surface disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="size-4 text-text-primary-default" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <Button onClick={handleDownloadAll} disabled={downloading} className="w-full gap-2">
          <Download className="size-4" />
          {downloading ? "מוריד..." : "הורד הכל (ZIP)"}
        </Button>

        <Button variant="outline" onClick={handleStartOver} className="w-full">
          צור מחדש
        </Button>
      </div>
    )
  }

  // --- No images yet → show template selection + generate button ---
  return (
    <div className="flex flex-col gap-5">
      {/* Template selection */}
      <div className="flex flex-col gap-2">
        <p className="text-small-bold text-text-primary-default">בחר טמפלט:</p>
        <div className="grid grid-cols-2 gap-3">
          {CAROUSEL_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => setSelectedTemplate(tmpl.id)}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                selectedTemplate === tmpl.id
                  ? "border-yellow-50 bg-bg-surface-primary-default"
                  : "border-border-neutral-default hover:border-gray-80"
              }`}
            >
              <div
                className="w-full aspect-square rounded-lg"
                style={{ backgroundColor: tmpl.previewBg }}
              />
              <span className="text-xs text-text-primary-default">{tmpl.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Source text preview */}
      {carouselText && (
        <div className="rounded-lg border border-border-neutral-default bg-bg-surface p-3">
          <p className="text-xs text-text-neutral-default mb-1">טקסט הקרוסלה</p>
          <p className="text-xs text-text-primary-default leading-relaxed whitespace-pre-wrap line-clamp-6">
            {carouselText}
          </p>
        </div>
      )}

      {/* Generate button */}
      <Button
        onClick={handleGenerate}
        disabled={generating || !carouselText.trim()}
        className="w-full gap-2"
      >
        {generating ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            מייצר סליידים...
          </>
        ) : (
          <>
            <Layers className="size-4" />
            צור קרוסלה
          </>
        )}
      </Button>

      {error && (
        <p className="text-sm text-button-destructive-default text-center">{error}</p>
      )}

      {!carouselText.trim() && (
        <p className="text-xs text-text-primary-disabled text-center">
          עדכן את טקסט הקרוסלה בכרטיס כדי ליצור סליידים
        </p>
      )}
    </div>
  )
}
