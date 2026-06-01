"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import { X, Smartphone, Video, Layers, Image as ImageIcon, ImagePlus, Mic, Square, RefreshCw, ChevronDown, Loader2, CircleCheck, Download, Upload, ChevronLeft, ChevronRight, Link2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { AvatarPicker, type Avatar } from "@/components/avatar-picker"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import type { SlideData } from "@/lib/carousel-templates"
import { CAROUSEL_TEMPLATES } from "@/lib/carousel-templates"
import {
  getFormatMeta,
  setFormatMeta,
  type FormatId,
} from "@/lib/timing-storage"

const FORMAT_META: Record<string, { label: string; icon: LucideIcon }> = {
  story: { label: "סטורי", icon: Smartphone },
  talking_head: { label: "דיבור למצלמה", icon: Video },
  carousel: { label: "קרוסלה", icon: Layers },
  image_post: { label: "פוסט תמונה", icon: ImageIcon },
}

interface MediaPanelProps {
  formatId: string | null
  onClose: () => void
  /**
   * The saved core_posts.id this panel is attached to. Required for the
   * generic MediaUploadFlow (story / image_post) — without it we can't
   * persist uploads to the right format_variant. May be null if the user
   * is editing a *new* post that hasn't been saved yet; in that case the
   * upload flow shows a soft empty state instructing the user to save
   * first. Talking-head and carousel flows ignore this — they have their
   * own persistence path through the parent's auto-save useEffect.
   */
  postId?: string | null
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
  thCoverImage: string | null
  onThCoverImageChange: (image: string | null) => void
  onThCoverLoadingChange?: (loading: boolean) => void
  onThVideoFrameChange?: (dataUrl: string) => void
  hookText?: string
  onScrollToVideo?: () => void
  // Carousel state (lifted)
  carouselImages: string[] | null
  carouselSlides: SlideData[] | null
  onCarouselImagesChange: (images: string[] | null) => void
  onCarouselSlidesChange: (slides: SlideData[] | null) => void
  carouselText: string
}

export function MediaPanel({
  formatId,
  onClose,
  postId,
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
  thCoverImage,
  onThCoverImageChange,
  onThCoverLoadingChange,
  onThVideoFrameChange,
  hookText: panelHookText,
  onScrollToVideo,
  carouselImages,
  carouselSlides,
  onCarouselImagesChange,
  onCarouselSlidesChange,
  carouselText,
}: MediaPanelProps) {
  const isOpen = formatId !== null
  const meta = formatId ? FORMAT_META[formatId] : null
  const Icon = meta?.icon

  return (
    <div
      className={`fixed left-0 top-14 bottom-0 w-[400px] bg-white dark:bg-gray-10 border-r border-border-neutral-default z-30 transition-transform duration-300 ease-in-out ${
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
        {/* Sub-title helper — explains the two ways to provide media for the
            format (local upload or an external Drive / Canva link). Shown for
            every format panel, directly under the header title. Lives inside
            the scroll area so it doesn't break the header height calc above. */}
        {meta && (
          <p className="mb-4 text-small text-text-neutral-default">
            אפשר להעלות את המדיה של הפורמט מהמחשב שלכם או לתת קישור מגוגל דרייב או קנבה לתמונה / סרטון שמאוחסן שם.
          </p>
        )}

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
            coverImage={thCoverImage}
            onCoverImageChange={onThCoverImageChange}
            onCoverLoadingChange={onThCoverLoadingChange}
            onVideoFrameChange={onThVideoFrameChange}
            hookText={panelHookText}
            onScrollToVideo={onScrollToVideo}
          />
        )}

        {formatId === "carousel" && (
          <CarouselFlow
            postId={postId ?? null}
            carouselText={carouselText}
            images={carouselImages}
            slides={carouselSlides}
            onImagesChange={onCarouselImagesChange}
            onSlidesChange={onCarouselSlidesChange}
          />
        )}

        {formatId && formatId !== "talking_head" && formatId !== "carousel" && (
          <MediaUploadFlow
            format={formatId}
            postId={postId ?? null}
            hookText={panelHookText}
          />
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
  coverImage,
  onCoverImageChange,
  onCoverLoadingChange,
  onVideoFrameChange,
  hookText,
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
  coverImage: string | null
  onCoverImageChange: (image: string | null) => void
  onCoverLoadingChange?: (loading: boolean) => void
  onVideoFrameChange?: (dataUrl: string) => void
  hookText?: string
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
  const [videoPhase, setVideoPhase] = useState<"idle" | "generating" | "done">(liftedVideoUrl ? "done" : "idle")
  const [videoProgress, setVideoProgress] = useState("")
  const [videoError, setVideoError] = useState<string | null>(null)

  // --- cover generation state ---
  const [coverLoading, setCoverLoading] = useState(false)
  // Pill colour for the cover's text background. Always black inside the
  // media panel — colour customisation lives on the main project canvas.
  const pillColor = "#000000"

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
        } catch (err) {
          console.error("[media-panel][transcribe]", err)
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
    } catch (err) {
      console.error("[media-panel][mic-access]", err)
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
          setVideoProgress("שומר וידאו...")
          // Download and store in Supabase Storage
          try {
            const storeRes = await fetch("/api/videos/store", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ video_url: data.video_url }),
            })
            const storeData = await storeRes.json()
            onVideoUrlChange(storeData.url || data.video_url)
          } catch (err) {
            console.error("[media-panel][store-video]", err)
            onVideoUrlChange(data.video_url)
          }
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
      } catch (err) {
        console.error("[media-panel][poll-video-status]", err)
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
    } catch (err) {
      console.error("[media-panel][start-video-gen]", err)
      setVideoError("שגיאה בתחילת יצירת הוידאו")
      setVideoPhase("done")
    }
  }

  const generateCover = async (thumbnailUrl: string, customTitle?: string, color?: string) => {
    setCoverLoading(true); onCoverLoadingChange?.(true)
    try {
      const res = await fetch("/api/reel-cover/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thumbnail_url: thumbnailUrl || undefined,
          title: customTitle || hookText || transcript || "ריל חדש",
          pill_color: color ?? pillColor,
        }),
      })
      const data = await res.json()
      if (data.covers?.[0]) {
        onCoverImageChange(data.covers[0])
      }
    } catch (err) {
      console.error("[media-panel][generate-cover]", err)
    } finally {
      setCoverLoading(false); onCoverLoadingChange?.(false)
    }
  }

  const handleDownloadCover = () => {
    if (!coverImage) return
    const a = document.createElement("a")
    a.href = `data:image/png;base64,${coverImage}`
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
    onCoverImageChange(null)
    setCoverLoading(false)
    onSourceModeChange("choose")
    setUploadedVideoUrl(null)
  }

  // Extract a frame from a video file as data URL
  const extractFrameFromFile = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement("video")
      video.muted = true
      video.src = url
      video.onloadeddata = () => { video.currentTime = 1 }
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas")
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          canvas.getContext("2d")?.drawImage(video, 0, 0)
          URL.revokeObjectURL(url)
          resolve(canvas.toDataURL("image/jpeg", 0.8))
        } catch (err) { console.error("[media-panel][video-frame-capture]", err); resolve(null) }
      }
      video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      setTimeout(() => resolve(null), 5000)
    })
  }

  const processVideoFile = async (file: File) => {
    // Hard size cap — match the bucket's 50MB default so the user gets a
    // clear error instead of an opaque silent failure mid-upload.
    const MAX_VIDEO_MB = 50
    const sizeMb = file.size / 1024 / 1024
    if (sizeMb > MAX_VIDEO_MB) {
      toast.error(`הקובץ גדול מדי (${sizeMb.toFixed(1)}MB). מקסימום ${MAX_VIDEO_MB}MB.`, { duration: 6000 })
      return
    }

    const localUrl = URL.createObjectURL(file)
    setUploadedVideoUrl(localUrl)
    onVideoUrlChange(localUrl)
    setVideoPhase("done")

    // Extract frame for cover before uploading
    const frameDataUrl = await extractFrameFromFile(file)
    if (frameDataUrl) onVideoFrameChange?.(frameDataUrl)

    // Upload the actual video file to Supabase Storage so it survives a
    // refresh. Use XHR (not the supabase-js client) because XHR exposes
    // upload.progress events — supabase-js's storage upload has no progress
    // callback, so we'd otherwise have a multi-second silent wait where the
    // user can't tell if the upload is alive.
    const sizeMbStr = sizeMb.toFixed(1)
    const renderProgress = (pct: number, loadedMb?: string) => (
      <div className="flex flex-col gap-1.5 w-full" dir="rtl">
        <div className="flex items-center justify-between text-xs text-text-primary-default">
          <span>מעלה וידאו...</span>
          <span className="text-text-neutral-default">
            {loadedMb ? `${loadedMb} / ${sizeMbStr}MB · ${pct}%` : `${pct}%`}
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-95 rounded-full overflow-hidden">
          <div
            className="h-full bg-yellow-50 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
    const uploadToast = toast.loading(renderProgress(0), { duration: Infinity })
    try {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()
      if (!user || !session) {
        toast.error("לא מזוהה משתמש. רעננו ונסו שוב.", { id: uploadToast, duration: 6000 })
        return
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4"
      const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "mp4"
      const storagePath = `${user.id}/video/${crypto.randomUUID()}.${safeExt}`
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

      const { ok, error: uploadErrMsg } = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open("POST", `${supabaseUrl}/storage/v1/object/user-media/${storagePath}`)
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`)
        xhr.setRequestHeader("apikey", anonKey)
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4")
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            const loadedMb = (e.loaded / 1024 / 1024).toFixed(1)
            toast.loading(renderProgress(pct, loadedMb), { id: uploadToast, duration: Infinity })
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ok: true })
          } else {
            let msg = `Status ${xhr.status}`
            try {
              const r = JSON.parse(xhr.responseText)
              msg = r.message || r.error || msg
            } catch { /* response wasn't JSON, keep status-based message */ }
            resolve({ ok: false, error: msg })
          }
        }
        xhr.onerror = () => resolve({ ok: false, error: "שגיאת רשת" })
        xhr.send(file)
      })

      if (ok) {
        const videoUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl
        // Explicit duration — the loading toast was opened with
        // `duration: Infinity`. Sonner inherits the duration when we
        // replace via `id`, so without this the success toast would
        // never auto-dismiss.
        toast.success("וידאו נשמר", { id: uploadToast, duration: 4000 })
        // Replace the blob URL with the persistent storage URL — this is
        // what the parent's auto-save useEffect will PATCH onto the post.
        onVideoUrlChange(videoUrl)
      } else {
        // Upload failed. Fall back to thumbnail-only persistence so the card
        // at least re-appears after refresh, even if as a static image.
        console.error("[upload] video upload failed:", uploadErrMsg)
        toast.error(`העלאת הוידאו נכשלה: ${uploadErrMsg}`, { id: uploadToast, duration: 8000 })
        if (frameDataUrl) {
          const base64 = frameDataUrl.split(",")[1]
          const binaryStr = atob(base64)
          const bytes = new Uint8Array(binaryStr.length)
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
          const thumbPath = `${user.id}/video-thumb/${crypto.randomUUID()}.jpg`
          const { error: thumbErr } = await supabase.storage
            .from("user-media")
            .upload(thumbPath, bytes, { contentType: "image/jpeg" })
          if (!thumbErr) {
            const thumbUrl = supabase.storage.from("user-media").getPublicUrl(thumbPath).data.publicUrl
            onVideoUrlChange(thumbUrl)
          } else {
            console.error("[upload] thumbnail also failed:", thumbErr)
          }
        }
      }
    } catch (err) {
      console.error("[upload] unexpected error:", err)
      toast.error(`שגיאה בהעלאה: ${err instanceof Error ? err.message : String(err)}`, { id: uploadToast, duration: 8000 })
    }

    // Generate cover with video frame as thumbnail
    const coverTitle = hookText || transcript || "ריל חדש"
    setCoverLoading(true); onCoverLoadingChange?.(true)
    try {
      const res = await fetch("/api/reel-cover/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thumbnail_url: frameDataUrl || undefined,
          title: coverTitle,
          pill_color: pillColor,
        }),
      })
      const data = await res.json()
      if (data.covers?.[0]) onCoverImageChange(data.covers[0])
    } catch (err) { console.error("[media-panel][cover-from-frame]", err) }
    finally { setCoverLoading(false); onCoverLoadingChange?.(false) }
  }

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    processVideoFile(file)
  }

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith("video/")) return
    processVideoFile(file)
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
  if (!avatar && sourceMode === "choose" && !(videoPhase === "done" && liftedVideoUrl)) {
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

  // --- Video done (uploaded, not avatar) → show video preview + cover ---
  if (videoPhase === "done" && liftedVideoUrl && !avatar) {
    return (
      <div className="flex flex-col gap-6">
        {/* Video + Cover side by side */}
        <div className="flex gap-3">
          {/* Video */}
          <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <p className="text-xs text-text-neutral-default">סרטון</p>
            <div className="w-full aspect-[9/16] rounded-lg overflow-hidden bg-gray-95 relative">
              {/* Same <video> element for blob and remote URLs. The previous
                  `<img>` fallback for non-blob URLs left the preview blank,
                  because an mp4 URL can't render as an image. The `#t=0.001`
                  fragment forces the browser to seek to the first frame so
                  it's shown as a static preview while paused. */}
              <video
                src={liftedVideoUrl.startsWith("blob:") ? liftedVideoUrl : `${liftedVideoUrl}#t=0.001`}
                controls={false}
                playsInline
                muted
                preload="metadata"
                className="w-full h-full object-cover cursor-pointer"
                onClick={(e) => { const v = e.target as HTMLVideoElement; if (v.paused) v.play(); else v.pause() }}
              />
            </div>
          </div>

          {/* Cover */}
          {coverLoading && (
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <p className="text-xs text-text-neutral-default">קאבר</p>
              <div className="w-full aspect-[9/16] rounded-lg bg-gray-95 flex items-center justify-center">
                <Loader2 className="size-4 animate-spin text-text-neutral-default" />
              </div>
            </div>
          )}
          {coverImage && !coverLoading && (
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <p className="text-xs text-text-neutral-default">קאבר</p>
              <div className="w-full aspect-[9/16] rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${coverImage}`}
                  alt="cover"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processVideoFile(f) }}
            className="hidden"
          />
          <Button variant="outline" onClick={() => videoInputRef.current?.click()} size="sm" className="flex-1 gap-1.5">
            <Upload className="size-3.5" />
            החלף סרטון
          </Button>
          {coverImage && (
            <Button onClick={handleDownloadCover} size="sm" className="flex-1 gap-1.5">
              <Download className="size-3.5" />
              הורד קאבר
            </Button>
          )}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border-neutral-default" />
          <span className="text-xs text-text-neutral-default">או</span>
          <div className="h-px flex-1 bg-border-neutral-default" />
        </div>

        {/* Avatar option */}
        <Button
          variant="outline"
          onClick={() => { handleStartOver(); onSourceModeChange("avatar") }}
          className="w-full gap-2"
        >
          טען אווטארים
        </Button>
      </div>
    )
  }

  // --- Video done (via avatar flow) → show success + cover ---
  if (videoPhase === "done" && liftedVideoUrl && avatar) {
    return (
      <div className="flex flex-col gap-6">
        {progressBar}

        {/* Video + Cover side by side */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <p className="text-xs text-text-neutral-default">סרטון</p>
            <div className="w-full aspect-[9/16] rounded-lg overflow-hidden bg-gray-95 relative">
              {liftedVideoUrl.startsWith("blob:") ? (
                <video
                  src={liftedVideoUrl}
                  controls={false}
                  playsInline
                  muted
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={(e) => { const v = e.target as HTMLVideoElement; if (v.paused) v.play(); else v.pause() }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={liftedVideoUrl} alt="video" className="w-full h-full object-cover" />
              )}
            </div>
          </div>
          {coverLoading && (
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <p className="text-xs text-text-neutral-default">קאבר</p>
              <div className="w-full aspect-[9/16] rounded-lg bg-gray-95 flex items-center justify-center">
                <Loader2 className="size-4 animate-spin text-text-neutral-default" />
              </div>
            </div>
          )}
          {coverImage && !coverLoading && (
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <p className="text-xs text-text-neutral-default">קאבר</p>
              <div className="w-full aspect-[9/16] rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${coverImage}`}
                  alt="cover"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}
        </div>

        {coverImage && (
          <Button onClick={handleDownloadCover} size="sm" className="w-full gap-1.5">
            <Download className="size-3.5" />
            הורד קאבר
          </Button>
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
              className="h-9 w-full appearance-none rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 pe-8 ps-3 text-sm text-text-primary-default outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
  postId,
  carouselText,
  images,
  slides,
  onImagesChange,
  onSlidesChange,
}: {
  postId: string | null
  carouselText: string
  images: string[] | null
  slides: SlideData[] | null
  onImagesChange: (imgs: string[] | null) => void
  onSlidesChange: (slides: SlideData[] | null) => void
}) {
  const [selectedTemplate, setSelectedTemplate] = useState(CAROUSEL_TEMPLATES[0].id)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)

  // Parse carousel text into slides
  const parseTextToSlides = (text: string): SlideData[] => {
    const slideHeaderRegex = /^\s*(?:שקופית\s*\d+|\[.*?\])\s*:?\s*$/
    const blocks = text
      .split(/\n\s*\n+/)
      .map((b) => b.trim())
      .filter(Boolean)

    const parsed: SlideData[] = []
    let slideNum = 1

    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
      if (lines.length === 0) continue

      const hasHeader = slideHeaderRegex.test(lines[0])
      const contentLines = hasHeader ? lines.slice(1) : lines
      if (contentLines.length === 0) continue

      const legacyTitleLine = contentLines.find((l) => l.startsWith("כותרת:"))
      let title: string
      let body: string

      if (legacyTitleLine) {
        title = legacyTitleLine.replace("כותרת:", "").trim()
        body = contentLines.filter((l) => l !== legacyTitleLine).join("\n").trim()
      } else {
        title = contentLines[0]
        body = contentLines.slice(1).join("\n").trim()
      }

      parsed.push({ slide: slideNum, type: "content", title, body })
      slideNum++
    }

    if (parsed.length > 0) {
      parsed[0].type = "cover"
      parsed[parsed.length - 1].type = "cta"
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
    } catch (err) {
      console.error("[media-panel][generate-carousel]", err)
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
    } catch (err) {
      console.error("[media-panel][download-carousel]", err)
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

  // --- No images yet → script preview (top) + template (coming soon) + link input ---
  // Per Hani 2026-05-13: PNG generation isn't ready yet, so the template
  // grid is parked as a "coming soon" placeholder row and the active
  // entry path is a carousel link (Drive / Canva). Same Input visual as
  // the per-format DriveLinkBlock so the user reads the two surfaces as
  // the same affordance.
  return (
    <div className="flex flex-col gap-5">
      {/* 1. Carousel script preview — moved to TOP so the user reads
            "what the carousel says" before anything else, mirroring the
            top-of-card script preview pattern used elsewhere. */}
      {carouselText && (
        <div className="rounded-lg border border-border-neutral-default bg-bg-surface p-3">
          <p className="text-xs text-text-neutral-default mb-1">טקסט הקרוסלה</p>
          <p className="text-xs text-text-primary-default leading-relaxed whitespace-pre-wrap line-clamp-6 [&::first-line]:font-medium">
            {carouselText}
          </p>
        </div>
      )}

      {/* 2. Template selection — "coming soon" placeholders. Non-interactive
            empty squares so the user sees that templates are a planned
            feature without being able to pick one (the underlying PNG
            generation isn't shippable yet). */}
      <div className="flex flex-col gap-2">
        <p className="text-small-bold text-text-primary-default">
          בחירת טמפלט{" "}
          <span className="text-text-neutral-default font-normal">(בקרוב)</span>
        </p>
        <div className="grid grid-cols-4 gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-square rounded-xl bg-bg-surface border border-border-neutral-default"
            />
          ))}
        </div>
      </div>

      {/* 3. Carousel link input — Drive/Canva. Same Input visual as the
            per-format DriveLinkBlock; persists to the per-format meta
            slice (`carousel.driveUrl`), so the same value drives the
            scheduler's "has a drive link" readiness check. */}
      <CarouselLinkBlock postId={postId} />

      {error && (
        <p className="text-sm text-button-destructive-default text-center">{error}</p>
      )}
    </div>
  )
}

/**
 * Carousel link block — saves to `byFormat.carousel.driveUrl` via the
 * per-format meta slice, identical to DriveLinkBlock's behavior so the
 * same value drives readiness on /core_posts + the calendar. Auto-saves
 * on blur and Enter (paste + tab-away should "just work"). The label +
 * subtitle pair mirrors Hani's mockup; the Input itself uses the
 * design-system component at `inputSize="small"`.
 */
function CarouselLinkBlock({ postId }: { postId: string | null }) {
  const inputId = "carousel-link"
  // Read once from localStorage at mount — CarouselFlow only mounts when
  // the carousel media panel actually opens, and a single open session is
  // for a single post, so we don't need to re-sync on postId changes.
  // Reading inside the useState initializer keeps this off the render
  // path on subsequent renders and avoids the "setState in effect"
  // lint rule.
  const [local, setLocal] = useState<string>(() => {
    if (typeof window === "undefined" || !postId) return ""
    return getFormatMeta(postId, "carousel").driveUrl ?? ""
  })

  const commit = () => {
    if (!postId) return
    const trimmed = local.trim()
    setFormatMeta(postId, "carousel", {
      driveUrl: trimmed || undefined,
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={inputId}
        className="text-small-bold text-text-primary-default font-bold"
      >
        לינק לקרוסלה
      </Label>
      <p className="text-xs-body text-text-neutral-default">
        אפשר לשים לינק לדרייב או לקאנבה
      </p>
      <Input
        id={inputId}
        dir="rtl"
        inputSize="small"
        type="url"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur()
          }
        }}
        placeholder="https://drive.google.com/... או https://canva.com/..."
        className="text-right mt-1"
        disabled={!postId}
        aria-label="לינק לקרוסלה"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  MediaUploadFlow — generic per-format media for story / image_post  */
/* ------------------------------------------------------------------ */

/**
 * Per-format media entry surface used for any format that doesn't have a
 * dedicated authoring flow yet (today: `story` and `image_post` — and any
 * future format we add). Two ways to attach media:
 *
 *   1. Direct upload to Supabase Storage (`user-media` bucket). On success
 *      we POST `/api/core-posts/{id}/media` so the new asset lands in
 *      `media_assets` and the readiness chips flip to "ready".
 *
 *   2. A Google Drive link, persisted to localStorage (timing-storage's
 *      per-format slice) so the post still counts as ready for scheduling
 *      without uploading the actual file. Same DriveLinkBlock pattern as
 *      the editable Sheet — auto-save on blur/Enter, "open" affordance
 *      next to the input.
 *
 * Why two paths?  Per Hani: many users keep finished assets in Drive and
 * don't want to re-upload them. Forcing an upload would be a 30s+ tax on
 * every scheduled post. Both paths produce a "ready" state — the user
 * picks the friction model that fits their workflow.
 *
 * Why a Tabs structure and not two side-by-side cards?  Hick's Law: the
 * decision is mutually exclusive (you either upload OR link, never both
 * for the same format). Tabs make the choice explicit and keep the
 * authoring surface focused on whichever path the user committed to.
 */

/** Bucket name aligned with the rest of the project. */
const MEDIA_BUCKET = "user-media"
/** Hard upload size cap (matches the bucket's default). */
const MAX_FILE_MB = 50

/**
 * What kinds of files this format accepts. Stories accept video AND image
 * (a photo or 15s reel both count). Image posts accept only images. The
 * value is fed straight into `<input accept>` so the OS file picker
 * filters the right way.
 */
function acceptedMimeForFormat(format: string): {
  accept: string
  /** Whether a video file should be accepted. Drives our type-check on drop. */
  acceptsVideo: boolean
  /** Hebrew description shown in the empty state. */
  helperText: string
} {
  switch (format) {
    case "story":
      return {
        accept: "image/*,video/*",
        acceptsVideo: true,
        helperText: "תמונה או וידאו עד 50MB",
      }
    case "image_post":
    case "static":
      return {
        accept: "image/*",
        acceptsVideo: false,
        helperText: "תמונה עד 50MB",
      }
    default:
      // Anything we don't recognize — fall back to images, the safer
      // default. The MediaPanel never opens this flow for talking_head /
      // carousel, so we won't hit this path in practice.
      return {
        accept: "image/*",
        acceptsVideo: false,
        helperText: "תמונה עד 50MB",
      }
  }
}

function MediaUploadFlow({
  format,
  postId,
  hookText: _hookText,
}: {
  format: string
  postId: string | null
  hookText?: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Local mirror of the saved drive URL — committed to storage on
  // blur/Enter (same pattern as DriveLinkBlock in core-post-sheet.tsx).
  const [driveUrl, setDriveUrl] = useState<string>("")
  const [driveDirty, setDriveDirty] = useState(false)

  // Uploaded asset preview (data URL while uploading; persistent URL after).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null)
  const [uploading, setUploading] = useState(false)
  // Hydration phase = "we still don't know if there's existing media". True
  // while the /api/core-posts fetch is in flight. Without this, the panel
  // briefly renders the empty upload CTA before flipping to the preview
  // — which reads as "the image wasn't saved" to the user.
  const [hydrating, setHydrating] = useState<boolean>(() => !!postId)
  // Image element loading — flips false on `<img onLoad>`. Hides the
  // <img> behind a skeleton until the bytes have actually decoded, so
  // there's no flash of empty box between "src set" and "image painted".
  const [imageLoading, setImageLoading] = useState(false)

  // Hydrate the drive URL from storage when the panel opens for this
  // (post, format) pair. We use `getFormatMeta` so the post-level legacy
  // value falls back automatically — same precedence as the Sheet.
  useEffect(() => {
    if (!postId) {
      setDriveUrl("")
      setHydrating(false)
      return
    }
    const meta = getFormatMeta(postId, format as FormatId)
    setDriveUrl(meta.driveUrl ?? "")
    setDriveDirty(false)
    // Reset the upload preview when the post changes — otherwise
    // navigating between posts would leak a previous post's preview into
    // a fresh open.
    setPreviewUrl(null)
    setPreviewKind(null)
    setHydrating(true)
    setImageLoading(false)
  }, [postId, format])

  // Hydrate the upload preview from media_assets when the panel opens.
  // Without this, an already-uploaded image/video for this (post, format)
  // is invisible the next time the user opens the panel — they see the
  // empty CTA and think "nothing got saved". The detail endpoint already
  // returns `formatMedia` (a per-format URL map) post-2026-05-13, so we
  // can read straight from there without a new endpoint.
  //
  // The kind is inferred from URL extension; we can't trust the file's
  // original MIME because the URL we get back is a public storage URL
  // that doesn't carry it. The check mirrors the Sheet's `MediaSlot`
  // detection so the preview type stays consistent across surfaces.
  useEffect(() => {
    if (!postId) return
    let cancelled = false
    fetch(`/api/core-posts/${postId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.post) return
        const map = data.post.formatMedia as
          | Record<string, string>
          | undefined
        const existingUrl = map?.[format]
        if (!existingUrl) return
        const looksLikeVideo = /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(
          existingUrl,
        )
        setPreviewUrl(existingUrl)
        setPreviewKind(looksLikeVideo ? "video" : "image")
        // For images, keep the skeleton on until the <img> actually
        // decodes (the URL being set doesn't mean the bytes are painted
        // yet). For videos, the <video> element shows its own poster +
        // controls, so we don't need an extra placeholder.
        if (!looksLikeVideo) setImageLoading(true)
      })
      .catch((err) => {
        // Surface the failure but don't block the panel — the user can
        // still upload a fresh asset, it just won't have a preview of
        // whatever they had before.
        console.warn(
          "[media-upload-flow] failed to hydrate preview",
          err,
        )
      })
      .finally(() => {
        if (!cancelled) setHydrating(false)
      })
    return () => {
      cancelled = true
    }
  }, [postId, format])

  const accepted = acceptedMimeForFormat(format)

  /**
   * Upload via XHR (not supabase-js) so we get progress events. Same
   * pattern as the talking_head video upload above — keeping this
   * consistent across the file means the user sees the same progress
   * toast UI regardless of which format they're uploading to.
   */
  const handleUpload = async (file: File) => {
    if (!postId) {
      toast.error("שמרו קודם את הפוסט כדי להעלות מדיה", { duration: 4000 })
      return
    }

    const sizeMb = file.size / 1024 / 1024
    if (sizeMb > MAX_FILE_MB) {
      toast.error(
        `הקובץ גדול מדי (${sizeMb.toFixed(1)}MB). מקסימום ${MAX_FILE_MB}MB.`,
        { duration: 6000 },
      )
      return
    }

    const isVideo = file.type.startsWith("video/")
    if (isVideo && !accepted.acceptsVideo) {
      toast.error("הפורמט הזה תומך רק בתמונות", { duration: 4000 })
      return
    }

    // Local preview — instant feedback. The blob URL gets replaced with
    // the persistent URL once the upload completes.
    const localBlobUrl = URL.createObjectURL(file)
    setPreviewUrl(localBlobUrl)
    setPreviewKind(isVideo ? "video" : "image")
    setUploading(true)

    const sizeMbStr = sizeMb.toFixed(1)
    const renderProgress = (pct: number, loadedMb?: string) => (
      <div className="flex flex-col gap-1.5 w-full" dir="rtl">
        <div className="flex items-center justify-between text-xs text-text-primary-default">
          <span>מעלה מדיה...</span>
          <span className="text-text-neutral-default">
            {loadedMb ? `${loadedMb} / ${sizeMbStr}MB · ${pct}%` : `${pct}%`}
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-95 rounded-full overflow-hidden">
          <div
            className="h-full bg-yellow-50 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
    // Loading toast must auto-dismiss explicitly when we replace it (sonner
    // inherits the duration on `id` updates — without `duration: 3000` on
    // the success replace, this toast would hang forever).
    const uploadToast = toast.loading(renderProgress(0), { duration: Infinity })

    try {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!user || !session) {
        toast.error("לא מזוהה משתמש. רעננו ונסו שוב.", { id: uploadToast })
        setUploading(false)
        return
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "bin"
      const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "bin"
      const subfolder = isVideo ? "video" : "image"
      const storagePath = `${user.id}/${subfolder}/${crypto.randomUUID()}.${safeExt}`
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

      const { ok, error: uploadErrMsg } = await new Promise<{
        ok: boolean
        error?: string
      }>((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open(
          "POST",
          `${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${storagePath}`,
        )
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`)
        xhr.setRequestHeader("apikey", anonKey)
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            const loadedMb = (e.loaded / 1024 / 1024).toFixed(1)
            toast.loading(renderProgress(pct, loadedMb), {
              id: uploadToast,
              duration: Infinity,
            })
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ok: true })
          } else {
            let msg = `Status ${xhr.status}`
            try {
              const r = JSON.parse(xhr.responseText)
              msg = r.message || r.error || msg
            } catch {
              /* response wasn't JSON, keep the status string */
            }
            resolve({ ok: false, error: msg })
          }
        }
        xhr.onerror = () => resolve({ ok: false, error: "שגיאת רשת" })
        xhr.send(file)
      })

      if (!ok) {
        console.error("[media-upload-flow] storage upload failed:", uploadErrMsg)
        toast.error(`העלאת המדיה נכשלה: ${uploadErrMsg}`, {
          id: uploadToast,
          duration: 8000,
        })
        // Roll back the optimistic preview so the user knows nothing landed.
        URL.revokeObjectURL(localBlobUrl)
        setPreviewUrl(null)
        setPreviewKind(null)
        setUploading(false)
        return
      }

      const publicUrl = supabase.storage
        .from(MEDIA_BUCKET)
        .getPublicUrl(storagePath).data.publicUrl

      // Persist to media_assets via the generic endpoint.
      const assetType = isVideo ? "video" : "image"
      const persistRes = await fetch(`/api/core-posts/${postId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, url: publicUrl, assetType }),
      })

      if (!persistRes.ok) {
        const persistErr = await persistRes.json().catch(() => ({}))
        const detail = (persistErr as { error?: string }).error ?? "שגיאה לא ידועה"
        toast.error(`לא הצלחנו לשמור את המדיה: ${detail}`, {
          id: uploadToast,
          duration: 8000,
        })
        URL.revokeObjectURL(localBlobUrl)
        setPreviewUrl(null)
        setPreviewKind(null)
        setUploading(false)
        return
      }

      // Replace the blob preview with the persistent URL — keeps the same
      // visual but means a re-render won't flicker if React re-mounts.
      URL.revokeObjectURL(localBlobUrl)
      setPreviewUrl(publicUrl)
      setUploading(false)
      toast.success("מדיה נשמרה", { id: uploadToast, duration: 3000 })
    } catch (err) {
      console.error("[media-upload-flow] unexpected error:", err)
      toast.error(
        `שגיאה בהעלאה: ${err instanceof Error ? err.message : String(err)}`,
        { id: uploadToast, duration: 8000 },
      )
      URL.revokeObjectURL(localBlobUrl)
      setPreviewUrl(null)
      setPreviewKind(null)
      setUploading(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    // Reset so picking the same file again still triggers a change event.
    e.target.value = ""
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    handleUpload(file)
  }

  const commitDriveUrl = () => {
    if (!postId) return
    if (!driveDirty) return
    setFormatMeta(postId, format as FormatId, {
      driveUrl: driveUrl.trim() || undefined,
    })
    setDriveDirty(false)
    if (driveUrl.trim().length > 0) {
      toast.success("קישור הדרייב נשמר", { duration: 3000 })
    }
  }

  // The "saved post required" warning lives at the top of the panel —
  // both tabs need it because both write paths touch postId. We surface
  // it as an inline banner instead of disabling controls because the user
  // can still SEE the structure of the panel and understand what comes
  // next once they save.
  const showNoPostWarning = !postId

  // Layout matches the editable Sheet's MediaBlock + DriveLinkBlock pair:
  // upload area on top, "או" divider, Drive URL input below. Single
  // visual rhythm — no tabs hiding either path.
  return (
    <div dir="rtl" className="flex flex-col gap-4 w-full">
      {showNoPostWarning && (
        <Alert>
          <AlertTitle>שמרו את הפוסט קודם</AlertTitle>
          <AlertDescription>
            אחרי שמירה תוכלו להעלות מדיה או לקשר לדרייב.
          </AlertDescription>
        </Alert>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={accepted.accept}
        onChange={handleFileInput}
        className="hidden"
        aria-hidden
      />

      {hydrating ? (
        // Skeleton phase — we haven't checked yet whether this (post,
        // format) has saved media. Showing the empty upload CTA here
        // would briefly read as "nothing got saved" before the URL
        // arrives and the image renders. Skeleton bridges that gap.
        <Skeleton className="aspect-square w-full rounded-xl" />
      ) : previewUrl ? (
        <div className="flex flex-col gap-3">
          <div className="relative aspect-square rounded-xl overflow-hidden bg-bg-surface border border-border-neutral-default">
            {previewKind === "video" ? (
              <video
                src={
                  previewUrl.startsWith("blob:")
                    ? previewUrl
                    : `${previewUrl}#t=0.001`
                }
                controls
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <>
                {imageLoading && (
                  // Overlay skeleton — covers the <img> until the bytes
                  // decode. We keep the <img> mounted underneath so the
                  // browser actually starts the request; the onLoad
                  // handler tears the skeleton down.
                  <Skeleton
                    className="absolute inset-0 rounded-xl"
                    aria-hidden
                  />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="המדיה שהועלתה"
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageLoading(false)}
                  className={`w-full h-full object-cover transition-opacity duration-200 ${
                    imageLoading ? "opacity-0" : "opacity-100"
                  }`}
                />
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !postId}
            className="gap-1.5"
          >
            <Upload className="size-3.5" />
            החליפו מדיה
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          disabled={uploading || !postId}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border-neutral-default p-8 hover:border-yellow-50 hover:bg-bg-surface-primary-default transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          aria-label="העלאת מדיה"
        >
          {uploading ? (
            <Loader2 className="size-8 text-text-neutral-default animate-spin" />
          ) : (
            <ImagePlus className="size-8 text-text-neutral-default" />
          )}
          <span className="text-small font-semibold text-text-primary-default">
            {uploading ? "מעלים..." : "גררו מדיה לכאן או לחצו לבחירה"}
          </span>
          <span className="text-xs text-text-neutral-default">
            {accepted.helperText}
          </span>
        </button>
      )}

      {/* "או" divider — same pattern as the Sheet's MediaBlock →
          DriveLinkBlock pair. Two ways to attach media; one visual flow. */}
      <div
        role="separator"
        aria-label="או"
        className="flex items-center gap-3 text-xs-body text-text-neutral-default"
      >
        <span className="flex-1 h-px bg-border-neutral-default" aria-hidden />
        <span>או</span>
        <span className="flex-1 h-px bg-border-neutral-default" aria-hidden />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={`drive-url-${format}`}
          className="text-xs-body text-text-neutral-default font-normal"
        >
          קישור לתיקיית Drive
        </Label>
        <div className="relative">
          <Input
            id={`drive-url-${format}`}
            dir="rtl"
            inputSize="small"
            type="url"
            value={driveUrl}
            onChange={(e) => {
              setDriveUrl(e.target.value)
              setDriveDirty(true)
            }}
            onBlur={commitDriveUrl}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur()
              }
            }}
            placeholder="https://drive.google.com/..."
            className="pe-10 text-right"
            disabled={!postId}
            aria-label="קישור לתיקיית Drive"
          />
          <button
            type="button"
            onClick={() => {
              const url = driveUrl.trim()
              if (url) window.open(url, "_blank", "noopener,noreferrer")
            }}
            disabled={!driveUrl.trim()}
            aria-label="פתחו את הקישור בכרטיסייה חדשה"
            className="absolute end-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Link2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
