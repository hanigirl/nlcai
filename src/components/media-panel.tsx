"use client"

import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react"
import Image from "next/image"
import { X, Smartphone, Video, Layers, Image as ImageIcon, ImagePlus, Mic, Square, RefreshCw, ChevronDown, Loader2, CircleCheck, Download, ChevronLeft, ChevronRight, Link2, Plus, Trash2, Type, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { AvatarPicker, type Avatar } from "@/components/avatar-picker"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmModal } from "@/components/confirm-modal"
import { DriveVideoPreview } from "@/components/drive-video-preview"
import {
  isDriveUrl,
  isCompleteDriveUrl,
  isVideoUrl,
  extractDriveFileId,
  driveThumbnailUrl,
} from "@/lib/drive-media"
import {
  subscribeGeneration,
  getGenerationSnapshot,
  startImageGeneration,
  addGenerationResult,
  removeGenerationResult,
  hydrateCandidates,
} from "@/lib/image-generation-store"
import {
  subscribeStoryGeneration,
  getStoryGenerationSnapshot,
  startStoryGeneration,
  removeStoryGenerationSet,
} from "@/lib/story-generation-store"
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
  /**
   * Reports the persisted image_post media URL up to the parent so the
   * approved image can render as its own workflow card next to the
   * script (same pattern as talking_head's lifted video URL). Fires after
   * a successful save — AI-generated or manual upload.
   */
  onImagePostUrlChange?: (url: string | null) => void
  /**
   * Reports the saved story frame set up to the parent so it renders as its
   * own workflow card next to the story script. Fires on save (the set) and
   * on delete (null). Same pattern as onImagePostUrlChange.
   */
  onStoryImagesChange?: (images: string[] | null) => void
  /**
   * Reports the finished story VIDEO (the user's clip with the hook burned
   * in) up to the parent so it renders as its own workflow card next to the
   * story script — the video counterpart of onStoryImagesChange. Fires after
   * the caption is burned in, on hydration of a burned clip, and on delete
   * (null).
   */
  onStoryVideoUrlChange?: (url: string | null) => void
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
  onImagePostUrlChange,
  onStoryImagesChange,
  onStoryVideoUrlChange,
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
            onImagePostUrlChange={onImagePostUrlChange}
            onStoryImagesChange={onStoryImagesChange}
            onStoryVideoUrlChange={onStoryVideoUrlChange}
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
  // --- Google Drive link state ---
  // The talking_head format takes its media from a Google Drive share link
  // (not a local upload) — we download it server-side and store it, so it
  // lands as a persistent video card exactly like an avatar-generated video.
  const [driveLink, setDriveLink] = useState("")
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  // Auto-fetch: once the field holds a complete Drive link we pull it
  // automatically (no button). Debounced, with a guard so the same link
  // isn't fetched twice.
  const driveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDriveRef = useRef<string>("")

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
    setDriveLink("")
    setDriveError(null)
    lastDriveRef.current = ""
  }

  // NOTE (2026-07-27): the canvas frame-grab helper that used to live here
  // was removed with the Drive link-mode switch. It only ever fed the
  // cover generator, and a Drive-hosted video taints the canvas (no CORS),
  // so the cover now comes from Drive's own poster endpoint instead.

  /**
   * Attach the talking_head media sitting behind a Google Drive share link.
   *
   * VIDEO (the common case) is link-mode: we probe the link to confirm it
   * resolves and to learn its kind, then keep the LINK as the media. No
   * bytes are copied, so there is no size ceiling and no upload wait — the
   * file is only ever downloaded at render time (story caption burn-in).
   *
   * IMAGE still goes through the old download-and-store path: images are
   * small, and the canvas/compositing steps downstream need same-origin
   * bytes. See the invariant note in `lib/drive-media.ts`.
   */
  const processDriveLink = async (rawLink: string) => {
    const link = rawLink.trim()
    if (!link) return
    if (!isDriveUrl(link)) {
      setDriveError("זה לא נראה כמו קישור של גוגל דרייב.")
      return
    }

    const driveErrorMessages: Record<string, string> = {
      invalid_drive_link: "לא זוהה קובץ בקישור. ודאו שזה קישור ישיר לקובץ בדרייב.",
      drive_not_public: 'הקובץ לא ציבורי. שנו את ההרשאה ל„כל מי שיש לו הקישור” ונסו שוב.',
      drive_timeout: "גוגל דרייב לא מגיב. בדקו שהקובץ משותף ונסו שוב.",
      file_too_large: "הקובץ גדול מדי (מקסימום 50MB).",
    }

    setDriveError(null)
    setDriveLoading(true)
    // Flipped once the media is actually attached — drives the retry reset
    // in `finally` below.
    let attached = false
    try {
      // Probe first — one round trip, no transfer. Tells us video vs image.
      // The client-side timeout is the last line of defence: whatever
      // happens upstream, this spinner must resolve into a result or an
      // error, never sit there indefinitely.
      const infoRes = await fetch("/api/media/drive-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
        signal: AbortSignal.timeout(30_000),
      })
      const info = await infoRes.json()
      if (!infoRes.ok || info.error) {
        setDriveError(
          driveErrorMessages[info.error] ?? "טעינת המדיה מהדרייב נכשלה. נסו שוב.",
        )
        return
      }

      if (info.kind === "image") {
        // Images keep the copy-to-storage path.
        const res = await fetch("/api/media/from-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          setDriveError(
            driveErrorMessages[data.error] ?? "טעינת המדיה מהדרייב נכשלה. נסו שוב.",
          )
          return
        }
        onVideoUrlChange(data.url)
        setVideoPhase("done")
        attached = true
        toast.success("המדיה נטענה מהדרייב")
        return
      }

      // Video → keep the link itself as the media.
      onVideoUrlChange(link)
      setVideoPhase("done")
      attached = true
      toast.success("הסרטון מהדרייב חובר לפוסט")

      // The link work is DONE here. Clear the Drive spinner before the cover
      // step so a slow (or failing) cover generation can never read as "still
      // loading from Drive" — the cover has its own `coverLoading` indicator.
      setDriveLoading(false)

      // Cover: we can't read a frame off a Drive-hosted video (canvas would
      // taint — Drive sends no CORS headers), so use Drive's server-rendered
      // poster instead. The cover route fetches remote URLs server-side, so
      // handing it the thumbnail URL works exactly like a data URL frame.
      const fileId = extractDriveFileId(link)
      const posterUrl = fileId ? driveThumbnailUrl(fileId) : undefined
      const coverTitle = hookText || transcript || "ריל חדש"
      setCoverLoading(true)
      onCoverLoadingChange?.(true)
      try {
        const coverRes = await fetch("/api/reel-cover/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thumbnail_url: posterUrl,
            title: coverTitle,
            pill_color: pillColor,
          }),
        })
        const coverData = await coverRes.json()
        if (coverData.covers?.[0]) onCoverImageChange(coverData.covers[0])
      } catch (err) {
        console.error("[media-panel][cover-from-drive]", err)
      } finally {
        setCoverLoading(false)
        onCoverLoadingChange?.(false)
      }
    } catch (err) {
      console.error("[media-panel][drive-link]", err)
      const timedOut = err instanceof DOMException && err.name === "TimeoutError"
      setDriveError(
        timedOut
          ? "הבדיקה מול גוגל דרייב לקחה יותר מדי זמן. ודאו שהקובץ משותף ונסו שוב."
          : "שגיאת רשת בטעינת המדיה. נסו שוב.",
      )
    } finally {
      setDriveLoading(false)
      // A FAILED attempt must not be remembered as "already handled", or
      // re-pasting the same link would be silently ignored by the debounce.
      if (!attached) lastDriveRef.current = ""
    }
  }

  // Debounced auto-fetch: fires as soon as the field holds a full Drive link
  // (with an extractable file id), so the user never taps a button.
  const scheduleDrive = (value: string) => {
    if (driveDebounceRef.current) clearTimeout(driveDebounceRef.current)
    const link = value.trim()
    if (!isCompleteDriveUrl(link) || link === lastDriveRef.current) return
    driveDebounceRef.current = setTimeout(() => {
      lastDriveRef.current = link
      processDriveLink(link)
    }, 500)
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
        {/* Media from a Google Drive link */}
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-small font-semibold text-text-primary-default">
            <Link2 className="size-4 text-text-neutral-default" />
            קישור מגוגל דרייב
          </label>
          <Input
            dir="ltr"
            value={driveLink}
            onChange={(e) => {
              const v = e.target.value
              setDriveLink(v)
              if (driveError) setDriveError(null)
              scheduleDrive(v) // auto-fetch once the link is complete
            }}
            placeholder="https://drive.google.com/file/d/..."
            disabled={driveLoading}
            className="text-xs"
          />
          {driveLoading ? (
            <p className="flex items-center gap-2 text-xs text-text-neutral-default">
              <Loader2 className="size-3.5 animate-spin text-yellow-50" />
              טוען מהדרייב...
            </p>
          ) : driveError ? (
            <p className="text-xs text-button-destructive-default">{driveError}</p>
          ) : (
            <p className="text-xs text-text-neutral-default">
              הדביקו קישור לסרטון בדרייב עם הרשאת „כל מי שיש לו הקישור”. הסרטון
              יתנגן ישירות מהדרייב — בלי הגבלת גודל.
            </p>
          )}
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
              {/* A Drive-hosted video plays through Drive's embed player —
                  it can't back a <video src> (no CORS, virus-scan gate).
                  Everything else is a blob or a storage URL, where the
                  `#t=0.001` fragment forces a first-frame poster. */}
              {isDriveUrl(liftedVideoUrl) ? (
                <DriveVideoPreview url={liftedVideoUrl} label="הסרטון שלכם" />
              ) : (
                <video
                  src={liftedVideoUrl.startsWith("blob:") ? liftedVideoUrl : `${liftedVideoUrl}#t=0.001`}
                  controls={false}
                  playsInline
                  muted
                  preload="metadata"
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={(e) => { const v = e.target as HTMLVideoElement; if (v.paused) v.play(); else v.pause() }}
                />
              )}
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
          <Button variant="outline" onClick={handleStartOver} size="sm" className="flex-1 gap-1.5">
            <RefreshCw className="size-3.5" />
            החלף מדיה
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

// Parse carousel text ("שקופית N" blocks) into slides
function parseTextToSlides(text: string): SlideData[] {
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

// Sample cover shown in template-tile previews when the post has no
// carousel text yet.
const SAMPLE_COVER: SlideData = {
  slide: 1,
  type: "cover",
  title: "ככה תיראה הקרוסלה שלכם",
  body: "תצוגה מקדימה של הטמפלט",
}

// Generated carousel sets survive panel switches: the user can start a
// carousel generation, move to another format (e.g. image post) and come
// back — the fetch keeps running, writes here on completion (module scope
// outlives the component), and the completion toast points them back.
// Keyed by postId → templateId → slides.
const carouselGenCache = new Map<string, Record<string, string[]>>()

// Result dialogs already shown once ("postId:templateId") — a set that
// finished while the panel was closed auto-opens on the next mount, but
// only the first time; after the user closes it, it stays on the tile.
const carouselResultSeen = new Set<string>()

// Pseudo-"template" key for a carousel imported from per-slide Drive links.
// It isn't a real template — it only lets a Drive-imported set reuse the
// shared preview dialog (`generatedByTemplate[DRIVE_IMPORT_KEY]`). The
// saved-template guard filters it out, so it never masquerades as a tile.
const DRIVE_IMPORT_KEY = "__drive_import__"

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
  // No separate "current carousel" tile (Hani 2026-07-09): the template
  // that made the saved carousel shows its real cover, starts SELECTED,
  // and tapping it opens the saved slides — one tile, one selection ring.
  // The template the saved carousel was generated with (written on approve):
  const [savedTemplateId] = useState<string | undefined>(() => {
    if (!postId || typeof window === "undefined") return undefined
    const tid = getFormatMeta(postId, "carousel").templateId
    return tid && CAROUSEL_TEMPLATES.some((t) => t.id === tid) ? tid : undefined
  })

  const [selectedTemplate, setSelectedTemplate] = useState(
    () => savedTemplateId ?? CAROUSEL_TEMPLATES[0].id,
  )
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)

  // Live slide-1 previews per template (base64 PNG). Every tile shows its
  // static sample thumbnail immediately; satori templates then swap in a
  // render of the USER'S actual cover. AI tiles keep the sample — a real
  // gpt-image-2 render happens only on יצירת קרוסלה (it costs money).
  const [tilePreviews, setTilePreviews] = useState<Record<string, string>>({})

  // Generated slide sets per template — switching templates keeps each
  // design's slides so the user can compare. The parent (persisted) copy
  // always holds the most recent generation and is surfaced through the
  // "current carousel" tile, not attributed to any template. Seeded from
  // the module cache so sets generated while this panel was closed (or
  // another format was open) are still here.
  const [generatedByTemplate, setGeneratedByTemplate] = useState<
    Record<string, string[]>
  >(() => (postId ? { ...(carouselGenCache.get(postId) ?? {}) } : {}))

  // Attribute the saved carousel to the template that made it, as soon as
  // the images hydrate (they can arrive async after mount) — so opening
  // that template's dialog shows the saved slides without an approve
  // button. Selection stays wherever the user put it.
  useEffect(() => {
    if (!savedTemplateId || !images || images.length === 0) return
    setGeneratedByTemplate((p) =>
      p[savedTemplateId] ? p : { ...p, [savedTemplateId]: images },
    )
  }, [savedTemplateId, images])

  // A generation that finished while this panel was closed left its result
  // only in the module cache — surface it once, in the dialog, on mount.
  useEffect(() => {
    if (!postId) return
    const cached = carouselGenCache.get(postId)
    if (!cached) return
    for (const [tid, slides] of Object.entries(cached)) {
      const key = `${postId}:${tid}`
      if (carouselResultSeen.has(key)) continue
      if (images && slides === images) continue
      carouselResultSeen.add(key)
      setSelectedTemplate(tid)
      setDialogFor(tid)
      setPreviewIndex(0)
      break
    }
    // Mount-only: cached results are read once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The user's actual cover slide (or a sample when there's no text yet)
  const previewCover = useMemo<SlideData>(() => {
    const parsed = carouselText ? parseTextToSlides(carouselText) : []
    return parsed[0] ?? SAMPLE_COVER
  }, [carouselText])

  useEffect(() => {
    let cancelled = false
    for (const t of CAROUSEL_TEMPLATES) {
      if (t.kind === "ai") continue
      fetch("/api/carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides: [previewCover], templateId: t.id }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && data.images?.[0]) {
            setTilePreviews((p) => ({ ...p, [t.id]: data.images[0] }))
          }
        })
        .catch((err) =>
          console.error("[media-panel][template-preview]", t.id, err),
        )
    }
    return () => {
      cancelled = true
    }
  }, [previewCover])

  // AI templates (kind: "ai") render via gpt-image-2 on the user's OpenAI
  // key — different endpoint, much longer, and it costs real money.
  const selectedConfig = CAROUSEL_TEMPLATES.find((t) => t.id === selectedTemplate)
  const isAiTemplate = selectedConfig?.kind === "ai"

  const handleGenerate = async () => {
    if (!carouselText.trim()) return
    setGenerating(true)
    setError(null)

    const parsedSlides = parseTextToSlides(carouselText)
    if (parsedSlides.length === 0) {
      setError("לא נמצאו סליידים בטקסט הקרוסלה")
      setGenerating(false)
      return
    }

    // Bottom-of-screen toast per generation — parallel generations across
    // formats (carousel + image post + ...) stack vertically via sonner.
    // The toast + module cache outlive this component, so the user can
    // switch panels mid-generation and still get the result.
    const templateName = selectedConfig?.name ?? ""
    const genId = selectedTemplate
    const genToast = toast.loading(
      isAiTemplate
        ? `מציירים קרוסלת AI (${templateName})... זה לוקח כמה דקות`
        : `יוצרים קרוסלה (${templateName})...`,
      { duration: Infinity },
    )

    try {
      onSlidesChange(parsedSlides)

      const res = await fetch(
        isAiTemplate ? "/api/carousel/generate-ai" : "/api/carousel/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slides: parsedSlides,
            templateId: genId,
          }),
        },
      )

      const data = await res.json()
      if (data.error) {
        // AI route returns a Hebrew user-facing `message` alongside the
        // machine `error` code (e.g. openai_not_connected).
        setError(data.message || data.error)
        toast.error(data.message || data.error, { id: genToast, duration: 8000 })
      } else if (data.images) {
        // Cache + preview only — the post's carousel changes when the
        // user approves inside the dialog, not on generation.
        if (postId) {
          carouselGenCache.set(postId, {
            ...(carouselGenCache.get(postId) ?? {}),
            [genId]: data.images,
          })
        }
        setGeneratedByTemplate((p) => ({ ...p, [genId]: data.images }))
        setDialogFor(genId)
        setPreviewIndex(0)
        toast.success(`הקרוסלה (${templateName}) מוכנה`, {
          id: genToast,
          duration: 5000,
        })
      }
    } catch (err) {
      console.error("[media-panel][generate-carousel]", err)
      setError("שגיאה ביצירת הקרוסלה")
      toast.error("שגיאה ביצירת הקרוסלה", { id: genToast, duration: 8000 })
    } finally {
      setGenerating(false)
    }
  }

  // Preview dialog (mirrors the image_post lightbox): holds WHOSE slides
  // are being previewed. The post's carousel changes only when the user
  // approves in the dialog.
  const [dialogFor, setDialogFor] = useState<string | null>(null)
  const dialogSlides = dialogFor
    ? (generatedByTemplate[dialogFor] ?? null)
    : null
  // Approving what's already the post's carousel is meaningless (the saved
  // set is seeded by reference, so identity comparison is enough).
  const dialogCanApprove = !!dialogFor && dialogSlides !== images

  // Any template dialog that actually opened counts as "seen" — so the
  // auto-open-on-mount effect never re-shows a result the user already saw.
  useEffect(() => {
    if (!postId || !dialogFor) return
    carouselResultSeen.add(`${postId}:${dialogFor}`)
  }, [postId, dialogFor])

  const openDialog = (id: string) => {
    setDialogFor(id)
    setPreviewIndex(0)
  }

  const handleApprove = () => {
    if (!dialogSlides || !dialogFor) return
    onImagesChange(dialogSlides)
    // Remember which template made the post's carousel — its tile is the
    // selected one next time the panel opens.
    if (postId) {
      setFormatMeta(postId, "carousel", { templateId: dialogFor })
    }
    setDialogFor(null)
  }

  // --- Drive slide import (per-slide links → base64 carousel) ---------------
  // Research (2026-07-12): creators hand off a carousel as INDIVIDUAL per-slide
  // images, not one bundled file — so we pull one Drive file per slide and
  // assemble them in list order. `from-drive` with `store:false` returns base64
  // (the carousel pipeline is base64 in-memory and re-stores on save), so no
  // orphan Storage file is left behind.
  const [driveSlideLinks, setDriveSlideLinks] = useState<string[]>(["", ""])
  const [driveImporting, setDriveImporting] = useState(false)
  const [driveImportProgress, setDriveImportProgress] = useState("")
  const [driveImportError, setDriveImportError] = useState<string | null>(null)

  const setDriveSlideLink = (i: number, v: string) =>
    setDriveSlideLinks((prev) => prev.map((l, idx) => (idx === i ? v : l)))
  const addDriveSlideRow = () =>
    setDriveSlideLinks((prev) => (prev.length >= 10 ? prev : [...prev, ""]))
  const removeDriveSlideRow = (i: number) =>
    setDriveSlideLinks((prev) => prev.filter((_, idx) => idx !== i))

  const handleDriveImport = async () => {
    const links = driveSlideLinks.map((l) => l.trim()).filter(Boolean)
    if (links.length === 0) {
      setDriveImportError("הדביקו לפחות קישור אחד לשקופית")
      return
    }
    // Every link must be a Drive/Docs file — we PULL the bytes (Canva can't be
    // downloaded; it belongs in the reference-link block below).
    if (links.some((l) => !/drive\.google\.com|docs\.google\.com/i.test(l))) {
      setDriveImportError("כל הקישורים צריכים להיות מגוגל דרייב (קאנבה לא נתמך כאן)")
      return
    }
    setDriveImportError(null)
    setDriveImporting(true)
    const errMap: Record<string, string> = {
      invalid_drive_link: "לא זוהה קובץ באחד הקישורים.",
      drive_not_public:
        'אחד הקבצים לא ציבורי — שנו הרשאה ל„כל מי שיש לו הקישור”.',
      file_too_large: `אחת השקופיות גדולה מדי (מקסימום ${MAX_FILE_MB}MB).`,
      not_an_image: "אחד הקישורים אינו תמונה — שקופית קרוסלה חייבת להיות תמונה.",
    }
    try {
      const slides: string[] = []
      for (let i = 0; i < links.length; i++) {
        setDriveImportProgress(`טוען שקופית ${i + 1} מתוך ${links.length}...`)
        const res = await fetch("/api/media/from-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: links[i], store: false }),
        })
        const data = await res.json()
        if (!res.ok || data.error || !data.base64) {
          setDriveImportError(
            `${errMap[data.error] ?? "טעינת אחת השקופיות נכשלה."} (שקופית ${i + 1})`,
          )
          return
        }
        slides.push(data.base64 as string)
      }
      // Make it the post's carousel (same base64 shape as generation → the
      // parent's autosave persists it as media_assets rows).
      onImagesChange(slides)
      // A Drive import isn't a template — clear any template attribution so
      // the saved-template tile logic doesn't mis-point at a stale template.
      if (postId) setFormatMeta(postId, "carousel", { templateId: undefined })
      // Surface what landed through the shared preview dialog (view-only:
      // it's already the post's carousel, so no approve button shows).
      setGeneratedByTemplate((p) => ({ ...p, [DRIVE_IMPORT_KEY]: slides }))
      setDialogFor(DRIVE_IMPORT_KEY)
      setPreviewIndex(0)
      setDriveSlideLinks(["", ""])
      toast.success(`הקרוסלה נטענה מהדרייב (${slides.length} שקופיות)`, {
        duration: 5000,
      })
    } catch (err) {
      console.error("[media-panel][carousel-drive-import]", err)
      setDriveImportError("שגיאת רשת בטעינת השקופיות. נסו שוב.")
    } finally {
      setDriveImporting(false)
      setDriveImportProgress("")
    }
  }

  const handleDownloadAll = async () => {
    if (!dialogSlides) return
    setDownloading(true)

    try {
      const res = await fetch("/api/carousel/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: dialogSlides }),
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

  // --- Unified layout: template thumbnails (always visible, switchable)
  //     → large scrollable view of generated slides → generate/download
  //     actions → link input. Mirrors the image_post media pattern.
  //     No script preview here (Hani 2026-07-09) — the carousel text
  //     still feeds generation via the `carouselText` prop, it's just
  //     not displayed in the panel.
  return (
    <div className="flex flex-col gap-5">
      {/* 1. Template picker — every tile always shows a real sample slide
            (static PNG shipped with the app). Satori templates then swap
            in a live render of the USER'S actual cover; AI tiles keep the
            sample (real gpt-image-2 output is paid, generated only on
            יצירת קרוסלה). */}
      <div className="flex flex-col gap-2">
        <p className="text-small-bold text-text-primary-default">בחרו טמפלט</p>
        <div
          role="radiogroup"
          aria-label="בחירת טמפלט לקרוסלה"
          className="grid grid-cols-3 gap-2"
        >
          {CAROUSEL_TEMPLATES.map((t) => {
            const isSelected = selectedTemplate === t.id
            // A set actually generated for THIS post beats the live cover
            // render, which beats the static sample.
            const generatedCover = generatedByTemplate[t.id]?.[0]
            const livePreview = generatedCover ?? tilePreviews[t.id]
            const tileAspect = t.size
              ? `${t.size.width} / ${t.size.height}`
              : "1 / 1"
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setSelectedTemplate(t.id)
                  // A design that was already generated opens straight in
                  // the preview dialog; otherwise just select it.
                  if (generatedByTemplate[t.id]) openDialog(t.id)
                }}
                className={`flex flex-col gap-1 rounded-xl border p-1 pb-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                  isSelected
                    ? "border-yellow-50 ring-1 ring-yellow-50"
                    : "border-border-neutral-default hover:border-yellow-50"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    livePreview
                      ? `data:image/png;base64,${livePreview}`
                      : t.thumbnailUrl
                  }
                  alt={`שקופית לדוגמה בטמפלט ${t.name}`}
                  className="w-full rounded-lg"
                  style={{ aspectRatio: tileAspect, backgroundColor: t.preview.bg }}
                />
                <span className="w-full truncate text-center text-xs text-text-primary-default">
                  {t.name}
                </span>
              </button>
            )
          })}
        </div>

      </div>

      {/* 2. Actions — previews live in the dialog, not in the panel. */}
      {isAiTemplate && (
        <p className="text-xs-body text-text-neutral-default">
          טמפלט AI מצייר כל שקופית עם gpt-image-2 דרך מפתח ה-OpenAI שלכם —
          זה לוקח כמה דקות.
        </p>
      )}

      <Button
        onClick={handleGenerate}
        disabled={generating || !carouselText.trim()}
        className="w-full gap-2"
      >
        {generating ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {isAiTemplate ? "מציירים עם AI... כמה דקות" : "יוצרים קרוסלה..."}
          </>
        ) : generatedByTemplate[selectedTemplate] ? (
          "יצירה מחדש"
        ) : (
          "יצירת קרוסלה"
        )}
      </Button>

      {/* Preview dialog — scroll through the slides, then approve to make
          this the post's carousel (mirrors the image_post lightbox). */}
      <Dialog
        open={!!dialogFor}
        onOpenChange={(open) => {
          if (!open) setDialogFor(null)
        }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {dialogSlides === images && images
                ? "הקרוסלה שלכם"
                : `תצוגה מקדימה — ${
                    CAROUSEL_TEMPLATES.find((t) => t.id === dialogFor)?.name ?? ""
                  }`}
            </DialogTitle>
          </DialogHeader>

          {dialogSlides && dialogSlides.length > 0 && (
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-full overflow-hidden rounded-xl border border-border-neutral-default bg-bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${dialogSlides[previewIndex]}`}
                  alt={`סלייד ${previewIndex + 1}`}
                  className="w-full h-auto"
                />
              </div>

              {dialogSlides.length > 1 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                    disabled={previewIndex === 0}
                    aria-label="השקופית הקודמת"
                    className="p-1.5 rounded-lg hover:bg-bg-surface disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="size-4 text-text-primary-default" />
                  </button>
                  <span className="text-small text-text-neutral-default">
                    {previewIndex + 1} / {dialogSlides.length}
                  </span>
                  <button
                    onClick={() =>
                      setPreviewIndex(
                        Math.min(dialogSlides.length - 1, previewIndex + 1),
                      )
                    }
                    disabled={previewIndex === dialogSlides.length - 1}
                    aria-label="השקופית הבאה"
                    className="p-1.5 rounded-lg hover:bg-bg-surface disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="size-4 text-text-primary-default" />
                  </button>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {dialogCanApprove && (
              <Button onClick={handleApprove} className="w-full gap-2">
                <CircleCheck className="size-4" />
                בחירת הקרוסלה לפוסט
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleDownloadAll}
              disabled={downloading}
              className="w-full gap-2"
            >
              <Download className="size-4" />
              {downloading ? "מורידים..." : "הורדת הכל (ZIP)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Divider between "generate here" and "bring a ready-made carousel" */}
      <div className="flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-border-neutral-default" />
        <span className="text-xs text-text-neutral-default">או</span>
        <span className="h-px flex-1 bg-border-neutral-default" />
      </div>

      {/* 3. Import from Drive — one direct link per slide, in order. We pull
            each image (base64) and assemble the carousel. This matches how
            creators actually hand off a carousel (individual per-slide
            images), so a single Canva/folder link is intentionally NOT the
            mechanism here. */}
      <div className="flex flex-col gap-2">
        <p className="text-small-bold text-text-primary-default">
          ייבוא שקופיות מגוגל דרייב
        </p>
        <p className="text-xs-body text-text-neutral-default">
          הדביקו קישור ישיר לכל שקופית (עד 10), לפי הסדר. נמשוך את התמונות ונרכיב
          מהן קרוסלה. כל קובץ צריך הרשאת „כל מי שיש לו הקישור”.
        </p>
        <div className="flex flex-col gap-2">
          {driveSlideLinks.map((link, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-xs text-text-neutral-default">
                {i + 1}
              </span>
              <Input
                dir="ltr"
                inputSize="small"
                type="url"
                value={link}
                onChange={(e) => {
                  setDriveSlideLink(i, e.target.value)
                  if (driveImportError) setDriveImportError(null)
                }}
                placeholder="https://drive.google.com/file/d/..."
                disabled={driveImporting}
                className="flex-1 text-xs"
                aria-label={`קישור לשקופית ${i + 1}`}
              />
              {driveSlideLinks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDriveSlideRow(i)}
                  disabled={driveImporting}
                  aria-label={`הסירו את שקופית ${i + 1}`}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-bg-surface hover:text-button-destructive-default disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {driveSlideLinks.length < 10 && (
          <button
            type="button"
            onClick={addDriveSlideRow}
            disabled={driveImporting}
            className="inline-flex items-center gap-1 self-start text-xs text-text-neutral-default transition-colors hover:text-text-primary-default disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            הוסיפו שקופית
          </button>
        )}
        <Button
          onClick={handleDriveImport}
          disabled={driveImporting || driveSlideLinks.every((l) => !l.trim())}
          variant="outline"
          className="w-full gap-2"
        >
          {driveImporting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {driveImportProgress || "טוען..."}
            </>
          ) : (
            "טענו קרוסלה מהדרייב"
          )}
        </Button>
        {driveImportError && (
          <p className="text-xs text-button-destructive-default">
            {driveImportError}
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-button-destructive-default text-center">{error}</p>
      )}
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
  onImagePostUrlChange,
  onStoryImagesChange,
  onStoryVideoUrlChange,
}: {
  format: string
  postId: string | null
  hookText?: string
  onImagePostUrlChange?: (url: string | null) => void
  onStoryImagesChange?: (images: string[] | null) => void
  onStoryVideoUrlChange?: (url: string | null) => void
}) {
  // Local mirror of the saved drive URL — committed to storage on
  // blur/Enter (same pattern as DriveLinkBlock in core-post-sheet.tsx).
  const [driveUrl, setDriveUrl] = useState<string>("")
  const [driveDirty, setDriveDirty] = useState(false)
  // Drive PULL state — when the pasted link is a Google Drive file (not a
  // Canva/other link), we don't just park the string for readiness: we pull
  // the actual file server-side, store it, and show it as the format's media
  // — exactly like the talking_head flow. Canva/other links keep the old
  // "save as a reference link" behaviour (they can't be downloaded).
  const [drivePulling, setDrivePulling] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const driveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDriveRef = useRef<string>("")

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

  // AI generation (image_post only). State lives in a module store keyed
  // by postId — NOT in this component — so generations survive the panel
  // closing (which unmounts this), run in parallel, and their results wait
  // in the store until the panel is reopened. `results` are the generated
  // candidates; `inFlight` is how many are running right now.
  const genKey = postId ?? ""
  const genSubscribe = useCallback(
    (cb: () => void) => subscribeGeneration(genKey, cb),
    [genKey],
  )
  const genSnapshot = useCallback(() => getGenerationSnapshot(genKey), [genKey])
  const genState = useSyncExternalStore(genSubscribe, genSnapshot, genSnapshot)
  const aiPreviews = genState.results
  const inFlight = genState.inFlight
  // `lightboxSrc` is the thumbnail currently opened big in the dialog.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  // Confirm-before-delete for the currently-saved media thumbnail.
  const [pendingDelete, setPendingDelete] = useState(false)

  // AI story generation (story only). Same module-store pattern as
  // image_post, but each generation is a SET of 1-3 frames (`sets`), and the
  // saved set is a separate list of storage URLs (`savedStorySet`) hydrated
  // from the post's `storyImageUrls`.
  const storyGenSubscribe = useCallback(
    (cb: () => void) => subscribeStoryGeneration(genKey, cb),
    [genKey],
  )
  const storyGenSnapshot = useCallback(
    () => getStoryGenerationSnapshot(genKey),
    [genKey],
  )
  const storyGenState = useSyncExternalStore(
    storyGenSubscribe,
    storyGenSnapshot,
    storyGenSnapshot,
  )
  const storySets = storyGenState.sets
  const storyInFlight = storyGenState.inFlight
  // The story set currently saved to the post (storage URLs, or a base64 set
  // optimistically after save until the next reload rehydrates URLs).
  const [savedStorySet, setSavedStorySet] = useState<string[]>([])
  // Story lightbox: which set is open and which frame within it.
  const [storyLightbox, setStoryLightbox] = useState<{
    set: string[]
    index: number
  } | null>(null)
  const [savingStory, setSavingStory] = useState(false)
  const [pendingStoryDelete, setPendingStoryDelete] = useState(false)
  // Story media is either an IMAGE or a VIDEO — the user picks (toggle).
  //   • image → design one with AI, or paste an image link
  //   • video → the user's OWN video, with the hook baked in
  const [storyMode, setStoryMode] = useState<"image" | "video">("image")
  // True while the burn-the-caption-into-the-video render is running.
  const [burningText, setBurningText] = useState(false)
  // A story video whose caption is already baked in — the burn route stores
  // it under a "burned-" filename, so we can tell a finished clip from a raw
  // source across reloads and avoid double-stacking the text.
  const videoTextBurned =
    format === "story" &&
    previewKind === "video" &&
    !!previewUrl &&
    /\/video\/burned-[^/]+\.mp4/.test(previewUrl)

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
    // aiPreviews are NOT reset here — they live in the per-postId store and
    // intentionally persist across panel open/close so in-flight and
    // finished generations wait for the user. Merge any versions kept from
    // a previous session (persisted to localStorage) so nothing is lost on
    // a page reload.
    if (format === "image_post") hydrateCandidates(postId)
    setLightboxSrc(null)
    // Story: reset the saved set + lightbox; the actual saved set is
    // hydrated from storyImageUrls in the media-hydration effect below. The
    // in-memory generated `sets` intentionally persist across open/close.
    setSavedStorySet([])
    setStoryLightbox(null)
    // Default to the image mode; the media-hydration effect flips this to
    // "video" if the post already has a bring-your-own story video.
    setStoryMode("image")
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
        // Story: hydrate the saved AI frame SET (1-3 image rows). Its frames
        // render in the story section, not as the single manual preview.
        if (format === "story") {
          const urls = data.post.storyImageUrls as string[] | undefined
          if (Array.isArray(urls) && urls.length > 0) setSavedStorySet(urls)
        }
        const map = data.post.formatMedia as
          | Record<string, string>
          | undefined
        const existingUrl = map?.[format]
        if (!existingUrl) return
        // Drive links carry no extension — but a Drive URL in media_assets
        // is always a link-mode video (see lib/drive-media.ts), so
        // `isVideoUrl` covers both that and extension-bearing storage URLs.
        const looksLikeVideo = isVideoUrl(existingUrl)
        // Story images belong to the AI frame set (above) — the manual
        // single-preview is reserved for a bring-your-own VIDEO. Skip
        // setting an image preview for story so a saved set's frame-1
        // doesn't also masquerade as the lone "current media".
        if (format === "story" && !looksLikeVideo) return
        setPreviewUrl(existingUrl)
        setPreviewKind(looksLikeVideo ? "video" : "image")
        // A saved story video means the user chose the video path — open the
        // panel on that mode so they land on their clip, not the AI option.
        if (format === "story" && looksLikeVideo) {
          setStoryMode("video")
          // A burned clip is a finished story — surface it as the workflow
          // card too (a raw, not-yet-captioned clip stays panel-only).
          if (/\/video\/burned-[^/]+\.mp4/.test(existingUrl)) {
            onStoryVideoUrlChange?.(existingUrl)
          }
        }
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
      // Lift the persisted image URL so the parent can render it as a
      // workflow card next to the script. image_post only — stories and
      // other formats have no result card in the tree.
      if (format === "image_post" && !isVideo) {
        onImagePostUrlChange?.(publicUrl)
      }
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

  /**
   * Fire an AI image generation for this post. Delegates to the module
   * store, which runs the fetch detached — so it keeps going (and its
   * result is retained) even if the panel closes, and repeated calls run
   * in parallel. The server reads the image_post text straight from the DB
   * (server-authoritative), so no payload is needed beyond postId.
   */
  const handleAiGenerate = () => {
    if (!postId) {
      toast.error("שמרו קודם את הפוסט כדי לייצר תמונה", { duration: 4000 })
      return
    }
    startImageGeneration(postId)
  }

  /** Fire an AI story generation (produces a 1-3 frame set). */
  const handleStoryGenerate = () => {
    if (!postId) {
      toast.error("שמרו קודם את הפוסט כדי לייצר סטורי", { duration: 4000 })
      return
    }
    startStoryGeneration(postId)
  }

  /**
   * Burn the post's hook into the user's story video (server renders the
   * caption + composites it in, cover-cropped to 9:16), then swap the preview
   * to the finished clip. The route persists the result in the same video
   * slot, so nothing else needs to save.
   */
  const handleBurnText = async () => {
    if (!postId) {
      toast.error("שמרו קודם את הפוסט", { duration: 4000 })
      return
    }
    setBurningText(true)
    const toastId = "story-burn"
    toast.loading("מטמיעים את הכיתוב בסרטון...", {
      id: toastId,
      duration: Infinity,
    })
    try {
      const res = await fetch("/api/story/generate-video-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        url?: string
        error?: string
        message?: string
      }
      if (!res.ok || !data.url) {
        toast.error(data.message ?? data.error ?? "הטמעת הכיתוב נכשלה", {
          id: toastId,
          duration: 10000,
        })
        return
      }
      setPreviewUrl(data.url)
      setPreviewKind("video")
      // Lift the finished clip so it renders as the story workflow card.
      onStoryVideoUrlChange?.(data.url)
      toast.success("הכיתוב הוטמע בסרטון", { id: toastId, duration: 4000 })
    } catch (err) {
      toast.error(
        `הטמעת הכיתוב נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: 10000 },
      )
    } finally {
      setBurningText(false)
    }
  }

  /**
   * Persist a generated story SET as the post's story media — the
   * carousel-style multi-image path (PATCH { storyImages }), which wipes the
   * existing story frames and inserts the new set as ordered image rows.
   * Generated frames are base64 (what the PATCH route expects); a set that's
   * already the saved URLs is a no-op.
   */
  const handleStorySave = async (set: string[]) => {
    if (!postId || set.length === 0) return
    // Already-saved URLs → nothing to persist.
    if (set.every((f) => f.startsWith("http"))) {
      setStoryLightbox(null)
      return
    }
    setSavingStory(true)
    try {
      const res = await fetch(`/api/core-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyImages: set }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(`שמירת הסטורי נכשלה: ${err.error ?? "שגיאה"}`, {
          duration: 8000,
        })
        return
      }
      // Optimistic: show this set as the saved one (base64) until the next
      // open rehydrates it as storage URLs. Drop it from the candidate row.
      setSavedStorySet(set)
      removeStoryGenerationSet(postId, set)
      setStoryLightbox(null)
      // Lift the set up so the "הסטורי שלכם" workflow card renders next to
      // the script immediately (no reload needed).
      onStoryImagesChange?.(set)
      toast.success("הסטורי נשמר", { duration: 3000 })
    } catch (e) {
      toast.error(
        `שגיאה בשמירת הסטורי: ${e instanceof Error ? e.message : String(e)}`,
        { duration: 8000 },
      )
    } finally {
      setSavingStory(false)
    }
  }

  /** Clear the saved story set (PATCH { storyImages: null }). */
  const handleStoryDelete = async () => {
    if (!postId) return
    try {
      const res = await fetch(`/api/core-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyImages: null }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(`מחיקת הסטורי נכשלה: ${err.error ?? "שגיאה"}`, {
          duration: 8000,
        })
        return
      }
      setSavedStorySet([])
      onStoryImagesChange?.(null)
      toast.success("הסטורי נמחק", { duration: 3000 })
    } catch (err) {
      toast.error(
        `מחיקת הסטורי נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { duration: 8000 },
      )
    }
  }

  /** Render a story frame that may be a storage URL or raw base64. */
  const storyFrameSrc = (f: string) =>
    f.startsWith("http") ? f : `data:image/png;base64,${f}`

  /**
   * Persist the generated PNG through the SAME path as a manual upload
   * (Storage + /api/core-posts/{id}/media) — one persistence route for
   * all image_post media, whatever its origin.
   *
   * Picking a new image must NOT lose the old one: we capture the current
   * selected image first and re-add it to the kept versions, so every AI
   * generation stays available in the row and can be re-picked later.
   */
  const handleAiSave = async (src: string) => {
    if (!postId) return
    setLightboxSrc(null)
    const previousSelected = previewUrl

    // Storage-backed candidate → record it as the post's media WITHOUT
    // re-uploading (one canonical file, no duplicate). base64 fallbacks
    // (upload had failed) still go through the normal upload path.
    if (src.startsWith("http")) {
      try {
        const res = await fetch(`/api/core-posts/${postId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, url: src, assetType: "image" }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string }
          toast.error(`לא הצלחנו לשמור את המדיה: ${err.error ?? "שגיאה"}`, {
            duration: 8000,
          })
          return
        }
        setPreviewUrl(src)
        setPreviewKind("image")
        onImagePostUrlChange?.(src)
        toast.success("מדיה נשמרה", { duration: 3000 })
      } catch (e) {
        toast.error(
          `שגיאה בשמירה: ${e instanceof Error ? e.message : String(e)}`,
          { duration: 8000 },
        )
        return
      }
    } else {
      const blob = await fetch(src).then((r) => r.blob())
      const file = new File([blob], "ai-image-post.png", { type: "image/png" })
      await handleUpload(file)
    }

    // Keep the previously-selected image in the row so picking never loses
    // a past version.
    if (previousSelected && previousSelected !== src) {
      addGenerationResult(postId, previousSelected)
    }
  }

  /**
   * Delete the currently-saved media for this (post, format). Clears the
   * media_assets row via the DELETE endpoint, then drops the local preview
   * and — for image_post — lifts the removal up so the workflow card
   * ("התמונה שלכם") disappears too. Called from the confirm modal.
   */
  const handleDeleteMedia = async () => {
    if (!postId) return
    const assetType = previewKind === "video" ? "video" : "image"
    try {
      const res = await fetch(
        `/api/core-posts/${postId}/media?format=${encodeURIComponent(format)}&assetType=${assetType}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(`מחיקת המדיה נכשלה: ${err.error ?? "שגיאה לא ידועה"}`, {
          duration: 8000,
        })
        return
      }
      // Fully remove this version — deselect AND drop it from the kept
      // list so "delete" means gone (whereas "pick" keeps old versions).
      const deletedUrl = previewUrl
      setPreviewUrl(null)
      setPreviewKind(null)
      if (format === "image_post") {
        onImagePostUrlChange?.(null)
        if (deletedUrl) removeGenerationResult(postId, deletedUrl)
      }
      // Deleting the story video removes its workflow card too.
      if (format === "story" && assetType === "video") {
        onStoryVideoUrlChange?.(null)
      }
      toast.success("המדיה נמחקה", { duration: 3000 })
    } catch (err) {
      toast.error(
        `מחיקת המדיה נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { duration: 8000 },
      )
    }
  }

  const commitDriveUrl = () => {
    if (!postId) return
    if (!driveDirty) return
    // Drive links become real media assets in the DATABASE (see
    // attachDriveMedia) — that's what makes them survive a different
    // browser or machine. The localStorage readiness meta is only for
    // Canva / other links we can't resolve, which stay as a reference the
    // user opens manually.
    if (isDriveUrl(driveUrl.trim())) return
    setFormatMeta(postId, format as FormatId, {
      driveUrl: driveUrl.trim() || undefined,
    })
    setDriveDirty(false)
    if (driveUrl.trim().length > 0) {
      toast.success("קישור המדיה נשמר", { duration: 3000 })
    }
  }

  /**
   * Attach the media behind a Google Drive link to this (post, format).
   *
   * Two paths, chosen by what the link actually points at:
   *
   *   VIDEO → link mode. We probe the link via `/api/media/drive-info` (one
   *     round trip, no transfer) and then persist the LINK ITSELF as the
   *     format's video asset. Nothing is copied, so there is no size cap
   *     and no upload wait; the file is downloaded exactly once, later, if
   *     the user burns a caption into it. Because the link lands in
   *     `media_assets` — the database, not localStorage — it comes back on
   *     any browser and any machine.
   *
   *   IMAGE → the original download-and-store path. Images are small, and
   *     the AI/canvas/download paths downstream need same-origin bytes.
   *
   * Either way it persists through `/api/core-posts/{id}/media`, so the
   * asset hydrates and deletes exactly like a manual upload.
   *
   * Canva / non-Drive links never reach here — they can't be resolved, so
   * they stay as a reference link the user opens manually (commitDriveUrl).
   */
  const attachDriveMedia = async (rawLink: string) => {
    const link = rawLink.trim()
    if (!postId || !link) return
    if (!isDriveUrl(link)) return
    setDriveError(null)
    setDrivePulling(true)
    // Flipped once the asset is actually persisted — drives the retry reset
    // in `finally` below.
    let attached = false

    const errorMessages: Record<string, string> = {
      invalid_drive_link: "לא זוהה קובץ בקישור. ודאו שזה קישור ישיר לקובץ בדרייב.",
      drive_not_public:
        'הקובץ לא ציבורי. שנו את ההרשאה ל„כל מי שיש לו הקישור” ונסו שוב.',
      drive_timeout: "גוגל דרייב לא מגיב. בדקו שהקובץ משותף ונסו שוב.",
      file_too_large: `הקובץ גדול מדי (מקסימום ${MAX_FILE_MB}MB).`,
    }

    try {
      // Timeout bound so the spinner always resolves — see the matching
      // note in processDriveLink.
      const infoRes = await fetch("/api/media/drive-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
        signal: AbortSignal.timeout(30_000),
      })
      const info = await infoRes.json()
      if (!infoRes.ok || info.error) {
        setDriveError(
          errorMessages[info.error] ?? "טעינת המדיה מהדרייב נכשלה. נסו שוב.",
        )
        return
      }

      const kind: "image" | "video" = info.kind === "video" ? "video" : "image"

      // image_post accepts images only — reject a Drive video with a clear
      // message instead of silently storing something the format can't use.
      if (format === "image_post" && kind === "video") {
        setDriveError("פוסט תמונה תומך רק בתמונות")
        return
      }

      // Video keeps the link; an image is copied into our bucket first.
      let mediaUrl = link
      if (kind === "image") {
        const res = await fetch("/api/media/from-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          setDriveError(
            errorMessages[data.error] ?? "טעינת המדיה מהדרייב נכשלה. נסו שוב.",
          )
          return
        }
        mediaUrl = data.url
      }

      const persistRes = await fetch(`/api/core-posts/${postId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, url: mediaUrl, assetType: kind }),
      })
      if (!persistRes.ok) {
        const err = (await persistRes.json().catch(() => ({}))) as {
          error?: string
        }
        setDriveError(`לא הצלחנו לשמור את המדיה: ${err.error ?? "שגיאה"}`)
        return
      }

      // Surface it in the panel right away. A story IMAGE belongs to the
      // frame-set row (like a saved AI set), so it lands in savedStorySet;
      // everything else is the single current-media slot.
      if (format === "story" && kind === "image") {
        setSavedStorySet([mediaUrl])
        onStoryImagesChange?.([mediaUrl])
      } else {
        setPreviewUrl(mediaUrl)
        setPreviewKind(kind)
        if (kind === "image") setImageLoading(true)
        if (format === "image_post") onImagePostUrlChange?.(mediaUrl)
      }
      // A story video means the user is on the bring-your-own path — land
      // them on that mode so the burn-caption CTA is reachable.
      if (format === "story" && kind === "video") setStoryMode("video")

      // The media is attached — clear the input and its localStorage
      // readiness meta, which only ever backed non-Drive reference links.
      setDriveUrl("")
      setDriveDirty(false)
      lastDriveRef.current = link
      attached = true
      setFormatMeta(postId, format as FormatId, { driveUrl: undefined })
      toast.success(
        kind === "video" ? "הסרטון מהדרייב חובר לפוסט" : "המדיה נטענה מהדרייב",
        { duration: 3000 },
      )
    } catch (err) {
      console.error("[media-upload-flow][drive-attach]", err)
      const timedOut = err instanceof DOMException && err.name === "TimeoutError"
      setDriveError(
        timedOut
          ? "הבדיקה מול גוגל דרייב לקחה יותר מדי זמן. ודאו שהקובץ משותף ונסו שוב."
          : "שגיאת רשת בטעינת המדיה. נסו שוב.",
      )
    } finally {
      setDrivePulling(false)
      // Forget a FAILED attempt so re-pasting the same link retries instead
      // of being swallowed by the debounce's duplicate check. On success the
      // ref is left pointing at the handled link, which is what suppresses a
      // redundant second pull.
      if (!attached) lastDriveRef.current = ""
    }
  }

  /**
   * Debounced auto-attach: fires as soon as the field holds a full Drive
   * link with an extractable file id (mirrors the talking_head panel), so
   * the user never taps a button. Non-Drive links are ignored here and
   * handled by commitDriveUrl on blur.
   */
  const scheduleDrivePull = (value: string) => {
    if (driveDebounceRef.current) clearTimeout(driveDebounceRef.current)
    const link = value.trim()
    if (!isCompleteDriveUrl(link) || link === lastDriveRef.current) return
    driveDebounceRef.current = setTimeout(() => {
      lastDriveRef.current = link
      attachDriveMedia(link)
    }, 500)
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

      {/* IMAGE POST — two clear options: (1) generate with AI, (2) bring
          your own media. The AI section is a camera banner when empty, or
          a thumbnail row (current saved image + generated candidates) once
          there are pictures. The manual path is a single row — paste a
          link OR upload — with no "או" divider. */}
      {format === "image_post" && (
        <>
          {/* CTA. Gated by `hydrating` ONLY so the empty banner doesn't
              flash before we know whether saved media exists. Everything
              below (bring-your-own + the photos row/skeletons) is NOT
              gated — the photos come from the generation store and must
              appear the instant the panel opens, whether a background
              generation already finished or is still running. */}
          {hydrating ? (
            <Skeleton className="h-11 w-full rounded-xl" />
          ) : aiPreviews.length === 0 && !previewUrl && inFlight === 0 ? (
                <button
                  type="button"
                  onClick={handleAiGenerate}
                  disabled={!postId}
                  className="flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white dark:bg-gray-10 p-6 hover:bg-bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                  aria-label="יצירת תמונה בלחיצה"
                >
                  {/* Camera illustration — split into two assets so the tile
                      reads as centered while the sparkle cluster hangs off
                      to its upper-left. */}
                  <div className="relative size-10 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/ai-camera.png"
                      alt=""
                      className="size-full object-contain"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/ai-camera-sparkle.png"
                      alt=""
                      className="pointer-events-none absolute -left-3.5 -top-1 w-5"
                    />
                  </div>
                  <span className="text-small font-semibold text-text-primary-default">
                    יצירת תמונה בלחיצה
                  </span>
                  <span className="text-xs text-text-neutral-default text-center leading-relaxed max-w-[286px]">
                    ניצור תמונה מעוצבת לפי תוכן הפוסט, עם הטקסט של הפורמט
                    (כותרת, תת-כותרת וטקסט תחתון) משולב בעיצוב.
                  </span>
                </button>
              ) : (
                // Stays enabled while generations run so more can be queued
                // in parallel; progress shows as skeletons in the row below.
                <Button
                  onClick={handleAiGenerate}
                  disabled={!postId}
                  className="w-full gap-1.5"
                >
                  <ImagePlus className="size-4" />
                  יצירת תמונה עם AI
                  {inFlight > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs opacity-80">
                      <Loader2 className="size-3.5 animate-spin" />
                      {inFlight}
                    </span>
                  )}
                </Button>
              )}

              {/* Bring your own — paste a Drive/Canva link. Drive links are
                  attached automatically — a video stays in Drive and plays
                  from there, an image is copied over. Canva/other stay as a
                  reference link. Upload-from-computer was removed per Hani. */}
              <div className="flex flex-col gap-2">
                <p className="text-small-bold text-text-primary-default">
                  מדיה משלכם
                </p>
                <div className="relative">
                  <Input
                    dir="rtl"
                    inputSize="small"
                    type="url"
                    value={driveUrl}
                    onChange={(e) => {
                      const v = e.target.value
                      setDriveUrl(v)
                      setDriveDirty(true)
                      if (driveError) setDriveError(null)
                      scheduleDrivePull(v) // Drive link → auto-pull the file
                    }}
                    onBlur={commitDriveUrl}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                    }}
                    placeholder="הדביקו קישור מגוגל דרייב או קנבה"
                    className="pe-9 text-right"
                    disabled={!postId || drivePulling}
                    aria-label="קישור למדיה"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const u = driveUrl.trim()
                      if (u) window.open(u, "_blank", "noopener,noreferrer")
                    }}
                    disabled={!driveUrl.trim()}
                    aria-label="פתחו את הקישור בכרטיסייה חדשה"
                    className="absolute end-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Link2 className="size-3.5" />
                  </button>
                </div>
                {(drivePulling || driveError) && (
                  <p
                    className={`flex items-center gap-1.5 text-xs ${
                      driveError
                        ? "text-button-destructive-default"
                        : "text-text-neutral-default"
                    }`}
                  >
                    {drivePulling && (
                      <Loader2 className="size-3.5 animate-spin text-yellow-50" />
                    )}
                    {driveError ?? "מחברים את המדיה מהדרייב..."}
                  </p>
                )}
              </div>

              {/* Your photos — at the BOTTOM. The saved/current image is
                  highlighted (yellow ring + border + check badge) so it's
                  obvious which one is attached to the post; generated
                  candidates are tappable to view big and pick. */}
              {(aiPreviews.length > 0 || previewUrl || inFlight > 0) && (
                <div className="flex flex-col gap-2">
                  <p className="text-small-bold text-text-primary-default">
                    התמונות שלכם
                  </p>
                  <div className="flex gap-2 overflow-x-auto px-1 py-2">
                    {previewUrl && (
                      <div className="group relative aspect-[4/5] w-[72px] shrink-0 overflow-hidden rounded-lg border-2 border-yellow-50 bg-bg-surface ring-2 ring-yellow-50 ring-offset-2 ring-offset-white dark:ring-offset-gray-10">
                        {imageLoading && (
                          <Skeleton
                            className="absolute inset-0 rounded-lg"
                            aria-hidden
                          />
                        )}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt="המדיה הנבחרת"
                          onLoad={() => setImageLoading(false)}
                          onError={() => setImageLoading(false)}
                          className={`w-full h-full object-cover transition-opacity duration-200 ${
                            imageLoading ? "opacity-0" : "opacity-100"
                          }`}
                        />
                        {/* Selected badge — white circle backdrop keeps the
                            check legible over any image. */}
                        <CircleCheck className="absolute start-1 top-1 size-4 rounded-full bg-white text-yellow-30 shadow-sm" />
                        <button
                          type="button"
                          onClick={() => setPendingDelete(true)}
                          disabled={uploading || !postId}
                          aria-label="מחיקת המדיה"
                          className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-md bg-white/90 text-button-destructive-default opacity-0 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                    {aiPreviews
                      .filter((src) => src !== previewUrl)
                      .map((src, i) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => setLightboxSrc(src)}
                          className="relative aspect-[4/5] w-[72px] shrink-0 overflow-hidden rounded-lg border border-border-neutral-default transition-colors hover:border-yellow-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                          aria-label={`תמונה ${i + 1} — להגדלה ושמירה`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" className="size-full object-cover" />
                        </button>
                      ))}
                    {/* In-progress placeholders — one skeleton per running
                        generation, so parallel generations each show a
                        thumbnail-on-the-way. Appended last to match the
                        order the results land in. */}
                    {Array.from({ length: inFlight }).map((_, i) => (
                      <div
                        key={`gen-${i}`}
                        className="relative aspect-[4/5] w-[72px] shrink-0 overflow-hidden rounded-lg border border-border-neutral-default"
                        aria-label="מייצרים תמונה חדשה"
                      >
                        <Skeleton className="absolute inset-0 rounded-lg" aria-hidden />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="size-5 text-text-neutral-default animate-spin" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
        </>
      )}

      {/* STORY — AI "media-to-story": generate a designed 9:16 frame set
          (1 frame, or up to 3 when the script is long), with the Hebrew
          text baked in. Mirrors the image_post AI section; the manual
          bring-your-own path stays below. */}
      {format === "story" && (
        <>
          {/* Story media is an image or a video — the user picks. */}
          <div className="flex gap-1 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 p-1">
            <button
              type="button"
              onClick={() => setStoryMode("image")}
              aria-pressed={storyMode === "image"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                storyMode === "image"
                  ? "bg-bg-surface-primary-default text-text-primary-default"
                  : "text-text-neutral-default hover:bg-bg-surface"
              }`}
            >
              <ImageIcon className="size-4" />
              תמונה
            </button>
            <button
              type="button"
              onClick={() => setStoryMode("video")}
              aria-pressed={storyMode === "video"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                storyMode === "video"
                  ? "bg-bg-surface-primary-default text-text-primary-default"
                  : "text-text-neutral-default hover:bg-bg-surface"
              }`}
            >
              <Video className="size-4" />
              וידאו
            </button>
          </div>

          {storyMode === "image" && (
          <>
          {hydrating ? (
            <Skeleton className="h-11 w-full rounded-xl" />
          ) : savedStorySet.length === 0 &&
            storySets.length === 0 &&
            storyInFlight === 0 ? (
            <button
              type="button"
              onClick={handleStoryGenerate}
              disabled={!postId}
              className="flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white dark:bg-gray-10 p-6 hover:bg-bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              aria-label="יצירת סטורי בלחיצה"
            >
              <div className="relative size-10 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/ai-camera.png"
                  alt=""
                  className="size-full object-contain"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/ai-camera-sparkle.png"
                  alt=""
                  className="pointer-events-none absolute -left-3.5 -top-1 w-5"
                />
              </div>
              <span className="text-small font-semibold text-text-primary-default">
                יצירת סטורי בלחיצה
              </span>
              <span className="text-xs text-text-neutral-default text-center leading-relaxed max-w-[286px]">
                ניצור סטורי מעוצב לפי טקסט הפורמט, עם הכיתוב משולב בתמונה. טקסט
                ארוך יתחלק אוטומטית לעד 3 פריימים כדי לשמור על קריאוּת.
              </span>
            </button>
          ) : (
            <Button
              onClick={handleStoryGenerate}
              disabled={!postId}
              className="w-full gap-1.5"
            >
              <ImagePlus className="size-4" />
              יצירת סטורי עם AI
              {storyInFlight > 0 && (
                <span className="inline-flex items-center gap-1 text-xs opacity-80">
                  <Loader2 className="size-3.5 animate-spin" />
                  {storyInFlight}
                </span>
              )}
            </Button>
          )}

          {(savedStorySet.length > 0 ||
            storySets.length > 0 ||
            storyInFlight > 0) && (
            <div className="flex flex-col gap-2">
              <p className="text-small-bold text-text-primary-default">
                הסטורי שלכם
              </p>
              <div className="flex gap-2 overflow-x-auto px-1 py-2">
                {/* Saved set — highlighted, tappable, deletable. */}
                {savedStorySet.length > 0 && (
                  <div className="group relative aspect-[9/16] w-[72px] shrink-0 overflow-hidden rounded-lg border-2 border-yellow-50 bg-bg-surface ring-2 ring-yellow-50 ring-offset-2 ring-offset-white dark:ring-offset-gray-10">
                    <button
                      type="button"
                      onClick={() =>
                        setStoryLightbox({ set: savedStorySet, index: 0 })
                      }
                      className="block size-full"
                      aria-label="הסטורי הנבחר — להגדלה"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={storyFrameSrc(savedStorySet[0])}
                        alt="הסטורי הנבחר"
                        className="size-full object-cover"
                      />
                    </button>
                    {savedStorySet.length > 1 && (
                      <span className="absolute bottom-1 start-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                        1/{savedStorySet.length}
                      </span>
                    )}
                    <CircleCheck className="absolute start-1 top-1 size-4 rounded-full bg-white text-yellow-30 shadow-sm" />
                    <button
                      type="button"
                      onClick={() => setPendingStoryDelete(true)}
                      disabled={!postId}
                      aria-label="מחיקת הסטורי"
                      className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-md bg-white/90 text-button-destructive-default opacity-0 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
                {/* Generated candidate sets. */}
                {storySets.map((set, i) => (
                  <button
                    key={`story-set-${i}`}
                    type="button"
                    onClick={() => setStoryLightbox({ set, index: 0 })}
                    className="relative aspect-[9/16] w-[72px] shrink-0 overflow-hidden rounded-lg border border-border-neutral-default transition-colors hover:border-yellow-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                    aria-label={`סטורי ${i + 1} — להגדלה ושמירה`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={storyFrameSrc(set[0])}
                      alt=""
                      className="size-full object-cover"
                    />
                    {set.length > 1 && (
                      <span className="absolute bottom-1 start-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                        1/{set.length}
                      </span>
                    )}
                  </button>
                ))}
                {/* In-progress placeholders — one per running generation. */}
                {Array.from({ length: storyInFlight }).map((_, i) => (
                  <div
                    key={`story-gen-${i}`}
                    className="relative aspect-[9/16] w-[72px] shrink-0 overflow-hidden rounded-lg border border-border-neutral-default"
                    aria-label="מייצרים סטורי חדש"
                  >
                    <Skeleton className="absolute inset-0 rounded-lg" aria-hidden />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="size-5 text-text-neutral-default animate-spin" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
          )}
        </>
      )}

      {/* Bring-your-own media — the video preview + Drive/Canva link input.
          Story shows it in BOTH modes: in "image" mode it's the "paste an
          image link" option next to Create-with-AI; in "video" mode it's how
          the user brings their clip (then burns the caption in).
          Upload-from-computer was removed per Hani; Drive/Canva link only. */}
      {format !== "image_post" && (
        <>
          {!hydrating && previewUrl && (
            <div className="flex flex-col gap-2">
              <p className="text-small-bold text-text-primary-default">
                המדיה הנוכחית
              </p>
              {/* `group` drives the hover-reveal delete icon; video keeps its
                  own bigger playable frame since a 72px poster isn't useful
                  for a clip. */}
              <div className="flex">
                <div
                  className={`group relative shrink-0 overflow-hidden rounded-lg border border-border-neutral-default bg-bg-surface ${
                    previewKind === "video"
                      ? format === "story"
                        ? "aspect-[9/16] w-[200px]" // story = 9:16 portrait
                        : "aspect-square w-full"
                      : "aspect-[4/5] w-[72px]"
                  }`}
                >
                  {isDriveUrl(previewUrl) ? (
                    // Link-mode video — streams from Drive, no copy of ours.
                    <DriveVideoPreview url={previewUrl} label="המדיה שלכם" />
                  ) : previewKind === "video" ? (
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
                        <Skeleton
                          className="absolute inset-0 rounded-lg"
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

                  {/* Hover-reveal delete icon → confirm modal. */}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(true)}
                    disabled={uploading || !postId}
                    aria-label="מחיקת המדיה"
                    className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-md bg-white/90 text-button-destructive-default opacity-0 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Burn the hook into the story video (story mode only). Shown once
              a video is present; once burned, we swap to a "done" state so the
              caption isn't stacked twice. */}
          {format === "story" &&
            storyMode === "video" &&
            !hydrating &&
            previewKind === "video" &&
            previewUrl &&
            (videoTextBurned ? (
              <div className="flex items-center gap-1.5 rounded-lg bg-bg-surface px-3 py-2.5 text-small text-text-primary-default">
                <CircleCheck className="size-4 shrink-0 text-yellow-30" />
                הכיתוב הוטמע בסרטון — הסטורי מוכן
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Button
                  onClick={handleBurnText}
                  disabled={burningText || !postId}
                  className="w-full gap-1.5"
                >
                  {burningText ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Type className="size-4" />
                  )}
                  {burningText
                    ? "מטמיעים את הכיתוב..."
                    : "הטמעת הכיתוב בסרטון"}
                </Button>
                <span className="text-xs text-text-neutral-default text-center">
                  נטמיע את ההוק של הפוסט על גבי הסרטון, בפורמט 9:16
                </span>
              </div>
            ))}

          {/* Bring your own — paste a Drive/Canva link. Drive links are
              attached automatically — a video stays in Drive and plays from
              there, an image is copied over. Canva/other stay as a reference
              link. Upload-from-computer was removed per Hani. */}
          <div className="flex flex-col gap-2">
            <p className="text-small-bold text-text-primary-default">
              {format === "story"
                ? storyMode === "video"
                  ? "הסרטון שלכם"
                  : "או הדביקו קישור לתמונה"
                : "מדיה משלכם"}
            </p>
            <div className="relative">
              <Input
                dir="rtl"
                inputSize="small"
                type="url"
                value={driveUrl}
                onChange={(e) => {
                  const v = e.target.value
                  setDriveUrl(v)
                  setDriveDirty(true)
                  if (driveError) setDriveError(null)
                  scheduleDrivePull(v) // Drive link → auto-pull the file
                }}
                onBlur={commitDriveUrl}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur()
                }}
                placeholder={
                  format === "story" && storyMode === "video"
                    ? "הדביקו קישור לסרטון מגוגל דרייב"
                    : "הדביקו קישור מגוגל דרייב או קנבה"
                }
                className="pe-9 text-right"
                disabled={!postId || drivePulling}
                aria-label="קישור למדיה"
              />
              <button
                type="button"
                onClick={() => {
                  const u = driveUrl.trim()
                  if (u) window.open(u, "_blank", "noopener,noreferrer")
                }}
                disabled={!driveUrl.trim()}
                aria-label="פתחו את הקישור בכרטיסייה חדשה"
                className="absolute end-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Link2 className="size-3.5" />
              </button>
            </div>
            {(drivePulling || driveError) && (
              <p
                className={`flex items-center gap-1.5 text-xs ${
                  driveError
                    ? "text-button-destructive-default"
                    : "text-text-neutral-default"
                }`}
              >
                {drivePulling && (
                  <Loader2 className="size-3.5 animate-spin text-yellow-50" />
                )}
                {driveError ?? "מחברים את המדיה מהדרייב..."}
              </p>
            )}
          </div>
        </>
      )}

      {/* Lightbox — big view of a clicked thumbnail, with the save action.
          Keeping save here (not on the thumbnail) means the user always
          confirms against the full-size image before persisting. */}
      <Dialog
        open={!!lightboxSrc}
        onOpenChange={(open) => {
          if (!open) setLightboxSrc(null)
        }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>תצוגה מקדימה</DialogTitle>
          </DialogHeader>
          {lightboxSrc && (
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-border-neutral-default bg-bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxSrc}
                alt="תצוגה מוגדלת של התמונה שנוצרה"
                className="size-full object-contain"
              />
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => lightboxSrc && handleAiSave(lightboxSrc)}
              disabled={uploading}
              className="w-full gap-1.5"
            >
              <CircleCheck className="size-4" />
              שמירה כתמונת הפוסט
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-before-delete for the saved media thumbnail. */}
      <ConfirmModal
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title="למחוק את המדיה?"
        description="הפעולה תסיר את המדיה מהפוסט. אפשר יהיה לייצר או להעלות מדיה חדשה במקומה."
        confirmLabel="כן, למחוק"
        cancelLabel="ביטול"
        confirmVariant="destructive"
        onConfirm={handleDeleteMedia}
      />

      {/* Story lightbox — scroll through the set's frames, then save the
          whole set. A set already saved opens in view-only (no save). */}
      <Dialog
        open={!!storyLightbox}
        onOpenChange={(open) => {
          if (!open) setStoryLightbox(null)
        }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              תצוגה מקדימה
              {storyLightbox && storyLightbox.set.length > 1
                ? ` — פריים ${storyLightbox.index + 1}/${storyLightbox.set.length}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          {storyLightbox && (
            <div className="flex items-center gap-2">
              {/* Prev (RTL: the frame before this one sits to the right). */}
              {storyLightbox.set.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setStoryLightbox((s) =>
                      s ? { ...s, index: Math.max(0, s.index - 1) } : s,
                    )
                  }
                  disabled={storyLightbox.index === 0}
                  aria-label="הפריים הקודם"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-neutral-default text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="size-4" />
                </button>
              )}
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-border-neutral-default bg-bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={storyFrameSrc(storyLightbox.set[storyLightbox.index])}
                  alt="תצוגה מוגדלת של פריים הסטורי"
                  className="size-full object-contain"
                />
              </div>
              {/* Next (RTL: to the left). */}
              {storyLightbox.set.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setStoryLightbox((s) =>
                      s
                        ? {
                            ...s,
                            index: Math.min(s.set.length - 1, s.index + 1),
                          }
                        : s,
                    )
                  }
                  disabled={storyLightbox.index === storyLightbox.set.length - 1}
                  aria-label="הפריים הבא"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-neutral-default text-text-neutral-default hover:text-text-primary-default hover:bg-bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="size-4" />
                </button>
              )}
            </div>
          )}
          {/* Save only for a candidate set (the saved set is already the
              post's story). Identity compare — the saved set is a distinct
              array reference from any candidate. */}
          {storyLightbox && storyLightbox.set !== savedStorySet && (
            <DialogFooter>
              <Button
                onClick={() => handleStorySave(storyLightbox.set)}
                disabled={savingStory}
                className="w-full gap-1.5"
              >
                {savingStory ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CircleCheck className="size-4" />
                )}
                {storyLightbox.set.length > 1
                  ? `שמירה כסטורי (${storyLightbox.set.length} פריימים)`
                  : "שמירה כסטורי"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm-before-delete for the saved story set. */}
      <ConfirmModal
        open={pendingStoryDelete}
        onOpenChange={setPendingStoryDelete}
        title="למחוק את הסטורי?"
        description="הפעולה תסיר את פריימי הסטורי מהפוסט. אפשר יהיה לייצר סטורי חדש במקומו."
        confirmLabel="כן, למחוק"
        cancelLabel="ביטול"
        confirmVariant="destructive"
        onConfirm={handleStoryDelete}
      />
    </div>
  )
}
