"use client"

import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react"
import Image from "next/image"
import { X, Smartphone, Video, Layers, Image as ImageIcon, Film, ImagePlus, Mic, Square, RefreshCw, ChevronDown, Loader2, CircleCheck, Download, ChevronLeft, ChevronRight, Link2, Trash2, Type, type LucideIcon } from "lucide-react"
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
import { MediaCreditsCard } from "@/components/media-credits-card"
import { useOpenAiConnected } from "@/hooks/use-openai-connected"
import {
  subscribeBRollGeneration,
  getBRollGenerationSnapshot,
  startBRollGeneration,
  startCaptionBurn,
  startImageCaption,
  clearImageCaptionError,
  startStoryDriveImport,
  clearStoryImportError,
} from "@/lib/broll-generation-store"
import {
  ImageCaptionBlock,
  type CaptionPosition,
} from "@/components/image-caption-block"
import { StoryPlayer } from "@/components/story-player"
import { DriveMediaLinks } from "@/components/drive-media-links"
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
import { parseTextToSlides } from "@/lib/carousel-slides"
import {
  carouselBareSlides,
  carouselCaptionedSlides,
  captionCarouselSlide,
  forgetCarouselSlides,
  readCarouselCaptionSettings,
} from "@/lib/carousel-caption"
import { MAX_CAROUSEL_SLIDES } from "@/lib/carousel-limits"
import {
  getFormatMeta,
  setFormatMeta,
  type FormatId,
} from "@/lib/timing-storage"

// Every format the panel can open MUST have an entry here: the header block
// (title + close button) is gated on `meta`, so a missing key renders a panel
// with no way to shut it.
const FORMAT_META: Record<string, { label: string; icon: LucideIcon }> = {
  story: { label: "סטורי", icon: Smartphone },
  talking_head: { label: "דיבור למצלמה", icon: Video },
  carousel: { label: "קרוסלה", icon: Layers },
  image_post: { label: "פוסט תמונה", icon: ImageIcon },
  b_roll: { label: "בי-רול", icon: Film },
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
   * Per-slide Drive links the carousel was imported from, in slide order.
   * Lifted (like the images) because they live on the post now (migration
   * 027) rather than in this browser's localStorage, so the parent owns the
   * load + save and the panel just edits the list.
   */
  carouselDriveLinks: string[] | null
  onCarouselDriveLinksChange: (links: string[] | null) => void
  /** The story's per-frame Drive links — same contract as the carousel's. */
  storyDriveLinks: string[] | null
  onStoryDriveLinksChange: (links: string[] | null) => void
  /**
   * Per-format media URLs the PAGE already loaded. The panel runs its own
   * hydration fetch, and until that lands it can't know whether media exists
   * — so it rendered empty for a second on every open, for data the app was
   * already holding. Seeding from this paints immediately; the fetch then
   * confirms or corrects.
   */
  initialFormatMedia?: Record<string, string>
  /** The story's saved frames, already loaded by the page. */
  initialStoryFrames?: string[] | null
  /**
   * True once the page's own post fetch has resolved. When it has, the panel
   * skips its hydration request entirely — it was re-fetching the exact post
   * the page had just fetched, and each of those calls costs ~1s (almost all
   * of it auth verification, measured 2026-07-29), so opening a panel paid
   * for the same data twice.
   */
  postLoaded?: boolean
  /**
   * Reports the b-roll's finished clip up to the page so it renders as its
   * own workflow card next to the b-roll script — the same lift story and
   * talking_head already do for their media.
   */
  onBRollUrlChange?: (url: string | null) => void
  /** The b-roll's source Drive link. One clip, so at most one entry. */
  bRollDriveLinks: string[] | null
  onBRollDriveLinksChange: (links: string[] | null) => void
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
  carouselDriveLinks,
  onCarouselDriveLinksChange,
  storyDriveLinks,
  onStoryDriveLinksChange,
  initialFormatMedia,
  initialStoryFrames,
  postLoaded,
  onBRollUrlChange,
  bRollDriveLinks,
  onBRollDriveLinksChange,
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
            format (AI generation or an external Drive / Canva link). Shown for
            every format panel, directly under the header title. Lives inside
            the scroll area so it doesn't break the header height calc above.
            NOTE: this used to promise "upload from your computer". There is no
            file input anywhere in this component — that path was removed — so
            the copy was advertising a button that does not exist. */}
        {meta && formatId !== "story" && formatId !== "b_roll" && formatId !== "image_post" && (
          <p className="mb-4 text-small text-text-neutral-default">
            אפשר לייצר מדיה עם AI או לתת קישור מגוגל דרייב או קנבה לתמונה / סרטון שמאוחסן שם.
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
            // Remount when the post changes. `savedTemplateId` is a useState
            // INITIALIZER and the template-cache effect is mount-only, so a
            // draft that gains its id while this flow is open would otherwise
            // keep the previous post's template state forever.
            key={postId ?? "none"}
            postId={postId ?? null}
            carouselText={carouselText}
            images={carouselImages}
            slides={carouselSlides}
            onImagesChange={onCarouselImagesChange}
            onSlidesChange={onCarouselSlidesChange}
            driveLinks={carouselDriveLinks}
            onDriveLinksChange={onCarouselDriveLinksChange}
          />
        )}

        {formatId && formatId !== "talking_head" && formatId !== "carousel" && (
          <MediaUploadFlow
            // One instance serves BOTH story and image_post. Without a key,
            // switching between them reused the same mounted component and
            // carried its in-flight state across — an upload or a debounced
            // Drive pull that started under story would land in the image_post
            // view, and the delete button would then target the wrong format's
            // asset. Keying on format+post forces a clean mount per context.
            // (The key goes here, NOT on <MediaPanel> at project/page.tsx:1343
            // — that shell is permanently mounted and animated via translate-x,
            // so remounting it would kill the slide-in transition.)
            key={`${formatId}:${postId ?? ""}`}
            format={formatId}
            postId={postId ?? null}
            hookText={panelHookText}
            onImagePostUrlChange={onImagePostUrlChange}
            onStoryImagesChange={onStoryImagesChange}
            onStoryVideoUrlChange={onStoryVideoUrlChange}
            storyDriveLinks={storyDriveLinks}
            onStoryDriveLinksChange={onStoryDriveLinksChange}
            bRollDriveLinks={bRollDriveLinks}
            onBRollDriveLinksChange={onBRollDriveLinksChange}
            onBRollUrlChange={onBRollUrlChange}
            initialMediaUrl={formatId ? initialFormatMedia?.[formatId] : undefined}
            initialStoryFrames={initialStoryFrames}
            postLoaded={postLoaded}
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
  /** The live mic MediaStream, so unmount can stop its tracks. */
  const streamRef = useRef<MediaStream | null>(null)
  /** HeyGen poll handle, so unmount can clear it. */
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // Release everything this flow can leave running when the panel closes.
  //
  // All three used to survive an unmount: the recording timer kept ticking, the
  // HeyGen status poll kept hitting /api/videos/{id} every 5s for the life of
  // the page, and — worst — the microphone stayed OPEN, because the only place
  // that stopped its tracks was the recorder's `onstop` handler, which closing
  // the panel never triggers. Empty deps: this must run on unmount only.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop() } catch { /* already torn down */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

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
      // Held so unmount can release the mic. `onstop` below also stops the
      // tracks, but that only ever fires on the explicit stopRecording() path —
      // closing the panel mid-recording never reached it, and the browser's
      // recording indicator stayed lit for the rest of the session.
      streamRef.current = stream
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

        // Transcribe.
        //
        // NOTE: /api/transcribe does not currently exist — there is no
        // `src/app/api/transcribe` route. The 404 returns HTML, `res.json()`
        // throws, and this used to be swallowed into a console.error: the
        // "מתמלל..." label vanished and the transcript box stayed empty with no
        // explanation. Until the route is built, say so and let the user type
        // the script themselves — the recording itself is fine and saved.
        setTranscribing(true)
        try {
          const formData = new FormData()
          formData.append("audio", blob, "recording.webm")
          const res = await fetch("/api/transcribe", { method: "POST", body: formData })
          if (!res.ok) throw new Error(`status ${res.status}`)
          const data = await res.json()
          if (data.text) {
            onTranscriptChange(data.text)
          } else {
            setRecError("לא הצלחנו לתמלל את ההקלטה. אפשר להקליד את הסקריפט ידנית.")
          }
        } catch (err) {
          console.error("[media-panel][transcribe]", err)
          setRecError("התמלול נכשל. ההקלטה נשמרה — אפשר להקליד את הסקריפט ידנית.")
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
  //
  // The interval handle lives in `pollRef` rather than a local const so the
  // unmount cleanup above can clear it. Previously nothing outside this closure
  // could stop it: closing the panel while HeyGen was rendering left a request
  // firing every 5 seconds for the life of the page, calling setState into an
  // unmounted tree each time. It is also bounded now — an id that never reaches
  // a terminal status used to poll forever.
  const pollVideoStatus = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    // 15 minutes at 5s. HeyGen renders in ~1-3 min; anything past this is stuck.
    const MAX_ATTEMPTS = 180
    let attempts = 0
    const stop = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > MAX_ATTEMPTS) {
        stop()
        setVideoError("יצירת הוידאו לוקחת יותר מדי זמן. נסו שוב.")
        setVideoPhase("done")
        return
      }
      try {
        const res = await fetch(`/api/videos/${id}`)
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = await res.json()
        if (data.status === "completed" && data.video_url) {
          stop()
          setVideoProgress("שומר וידאו...")
          // Download and store in Supabase Storage
          try {
            const storeRes = await fetch("/api/videos/store", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ video_url: data.video_url }),
            })
            if (!storeRes.ok) throw new Error(`status ${storeRes.status}`)
            const storeData = await storeRes.json()
            // Falling back to the raw HeyGen URL is deliberate but lossy — that
            // link expires. Warn rather than pretend the save worked.
            if (!storeData.url) {
              toast.error("הוידאו נוצר אבל לא נשמר אצלנו — הורידו אותו בהקדם")
            }
            onVideoUrlChange(storeData.url || data.video_url)
          } catch (err) {
            console.error("[media-panel][store-video]", err)
            toast.error("הוידאו נוצר אבל לא נשמר אצלנו — הורידו אותו בהקדם")
            onVideoUrlChange(data.video_url)
          }
          setVideoPhase("done")
          // Auto-generate cover if thumbnail available
          if (data.thumbnail_url) {
            generateCover(data.thumbnail_url)
          }
        } else if (data.status === "failed" || data.error) {
          stop()
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
        stop()
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
        body: JSON.stringify({ avatar_id: avatar.avatar_id, avatar_type: avatar.type, audio_url: uploadData.url }),
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
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      if (data.covers?.[0]) {
        onCoverImageChange(data.covers[0])
      } else {
        // The cover route refuses without a brand_style (see CLAUDE.md). That
        // refusal was invisible here — the cover slot just stayed empty and the
        // user had no idea why or what to do about it.
        toast.error("לא הצלחנו לייצר קאבר. ודאו שהעליתם דוגמאות קאברים בהגדרות > מדיה.")
      }
    } catch (err) {
      console.error("[media-panel][generate-cover]", err)
      toast.error("יצירת הקאבר נכשלה. נסו שוב.")
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
    // Release the PARENT's cover spinner too. Only the local flag was cleared
    // here, so hitting "התחלה מחדש" / "החלף מדיה" while a cover was generating
    // left `thCoverLoading` stuck true on /project — the cover slot on the
    // canvas sat in a skeleton until a full page reload. Every place that
    // raises this flag (the two generateCover paths) lowers both; so must this.
    onCoverLoadingChange?.(false)
    setDriveLoading(false)
    setTranscribing(false)
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
        if (!coverRes.ok) throw new Error(`status ${coverRes.status}`)
        const coverData = await coverRes.json()
        if (coverData.covers?.[0]) onCoverImageChange(coverData.covers[0])
        else {
          toast.error("לא הצלחנו לייצר קאבר. ודאו שהעליתם דוגמאות קאברים בהגדרות > מדיה.")
        }
      } catch (err) {
        console.error("[media-panel][cover-from-drive]", err)
        toast.error("יצירת הקאבר נכשלה. הסרטון חובר בהצלחה.")
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
  //
  // `lastDriveRef` suppresses a duplicate auto-fire for a link we already
  // handled. That guard must NEVER be the last word, though: it used to be
  // the only trigger, so once the ref held a link, re-pasting it did
  // nothing at all and the user had no way to retry — see `commitDrive`.
  const scheduleDrive = (value: string) => {
    if (driveDebounceRef.current) clearTimeout(driveDebounceRef.current)
    const link = value.trim()
    if (!isCompleteDriveUrl(link) || link === lastDriveRef.current) return
    driveDebounceRef.current = setTimeout(() => {
      lastDriveRef.current = link
      processDriveLink(link)
    }, 500)
  }

  // Explicit user intent — blur or Enter. Always runs, bypassing the
  // duplicate guard, so "paste it again" is a real escape hatch when the
  // auto-fire didn't happen or the previous attempt failed.
  const commitDrive = (value: string) => {
    if (driveDebounceRef.current) clearTimeout(driveDebounceRef.current)
    const link = value.trim()
    if (!isCompleteDriveUrl(link) || driveLoading) return
    lastDriveRef.current = link
    processDriveLink(link)
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
            onBlur={(e) => commitDrive(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
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

/**
 * Fold a long slide list down to `max` by merging ADJACENT slides, keeping
 * order. The first slide (the hook) and the last (the CTA) are preserved on
 * their own wherever possible — the same shape the story split uses — so
 * condensing costs the middle, never the opening or the close.
 */
function condenseSlides(slides: SlideData[], max: number): SlideData[] {
  if (slides.length <= max) return slides
  if (max <= 1) {
    return [
      {
        ...slides[0],
        slide: 1,
        body: slides
          .map((s) => [s.title, s.body].filter(Boolean).join("\n"))
          .join("\n\n")
          .trim(),
      },
    ]
  }

  const first = slides[0]
  const last = slides[slides.length - 1]
  const middle = slides.slice(1, -1)
  const middleSlots = max - 2

  // Spread the middle as evenly as possible across the slots it has left.
  const groups: SlideData[][] = Array.from({ length: middleSlots }, () => [])
  middle.forEach((slide, i) => {
    groups[Math.floor((i * middleSlots) / middle.length)].push(slide)
  })

  const merged = groups
    .filter((g) => g.length > 0)
    .map((g) => ({
      ...g[0],
      title: g[0].title,
      body: g
        .map((sl, i) =>
          // Only the first slide of a group keeps its title as a title; the
          // rest fold their title into the body so nothing is lost.
          i === 0 ? sl.body : [sl.title, sl.body].filter(Boolean).join("\n"),
        )
        .filter(Boolean)
        .join("\n\n")
        .trim(),
    }))

  return [first, ...merged, last].map((sl, i) => ({ ...sl, slide: i + 1 }))
}

// Sample cover shown in template-tile previews when the post has no
// carousel text yet.
const SAMPLE_COVER: SlideData = {
  slide: 1,
  type: "cover",
  title: "ככה תיראה הקרוסלה שלך",
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
  driveLinks,
  onDriveLinksChange,
}: {
  postId: string | null
  carouselText: string
  images: string[] | null
  slides: SlideData[] | null
  onImagesChange: (imgs: string[] | null) => void
  onSlidesChange: (slides: SlideData[] | null) => void
  driveLinks: string[] | null
  onDriveLinksChange: (links: string[] | null) => void
}) {
  // No separate "current carousel" tile (Hani 2026-07-09): the template
  // that made the saved carousel shows its real cover, starts SELECTED,
  // and tapping it opens the saved slides — one tile, one selection ring.
  // The template the saved carousel was generated with (written on approve).
  // Also the provenance flag: undefined + saved images = the carousel was
  // imported from Drive, which is what decides WHERE the panel shows it
  // (Hani, 2026-07-28 — an imported carousel belongs next to the import, not
  // under the template grid). Stateful, not a one-shot initializer, because
  // importing / approving / deleting all flip it inside a single mount.
  const [savedTemplateId, setSavedTemplateId] = useState<string | undefined>(() => {
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
  // AI templates run on the user's own OpenAI key; the satori templates render
  // on our side for free. So a missing key blocks only the AI tiles.
  const openAiConnected = useOpenAiConnected()

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

  // Same idea for a Drive-imported carousel, which has no template to attribute
  // to. Without this the "הקרוסלה שלך" tile would open an empty dialog after a
  // refresh: the import result only ever lived in the in-memory module cache.
  useEffect(() => {
    if (savedTemplateId || !images || images.length === 0) return
    setGeneratedByTemplate((p) =>
      p[DRIVE_IMPORT_KEY] === images ? p : { ...p, [DRIVE_IMPORT_KEY]: images },
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

    const allSlides = parseTextToSlides(carouselText)
    if (allSlides.length === 0) {
      setError("לא נמצאו סליידים בטקסט הקרוסלה")
      setGenerating(false)
      return
    }
    // Backstop only. The writer is told the ceiling and condenses with an
    // understanding of the words; this merge is mechanical and has none, so
    // it should fire rarely — when it does, the text itself is over the
    // ceiling and worth re-generating rather than living with.
    const parsedSlides = condenseSlides(allSlides, MAX_CAROUSEL_SLIDES)
    if (allSlides.length > parsedSlides.length) {
      toast.info(
        `צימצמנו את הקרוסלה מ-${allSlides.length} ל-${parsedSlides.length} שקופיות`,
        { duration: 5000 },
      )
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

      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      if (data.error) {
        // AI route returns a Hebrew user-facing `message` alongside the
        // machine `error` code (e.g. openai_not_connected).
        setError(data.message || data.error)
        {
          const msg = String(data.message || data.error)
          const isBilling = /תקרת החיוב|קרדיט|billing|quota/i.test(msg)
          toast.error(msg, {
            id: genToast,
            duration: isBilling ? 30000 : 8000,
            // A billing failure is the one error the user can actually fix,
            // and only from somewhere else — so the toast carries the way
            // there rather than making her hunt for it.
            action: isBilling
              ? {
                  label: "הטענת קרדיט",
                  onClick: () =>
                    window.open(
                      "https://platform.openai.com/settings/organization/billing/overview",
                      "_blank",
                      "noopener,noreferrer",
                    ),
                }
              : undefined,
          })
        }
      } else if (!data.images) {
        // A 200 with neither `error` nor `images` used to fall straight through
        // to `finally`, leaving the `duration: Infinity` loading toast on screen
        // forever with no way to dismiss it.
        setError("שגיאה ביצירת הקרוסלה")
        toast.error("שגיאה ביצירת הקרוסלה", { id: genToast, duration: 8000 })
      } else if (data.images) {
        if (postId) {
          carouselGenCache.set(postId, {
            ...(carouselGenCache.get(postId) ?? {}),
            [genId]: data.images,
          })
        }
        setGeneratedByTemplate((p) => ({ ...p, [genId]: data.images }))
        // Generating IS choosing (Hani, 2026-07-29). This used to be a
        // preview that only became the post's carousel once she pressed
        // approve inside the dialog — so a generated set lived in memory,
        // showed no workflow card, and vanished on refresh. Every other
        // format now saves on generate; swapping happens by generating
        // again or importing, from this panel.
        onImagesChange(data.images)
        if (postId && genId !== DRIVE_IMPORT_KEY) {
          setFormatMeta(postId, "carousel", { templateId: genId })
        }
        setSavedTemplateId(genId === DRIVE_IMPORT_KEY ? undefined : genId)
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
    // selected one next time the panel opens. DRIVE_IMPORT_KEY is a
    // pseudo-template and must never be stored as one (it would point the
    // saved-tile lookup at a template that doesn't exist).
    const templateId = dialogFor === DRIVE_IMPORT_KEY ? undefined : dialogFor
    if (postId) {
      setFormatMeta(postId, "carousel", { templateId })
    }
    setSavedTemplateId(templateId)
    setDialogFor(null)
  }

  // --- Removing the post's carousel ----------------------------------------
  // The only way to drop the post's carousel, and it is deliberately here
  // rather than on the canvas card (Hani, 2026-07-28): opening the panel from
  // "עריכת קרוסלה" must show her what the post currently uses, and removal has
  // to be something she does on purpose, after seeing it.
  //
  // The parent's autosave skips null (it can't tell "not loaded yet" from
  // "deleted"), so the wipe is PATCHed from here. `carouselImages: null`
  // routes through replaceImageAssetSet on the server, which clears the
  // media_assets rows under the carousel variant.
  const [pendingCarouselDelete, setPendingCarouselDelete] = useState(false)

  const handleDeleteCarousel = async () => {
    if (postId) {
      try {
        const res = await fetch(`/api/core-posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ carouselImages: null }),
        })
        if (!res.ok) throw new Error("delete_failed")
      } catch (err) {
        console.error("[media-panel][delete-carousel]", err)
        toast.error("מחיקת הקרוסלה נכשלה, נסו שוב")
        return
      }
      // Drop the template attribution too, otherwise the next open still
      // points a "saved" tile at a carousel that no longer exists. The Drive
      // links survive — they describe where the slides came from, and she may
      // well want to re-import them.
      setFormatMeta(postId, "carousel", { templateId: undefined })
      carouselGenCache.delete(postId)
      forgetCarouselSlides(postId)
    }
    setSavedTemplateId(undefined)
    onImagesChange(null)
    onSlidesChange(null)
    setGeneratedByTemplate({})
    setDialogFor(null)
    toast.success("הקרוסלה נמחקה מהפוסט")
  }

  // --- Drive slide import (per-slide links → base64 carousel) ---------------
  // Research (2026-07-12): creators hand off a carousel as INDIVIDUAL per-slide
  // images, not one bundled file — so we pull one Drive file per slide and
  // assemble them in list order. `from-drive` with `store:false` returns base64
  // (the carousel pipeline is base64 in-memory and re-stores on save), so no
  // orphan Storage file is left behind.
  //
  // The link list is remembered per post, on the post itself (migration 027).
  // It started out in localStorage, which made it per-device: the slides
  // travelled with the post but the links they came from didn't. Now the
  // parent owns them, so the list is the same on any machine she opens.
  //
  const [driveImporting, setDriveImporting] = useState(false)
  const [driveImportProgress, setDriveImportProgress] = useState("")
  const [driveImportError, setDriveImportError] = useState<string | null>(null)


  // Row order controls slide order only when the slides came from these
  // links. A carousel generated from a template is attributed to that
  // template (`savedTemplateId`), and dragging rows must not reshuffle it.
  const slidesFollowRowOrder = !savedTemplateId

  // The caption's on/off and placement are set on the carousel's own card, on
  // the canvas — the import just reads whatever is currently chosen, so a set
  // brought in now matches the one brought in an hour ago.
  const handleDriveImport = async (rows: string[]) => {
    const { captionOn: caption, position } = readCarouselCaptionSettings(postId)
    // Every carousel slide comes from a link, so blank rows are just empty
    // form scaffolding here.
    const links = rows.filter(Boolean)
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
      // The pictures as they arrived, kept so moving the caption later is a
      // redraw rather than a second download of every file.
      const bares: string[] = []
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
        // Lay this slide's own words over the picture, the same way a feed
        // image post and a b-roll still already do. A carousel the user
        // brought was the last surface still coming out bare (Hani,
        // 2026-08-13). A slide that fails to caption keeps the picture the
        // user brought rather than failing the whole import — a bare slide
        // is recoverable, a dead import is not.
        const bare = data.base64 as string
        bares.push(bare)
        if (caption) {
          setDriveImportProgress(
            `מטמיעים כיתוב בשקופית ${i + 1} מתוך ${links.length}...`,
          )
          slides.push(
            postId
              ? await captionCarouselSlide(postId, bare, i, position)
              : bare,
          )
        } else {
          slides.push(bare)
        }
      }
      if (postId) {
        carouselBareSlides.set(postId, bares)
        // With the caption off there is no captioned render to restore, and
        // any older one was drawn at a position that may since have moved.
        if (caption) carouselCaptionedSlides.set(postId, slides)
        else carouselCaptionedSlides.delete(postId)
      }
      // Make it the post's carousel (same base64 shape as generation → the
      // parent's autosave persists it as media_assets rows).
      onImagesChange(slides)
      // A Drive import isn't a template — clear any template attribution so
      // the saved-template tile logic doesn't mis-point at a stale template.
      // Clearing it is also what moves the "הקרוסלה שלך" tile down here, next
      // to the import it came from.
      if (postId) setFormatMeta(postId, "carousel", { templateId: undefined })
      setSavedTemplateId(undefined)
      // Surface what landed through the shared preview dialog (view-only:
      // it's already the post's carousel, so no approve button shows).
      setGeneratedByTemplate((p) => ({ ...p, [DRIVE_IMPORT_KEY]: slides }))
      setDialogFor(DRIVE_IMPORT_KEY)
      setPreviewIndex(0)
      // The links stay put on purpose — they're the recipe for this carousel,
      // and re-importing after fixing one of them is the main repeat action.
      onDriveLinksChange(links)
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

      // Without this check a 500's JSON error body was handed straight to
      // res.blob() and saved to the user's Downloads folder as "carousel.zip".
      if (!res.ok) throw new Error(`status ${res.status}`)

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
            // Which tile made what the post is actually using. Still one tile
            // and one selection ring (Hani 2026-07-09) — the badge only names
            // the current one so "which media is chosen right now" is
            // readable at a glance instead of inferred from the ring.
            const isPostCarousel =
              !!images && images.length > 0 && generatedByTemplate[t.id] === images
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
                className={`relative flex flex-col gap-1 rounded-xl border p-1 pb-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                  isSelected
                    ? "border-yellow-50 ring-1 ring-yellow-50"
                    : "border-border-neutral-default hover:border-gray-80"
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
                {isPostCarousel && (
                  <span className="absolute top-2 start-2 rounded-md bg-bg-surface-primary-default px-1.5 py-0.5 text-xs text-text-primary-default">
                    נוכחית
                  </span>
                )}
                <span className="w-full truncate text-center text-xs text-text-primary-default">
                  {t.name}
                </span>
              </button>
            )
          })}
        </div>

      </div>

      {/* 2. Actions — previews live in the dialog, not in the panel. */}
      {isAiTemplate && openAiConnected !== false && (
        <p className="text-xs-body text-text-neutral-default">
          טמפלט AI מצייר כל שקופית עם gpt-image-2 דרך מפתח ה-OpenAI שלכם —
          זה לוקח כמה דקות.
        </p>
      )}

      {/* An AI template with no OpenAI key connected can only fail, so the
          generate button is replaced by the way to fix it. The satori
          templates are unaffected — picking one brings the button back. */}
      {isAiTemplate && openAiConnected === false ? (
        <MediaCreditsCard />
      ) : (
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
      )}

      {error && (
        // A billing failure gets its own treatment: the user can't act on
        // "it failed", but she can act on "your OpenAI credit ran out, top up
        // here". Detected from the message the route already returns rather
        // than a new error code, so every path that surfaces it benefits.
        /תקרת החיוב|קרדיט|billing|quota/i.test(error) ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border-neutral-default bg-bg-surface p-3">
            <p className="text-small-bold text-text-primary-default">
              נגמר הקרדיט ב-OpenAI
            </p>
            <p className="text-xs-body text-text-neutral-default">
              יצירת קרוסלה עם טמפלט AI מציירת כל שקופית בנפרד דרך מפתח ה-OpenAI
              שלך, וזה נגמר. אפשר להטעין קרדיט ולנסות שוב — או לבחור טמפלט
              רגיל, שנוצר אצלנו בשניות וללא עלות.
            </p>
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border-neutral-default bg-white px-3 py-1.5 text-xs font-medium text-text-primary-default transition-colors hover:bg-bg-surface-hover dark:bg-gray-10"
            >
              <Link2 className="size-3.5" />
              הטענת קרדיט ב-OpenAI
            </a>
          </div>
        ) : (
          <p className="text-sm text-button-destructive-default text-center">{error}</p>
        )
      )}

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
                ? "הקרוסלה שלך"
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
            {/* Removing the carousel is only offered on the set the post is
                actually using, and only from inside the viewer — so it's
                always a decision made while looking at the slides, never a
                side effect of a button labelled something else. */}
            {dialogSlides === images && (
              <Button
                variant="outline"
                onClick={() => {
                  // Close the viewer first — stacking the confirm on top of an
                  // open Dialog fights over the focus trap.
                  setDialogFor(null)
                  setPendingCarouselDelete(true)
                }}
                className="w-full gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95"
              >
                <Trash2 className="size-4" />
                מחיקת הקרוסלה מהפוסט
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={pendingCarouselDelete}
        onOpenChange={(open) => { if (!open) setPendingCarouselDelete(false) }}
        title="למחוק את הקרוסלה מהפוסט?"
        description="השקופיות יימחקו מהפוסט. הטקסט של הקרוסלה והקישורים מהדרייב יישארו, כך שאפשר יהיה ליצור קרוסלה חדשה או לטעון שוב מהדרייב."
        confirmLabel="כן, למחוק"
        cancelLabel="לא, להשאיר"
        onConfirm={handleDeleteCarousel}
      />

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
        <DriveMediaLinks
          savedLinks={driveLinks}
          onSaveLinks={onDriveLinksChange}
          items={images}
          pairItems={slidesFollowRowOrder}
          onItemsReorder={onImagesChange}
          onImport={handleDriveImport}
          importing={driveImporting}
          importProgress={driveImportProgress}
          importError={driveImportError}
          onImportErrorClear={() => setDriveImportError(null)}
          heading="ייבוא שקופיות מגוגל דרייב"
          helpText="הדביקו קישור ישיר לכל שקופית (עד 10), לפי הסדר. נמשוך את התמונות ונרכיב מהן קרוסלה. כל קובץ צריך הרשאת „כל מי שיש לו הקישור”."
          unitLabel="שקופית"
          addRowLabel="הוסיפו שקופית"
          importLabel="טענו קרוסלה מהדרייב"
          reorderHint="גררו שורה כדי לשנות את סדר השקופיות בקרוסלה."
          beforeRows={
            <>
        {/* The post's carousel, when it was imported rather than generated.
            It sits HERE and not under the template grid because this is where
            it came from (Hani, 2026-07-28) — and it uses the template tile's
            exact shape so "the carousel I brought" and "the carousels the AI
            makes" read as the same kind of thing. Tapping it opens the same
            slide viewer, which is also where deleting it lives. */}
        {images && images.length > 0 && !savedTemplateId && (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => openDialog(DRIVE_IMPORT_KEY)}
              aria-label={`הקרוסלה שלך — ${images.length} שקופיות, לצפייה ולעריכה`}
              className="relative flex flex-col gap-1 rounded-xl border border-yellow-50 p-1 pb-1.5 ring-1 ring-yellow-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${images[0]}`}
                alt="השקופית הראשונה של הקרוסלה שלך"
                className="w-full rounded-lg"
                style={{ aspectRatio: "1 / 1", objectFit: "cover" }}
              />
              <span className="absolute top-2 start-2 rounded-md bg-bg-surface-primary-default px-1.5 py-0.5 text-xs text-text-primary-default">
                {images.length} שקופיות
              </span>
              <span className="w-full truncate text-center text-xs text-text-primary-default">
                הקרוסלה שלך
              </span>
            </button>
          </div>
        )}
            </>
          }
        />
      </div>


      {/* The post's carousel, in the same grey band story and b-roll use
          (Hani, 2026-07-29 — every format's panel should end the same way).
          Playable right here: tapping a slide steps through the set without
          leaving the panel. Purely additive — the template tiles, the saved
          slides and the import above are untouched. */}
      {images && images.length > 0 && (
        <div className="-mx-6 -mb-6 mt-2 flex flex-col items-center gap-5 bg-gray-95 px-6 py-5 dark:bg-gray-10">
          <p className="text-center text-xs text-text-neutral-default">
            הקרוסלה שלך
          </p>

          <button
            type="button"
            onClick={() => openDialog(savedTemplateId ?? DRIVE_IMPORT_KEY)}
            aria-label={`הקרוסלה שלך — ${images.length} שקופיות, לצפייה`}
            className="relative w-[200px] overflow-hidden rounded-[10px] border border-border-neutral-default bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${images[0]}`}
              alt="השקופית הראשונה של הקרוסלה שלך"
              className="w-full"
            />
            <span className="absolute bottom-2 start-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
              1/{images.length}
            </span>
          </button>
        </div>
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
  storyDriveLinks,
  onStoryDriveLinksChange,
  bRollDriveLinks,
  onBRollDriveLinksChange,
  onBRollUrlChange,
  initialMediaUrl,
  initialStoryFrames,
  postLoaded,
}: {
  format: string
  postId: string | null
  hookText?: string
  onImagePostUrlChange?: (url: string | null) => void
  onStoryImagesChange?: (images: string[] | null) => void
  onStoryVideoUrlChange?: (url: string | null) => void
  storyDriveLinks?: string[] | null
  onStoryDriveLinksChange?: (links: string[] | null) => void
  bRollDriveLinks?: string[] | null
  onBRollDriveLinksChange?: (links: string[] | null) => void
  onBRollUrlChange?: (url: string | null) => void
  initialMediaUrl?: string
  initialStoryFrames?: string[] | null
  postLoaded?: boolean
}) {
  // Read once, before any narrowing. Inside the burn-button condition TS has
  // already pinned `format` to "story", so a literal check for b-roll there
  // reads as unreachable code.
  const isBRoll = format === "b_roll"

  /* ---- caption on the user's own still -------------------------------- */
  //
  // Every other media surface already lays the post's words over the
  // picture; a still the user brought was the one that came out bare. It no
  // longer is — for a feed image post and for a b-roll still alike, since the
  // gap was never about the format, only about which file type was uploaded.
  const captionEnabled = format === "image_post" || format === "b_roll"
  // The picture as it arrived, kept alongside the captioned one so "בלי
  // כיתוב" is a real choice and not a second render.
  const [captionOriginalUrl, setCaptionOriginalUrl] = useState<string | null>(
    null,
  )
  // Seeded from storage, not from a constant: for an image post these are set
  // on the post's own card on the canvas, and an upload has to be captioned
  // the way she last chose rather than back at the default.
  const [captionOn, setCaptionOn] = useState(() => {
    if (!postId || typeof window === "undefined") return true
    return getFormatMeta(postId, format as FormatId).captionOn ?? true
  })
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(() => {
    if (!postId || typeof window === "undefined") return "bottom"
    return getFormatMeta(postId, format as FormatId).captionPosition ?? "bottom"
  })
  // Both settings are owned by the format's card on the canvas. The panel
  // reads them — an upload has to be captioned the way she last chose — and
  // follows along while it is open, since timing-storage fires a synthetic
  // `storage` event on every write. It never writes them, and never re-renders
  // a picture because one changed: that is the card's job, and doing it here
  // too would draw the same caption twice.
  useEffect(() => {
    if (!postId) return
    const sync = () => {
      const meta = getFormatMeta(postId, format as FormatId)
      setCaptionOn(meta.captionOn ?? true)
      setCaptionPosition(meta.captionPosition ?? "bottom")
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [postId, format])
  // Every AI path in this panel (image post, story, b-roll) draws through the
  // user's own OpenAI key. `null` while we're still asking; `false` swaps the
  // generate card for MediaCreditsCard.
  const openAiConnected = useOpenAiConnected()
  // The paste-a-link field hides itself once media is attached; this is the
  // user asking for it back to swap the clip.
  const [replacingMedia, setReplacingMedia] = useState(false)

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
  // Seeded from what the page already loaded, so existing media is on screen
  // in the first paint. Story is excluded on purpose: its frames belong to
  // the ordered set, and a lone frame-1 here would masquerade as "the single
  // current media" — the same reason the hydration below skips it.
  const seedMediaUrl =
    initialMediaUrl && (format !== "story" || isVideoUrl(initialMediaUrl))
      ? initialMediaUrl
      : null
  const [previewUrl, setPreviewUrl] = useState<string | null>(seedMediaUrl)
  // Once the replacement actually lands, put the field away again — otherwise
  // swapping a clip leaves the panel permanently back in "paste a link" mode.
  useEffect(() => {
    if (previewUrl) setReplacingMedia(false)
  }, [previewUrl])
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(
    seedMediaUrl ? (isVideoUrl(seedMediaUrl) ? "video" : "image") : null,
  )
  const [uploading, setUploading] = useState(false)
  // Hydration phase = "we still don't know if there's existing media". True
  // while the /api/core-posts fetch is in flight. Without this, the panel
  // briefly renders the empty upload CTA before flipping to the preview
  // — which reads as "the image wasn't saved" to the user.
  // Only "hydrating" when we actually have to go and ask. If the page has
  // already loaded the post, everything this panel needs arrived as props.
  const [hydrating, setHydrating] = useState<boolean>(
    () => !!postId && !postLoaded,
  )
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
  const [savedStorySet, setSavedStorySet] = useState<string[]>(
    () => (format === "story" && initialStoryFrames) || [],
  )
  // Story lightbox: which set is open and which frame within it.
  const [storyLightbox, setStoryLightbox] = useState<{
    set: string[]
    index: number
  } | null>(null)
  const [savingStory, setSavingStory] = useState(false)
  const [pendingStoryDelete, setPendingStoryDelete] = useState(false)
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
    setDriveUrl(
      // B-roll remembers its source link on the post; everything else falls
      // back to the local reference-link store.
      (format === "b_roll" ? bRollDriveLinks?.[0] : undefined) ??
        meta.driveUrl ??
        "",
    )
    setDriveDirty(false)
    // Reset the upload preview when the post changes — otherwise
    // navigating between posts would leak a previous post's preview into
    // a fresh open.
    setPreviewUrl(seedMediaUrl)
    setPreviewKind(
      seedMediaUrl ? (isVideoUrl(seedMediaUrl) ? "video" : "image") : null,
    )
    // Only "hydrating" if we're actually about to fetch. When the page has
    // already handed us the post, the fetch effect below returns early — so
    // flipping this to true here left it stuck true forever, and every
    // control gated on `!hydrating` (the whole b-roll panel bar one button)
    // never rendered.
    setHydrating(!!postId && !postLoaded)
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
    // Same reasoning as `hydrating`: when the page already supplied the
    // frames there is no fetch coming to put them back, so clearing here
    // would empty the story panel permanently.
    setSavedStorySet((format === "story" && initialStoryFrames) || [])
    setStoryLightbox(null)

    // In-flight / transient flags. These were previously left alone, so with
    // one shared instance across story and image_post they carried over: a
    // failed link in story rendered its error under the image_post input, and
    // a pending pull in one format disabled the other's controls. The `key` on
    // MediaUploadFlow now remounts on switch, so this is belt-and-braces — but
    // it also covers a plain postId change, which does NOT remount.
    setDrivePulling(false)
    setDriveError(null)
    setUploading(false)
    // Burn progress is NOT reset here any more — it lives in the module store
    // now, precisely so switching format or closing the panel can't cancel
    // the user's view of work that's still running.
    setSavingStory(false)
    setPendingDelete(false)
    setPendingStoryDelete(false)
    lastDriveRef.current = ""

    // Cancel any debounced Drive pull scheduled for the PREVIOUS (post, format).
    // Without this the timer still fires after the switch and persists media
    // against the format the user just left.
    return () => {
      if (driveDebounceRef.current) {
        clearTimeout(driveDebounceRef.current)
        driveDebounceRef.current = null
      }
    }
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
    // The page fetched this post already and handed the results down. Asking
    // again costs a full second for bytes we're holding.
    if (postLoaded) return
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
        if (format === "story" && looksLikeVideo) {
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
        // Roll back the optimistic preview like every other failure branch
        // does. Without this the blob URL leaked AND the panel kept showing
        // the image as though it had been saved — the upload never happened.
        URL.revokeObjectURL(localBlobUrl)
        setPreviewUrl(null)
        setPreviewKind(null)
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
      // Same rule as the Drive path: an image that lands here gets the
      // post's caption laid over it. Where the file came from is not a
      // reason for the result to look different.
      if (!isVideo && (format === "image_post" || format === "b_roll")) {
        runImageCaption(publicUrl)
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
  const handleBurnText = () => {
    if (!postId) {
      toast.error("שמרו קודם את הפוסט", { duration: 4000 })
      return
    }
    startCaptionBurn(postId, format)
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

  /**
   * Persist a story set EXACTLY as given — used by the reorder path, where the
   * frames are already-saved storage URLs. `handleStorySave` deliberately
   * short-circuits on an all-URL set (nothing new to store); a reorder is the
   * one case where an all-URL set genuinely must be written, because the ORDER
   * is the change. The PATCH route re-points existing URLs instead of
   * re-uploading them.
   */
  const persistStorySet = async (set: string[]) => {
    setSavedStorySet(set)
    onStoryImagesChange?.(set)
    if (!postId) return
    try {
      const res = await fetch(`/api/core-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyImages: set }),
      })
      if (!res.ok) throw new Error("save_failed")
    } catch (err) {
      console.error("[media-panel][story-reorder]", err)
      toast.error("שמירת סדר הפריימים נכשלה, נסו שוב")
    }
  }

  // --- Story frames from Drive ---------------------------------------------
  // The same per-frame link mechanic the carousel uses (Hani, 2026-07-28) —
  // but NOT the carousel's images-only rule. A story frame is whatever
  // Instagram accepts as a story: a photo or a clip. The first cut of this
  // reused the carousel's `store:false` base64 path, which rejects anything
  // that isn't an image, so pasting a video link failed with "פריים של סטורי
  // חייב להיות תמונה" — a rule that never existed outside that copied code.
  //
  // `store:true` handles both: the file lands in Storage and we get a URL
  // back. The story PATCH re-points existing URLs rather than re-uploading
  // them, so the frame set holds URLs from here on.
  // The link rows start collapsed behind a button (Hani, 2026-07-29 — Figma
  // 598:3). At rest the panel offers two choices, not two choices plus a
  // form; the rows appear once she's actually chosen to import. Opened by
  // default when links are already saved, so a returning user isn't asked to
  // re-find work she already did.
  const [showStoryDriveLinks, setShowStoryDriveLinks] = useState(
    () => (storyDriveLinks?.length ?? 0) > 0,
  )
  const bRollSubscribe = useCallback(
    (cb: () => void) => subscribeBRollGeneration(postId ?? null, cb),
    [postId],
  )
  const bRollSnapshot = useCallback(
    () => getBRollGenerationSnapshot(postId ?? null),
    [postId],
  )
  const bRollState = useSyncExternalStore(
    bRollSubscribe,
    bRollSnapshot,
    bRollSnapshot,
  )
  const storyDriveImporting = bRollState.storyImporting
  const storyDriveProgress = bRollState.storyProgress
  const storyDriveError = bRollState.storyError

  /**
   * Lay the post's hook + story body over one frame and return the burned
   * URL. Returns null on failure — a frame that couldn't be captioned is
   * still a usable frame, so the import keeps the raw one and carries on
   * rather than throwing the whole set away.
   */
  const burnCaptionInto = async (
    url: string,
    frameIndex: number,
    frameCount: number,
  ): Promise<string | null> => {
    if (!postId) return null
    try {
      const res = await fetch("/api/story/generate-video-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          format: "story",
          sourceUrl: url,
          // The frame belongs to the ordered set; it must not also be written
          // into the variant's single video slot.
          persist: false,
          // Its position decides which slice of the script it carries.
          frameIndex,
          frameCount,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error || !data.url) {
        console.error("[media-panel][story-burn]", data.error ?? res.status)
        return null
      }
      return data.url as string
    } catch (err) {
      console.error("[media-panel][story-burn]", err)
      return null
    }
  }

  // Anything that will land in the grey band when it finishes — an AI
  // generation or a Drive pull. Both produce the story, so both belong in the
  // same slot rather than each inventing its own progress affordance.
  const busyOnStory = storyInFlight > 0 || storyDriveImporting

  // --- AI b-roll ------------------------------------------------------------
  // A still with the caption over it, animated into a 7s clip. The work runs
  // in a module-level store, NOT here: this component unmounts the moment the
  // panel closes, and generation takes up to a minute. Same pattern
  // image_post and story already use.
  const bRollGenerating = bRollState.inFlight > 0
  const burningText = bRollState.burning > 0

  /* ---- still-image caption: fire, pick up, redo ---------------------- */

  const captioningImage = bRollState.captioningImage > 0
  const captionImageError = bRollState.captionImageError

  /**
   * Ask the server to lay the post's caption over `sourceUrl`.
   *
   * Attaching an image IS the instruction to caption it — the same contract
   * b-roll already has for a clip (Hani, 2026-07-29). No extra button: the
   * user pasted a link because they want a finished post, not a bare photo.
   */
  const runImageCaption = useCallback(
    (sourceUrl: string) => {
      if (!postId || !captionEnabled) return
      setCaptionOriginalUrl(sourceUrl)
      startImageCaption(postId, format, {
        sourceUrl,
        position: captionPosition,
        quiet: true,
      })
    },
    [postId, captionEnabled, format, captionPosition],
  )

  // Pick up a caption render that finished — including one that landed while
  // this panel was closed, which is the whole reason the work lives in the
  // module store.
  const captionedImage = bRollState.captionedImage
  useEffect(() => {
    if (!captionEnabled || !captionedImage) return
    if (captionedImage.format !== format) return
    if (captionedImage.originalUrl) {
      setCaptionOriginalUrl(captionedImage.originalUrl)
      // Captioning REPLACES the format's stored image with the captioned
      // render, so without this nothing remembers what the picture looked
      // like before — and the control on the card could only ever act in the
      // session that uploaded it.
      if (postId) {
        setFormatMeta(postId, format as FormatId, {
          captionSourceUrl: captionedImage.originalUrl,
        })
      }
    }
    if (captionOn) {
      setPreviewUrl(captionedImage.url)
      setPreviewKind("image")
      // Both stills have a card on the canvas now, and the card is where the
      // caption is switched and placed — so it has to be told what landed.
      if (format === "image_post") onImagePostUrlChange?.(captionedImage.url)
      if (format === "b_roll") onBRollUrlChange?.(captionedImage.url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionEnabled, format, captionedImage])

  const bRollAttemptRef = useRef(0)

  // Whether the b-roll link field is open. Closed at rest behind the Drive
  // button and opened by pressing it — the same two-step the story uses, so
  // the panel offers choices rather than choices plus a form.
  const showBRollDriveField = replacingMedia

  // Pick up a clip that finished while this panel was closed.
  useEffect(() => {
    if (format !== "b_roll" || !bRollState.url) return
    setPreviewUrl(bRollState.url)
    setPreviewKind("video")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, bRollState.url])

  // The story frame set produced by a background import — picked up whether
  // the panel was open the whole time or opened after it finished.
  const importedStoryFrames = bRollState.storyFrames
  useEffect(() => {
    if (format !== "story" || !importedStoryFrames) return
    setSavedStorySet(importedStoryFrames)
    onStoryImagesChange?.(importedStoryFrames)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, importedStoryFrames])

  // Same for a caption burn that finished while the panel was shut. Guarded
  // on format so a story burn can't land in the b-roll panel and vice versa.
  const burned = bRollState.burned
  useEffect(() => {
    if (!burned || burned.format !== format) return
    setPreviewUrl(burned.url)
    setPreviewKind("video")
    if (format === "b_roll") onBRollUrlChange?.(burned.url)
    else onStoryVideoUrlChange?.(burned.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, burned])

  const handleBRollGenerate = () => {
    if (!postId) {
      toast.error("שמרו קודם את הפוסט", { duration: 4000 })
      return
    }
    // Bumped per press so a retry varies the palette instead of returning a
    // near-identical picture.
    startBRollGeneration(postId, bRollAttemptRef.current++)
  }

  // Save what the AI just made, without waiting to be asked (Hani,
  // 2026-07-29). Story and image_post used to hold their results as
  // candidates until the user approved one in a dialog — which is why a
  // generated story showed in the panel but had no workflow card and did not
  // survive a refresh. Generating is the choice; replacing means generating
  // again or importing from this panel.
  //
  // Guarded by a ref rather than by "is there already media": re-running the
  // effect must not re-save the same set, but a DELIBERATE second generation
  // must replace the first.
  const autoSavedStoryRef = useRef<string | null>(null)
  useEffect(() => {
    if (format !== "story") return
    const latest = storySets[storySets.length - 1]
    if (!latest || latest.length === 0) return
    const key = `${latest.length}|${latest[0]?.slice(0, 24)}`
    if (autoSavedStoryRef.current === key) return
    autoSavedStoryRef.current = key
    void handleStorySave(latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, storySets])

  const autoSavedImageRef = useRef<string | null>(null)
  useEffect(() => {
    if (format !== "image_post") return
    const latest = aiPreviews[aiPreviews.length - 1]
    if (!latest) return
    const key = latest.slice(0, 24)
    if (autoSavedImageRef.current === key) return
    autoSavedImageRef.current = key
    void handleAiSave(latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, aiPreviews])

  const handleStoryDriveImport = (rows: string[]) => {
    if (!postId) {
      toast.error("שמרו את הפוסט לפני ייבוא הסטורי", { duration: 4000 })
      return
    }
    startStoryDriveImport(postId, rows, savedStorySet)
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
  const localStoryFrameSrc = (f: string) =>
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
      // Deleting is the one place absence is real, so it clears the canvas
      // card explicitly — the lift effect above deliberately never does.
      if (format === "b_roll") {
        onBRollUrlChange?.(null)
      }
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
    // Drive links become real media assets in the DATABASE (see
    // attachDriveMedia) — that's what makes them survive a different
    // browser or machine. The localStorage readiness meta is only for
    // Canva / other links we can't resolve, which stay as a reference the
    // user opens manually.
    //
    // A Drive link on blur/Enter is explicit user intent — attach it now,
    // bypassing BOTH the dirty check and the debounce's duplicate guard.
    // Without this the guard was the ONLY path, so a link that had already
    // been attempted could never be retried: re-pasting it did nothing.
    const trimmed = driveUrl.trim()
    if (isDriveUrl(trimmed)) {
      if (isCompleteDriveUrl(trimmed) && !drivePulling) {
        if (driveDebounceRef.current) clearTimeout(driveDebounceRef.current)
        lastDriveRef.current = trimmed
        attachDriveMedia(trimmed)
      }
      return
    }
    // Non-Drive reference links only get written when actually edited.
    if (!driveDirty) return
    setFormatMeta(postId, format as FormatId, {
      driveUrl: trimmed || undefined,
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
  const attachDriveMedia = async (
    rawLink: string,
    /**
     * The format this attach was STARTED for. Defaults to the current one, but
     * `scheduleDrivePull` snapshots it so a 500ms-debounced pull can't drift.
     *
     * This function is async and reaches over the network twice, so `format`
     * read from the render closure could be a format the user has since left.
     * That was a real data bug: paste a Drive link under story, switch to
     * image_post inside the debounce window, and the asset persisted to story
     * while the image_post panel displayed it — and the "image_post accepts
     * images only" guard below was evaluated against the stale format, so a
     * video slipped past it entirely.
     */
    targetFormat: string = format,
  ) => {
    const link = rawLink.trim()
    if (!postId || !link) return
    if (!isDriveUrl(link)) return
    // Only paint into the panel when it is still showing the format this call
    // belongs to. Persistence always uses `targetFormat` and is unconditional —
    // the user's action should complete even if they navigated away.
    const isCurrent = () => targetFormat === format
    if (isCurrent()) {
      setDriveError(null)
      setDrivePulling(true)
    }
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
        if (isCurrent()) {
          setDriveError(
            errorMessages[info.error] ?? "טעינת המדיה מהדרייב נכשלה. נסו שוב.",
          )
        }
        return
      }

      const kind: "image" | "video" = info.kind === "video" ? "video" : "image"

      // image_post accepts images only — reject a Drive video with a clear
      // message instead of silently storing something the format can't use.
      // Checked against targetFormat, not the live one: this guard exists to
      // protect the format being WRITTEN TO.
      if (targetFormat === "image_post" && kind === "video") {
        if (isCurrent()) setDriveError("פוסט תמונה תומך רק בתמונות")
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
          if (isCurrent()) {
            setDriveError(
              errorMessages[data.error] ?? "טעינת המדיה מהדרייב נכשלה. נסו שוב.",
            )
          }
          return
        }
        mediaUrl = data.url
      }

      const persistRes = await fetch(`/api/core-posts/${postId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: targetFormat, url: mediaUrl, assetType: kind }),
      })
      if (!persistRes.ok) {
        const err = (await persistRes.json().catch(() => ({}))) as {
          error?: string
        }
        if (isCurrent()) {
          setDriveError(`לא הצלחנו לשמור את המדיה: ${err.error ?? "שגיאה"}`)
        }
        return
      }

      // Lift the result to the parent regardless of which format is on screen —
      // the canvas card for `targetFormat` must update either way.
      // B-roll: choosing the clip IS the instruction to caption it
      // (Hani, 2026-07-29). No separate "burn" button — the attach and the
      // caption are one action, with the progress line below as the
      // indication. Images can't be burned by the video pipeline, so only a
      // video triggers it.
      if (targetFormat === "b_roll") {
        onBRollDriveLinksChange?.([link])
      }
      if (targetFormat === "b_roll" && kind === "video") {
        void handleBurnText()
      }
      // ...and a b-roll STILL gets the same treatment from the image
      // renderer. Before this, "העלו מדיה משלכם" produced a captioned clip
      // for a video and a bare photo for an image — the same action, two
      // different outcomes, decided by a file type the user never chose
      // deliberately.
      if (
        kind === "image" &&
        (targetFormat === "image_post" || targetFormat === "b_roll")
      ) {
        runImageCaption(mediaUrl)
      }
      if (targetFormat === "story") {
        // The single-link field and the per-frame list are the SAME story
        // (Hani, 2026-07-28): a link pasted up there is frame 1 down here, and
        // has to be remembered as such. Only seeded when the list is empty —
        // it must never overwrite frames she has already lined up.
        if (!storyDriveLinks || storyDriveLinks.length === 0) {
          onStoryDriveLinksChange?.([link])
        }
      }
      if (targetFormat === "story" && kind === "image") {
        onStoryImagesChange?.([mediaUrl])
      } else if (targetFormat === "image_post") {
        onImagePostUrlChange?.(mediaUrl)
      }

      // Panel painting, on the other hand, only applies if the user is still
      // looking at this format. Otherwise we'd render story's clip inside the
      // image_post view — and the delete button would then target the wrong one.
      if (isCurrent()) {
        // A story IMAGE belongs to the frame-set row (like a saved AI set),
        // so it lands in savedStorySet; everything else is the single
        // current-media slot.
        if (targetFormat === "story" && kind === "image") {
          setSavedStorySet([mediaUrl])
        } else {
          setPreviewUrl(mediaUrl)
          setPreviewKind(kind)
          if (kind === "image") setImageLoading(true)
        }
        // The media is attached — clear the input and its localStorage
        // readiness meta, which only ever backed non-Drive reference links.
        setDriveUrl("")
        setDriveDirty(false)
      }
      lastDriveRef.current = link
      attached = true
      setFormatMeta(postId, targetFormat as FormatId, { driveUrl: undefined })
      toast.success(
        kind === "video" ? "הסרטון מהדרייב חובר לפוסט" : "המדיה נטענה מהדרייב",
        { duration: 3000 },
      )
    } catch (err) {
      console.error("[media-upload-flow][drive-attach]", err)
      const timedOut = err instanceof DOMException && err.name === "TimeoutError"
      if (isCurrent()) {
        setDriveError(
          timedOut
            ? "הבדיקה מול גוגל דרייב לקחה יותר מדי זמן. ודאו שהקובץ משותף ונסו שוב."
            : "שגיאת רשת בטעינת המדיה. נסו שוב.",
        )
      }
    } finally {
      if (isCurrent()) setDrivePulling(false)
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
    // Snapshot the format NOW, at the moment the user typed, not 500ms later
    // when the timer fires — by then they may be looking at a different format.
    const targetFormat = format
    driveDebounceRef.current = setTimeout(() => {
      lastDriveRef.current = link
      attachDriveMedia(link, targetFormat)
    }, 500)
  }

  /**
   * The story's already-attached Drive link, shaped as a one-frame list.
   *
   * A Drive VIDEO is stored as the link itself (see attachDriveMedia), so
   * `previewUrl` IS the link and can be shown back verbatim. A Drive IMAGE is
   * downloaded and re-hosted, so the original link only survives if it was
   * recorded at attach time — which is why attachDriveMedia now writes it.
   * Falling back to the field's own value covers a link typed but not yet
   * committed.
   */
  const existingStoryLinkAsFrames = (() => {
    if (format !== "story") return null
    const candidate = [previewUrl, driveUrl].find(
      (v) => !!v && isDriveUrl(v.trim()),
    )
    return candidate ? [candidate.trim()] : null
  })()

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
          {/* Same shape as the story panel (Hani, 2026-07-29): the card stays
              open with its explainer instead of collapsing to a bare button
              once an image exists, so the panel reads the same in every
              format. The generate action lives inside it. */}
          {/* The connection answer is folded into the existing hydration
              skeleton, so the card never flips from "generate" to "connect
              credits" in front of the user. */}
          {hydrating || openAiConnected === null ? (
            <Skeleton className="h-[190px] w-full rounded-[18px]" />
          ) : openAiConnected === false ? (
            <MediaCreditsCard />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4">
              {/* Camera illustration — split into two assets so the tile
                  reads as centered while the sparkle cluster hangs off to
                  its upper-left. */}
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
              <span className="max-w-[286px] text-center text-xs leading-relaxed text-text-neutral-default">
                ניצור תמונה מעוצבת לפי תוכן הפוסט, עם הטקסט של הפורמט משולב
                בעיצוב
              </span>
              <Button
                variant="outline"
                onClick={handleAiGenerate}
                disabled={!postId}
                className="w-full gap-1.5"
              >
                {inFlight > 0 && <Loader2 className="size-3.5 animate-spin" />}
                יצירת תמונה עם AI
              </Button>
            </div>
          )}

              {/* With no OpenAI key the "מדיה משלכם" field stops being the
                  second option and becomes the ONLY way forward, so it gets
                  the "או" divider the other panels have. In the normal state
                  image_post deliberately has no divider. */}
              {openAiConnected === false && (
                <div className="flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-border-neutral-default" />
                  <span className="text-xs text-text-neutral-default">או</span>
                  <span className="h-px flex-1 bg-border-neutral-default" />
                </div>
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

              {/* The saved image and the AI candidates used to live in a
                  72px thumbnail row here. The grey band below now shows the
                  post's image at a size worth looking at, so the row was the
                  same thing said twice (Hani, 2026-07-29). Only the
                  in-progress skeletons remain — nothing else reports that a
                  generation is running. */}
              {inFlight > 0 && (
                <div className="flex gap-2 overflow-x-auto px-1 py-2">
                  {Array.from({ length: inFlight }).map((_, i) => (
                    <div
                      key={`img-gen-${i}`}
                      className="relative aspect-[4/5] w-[72px] shrink-0 overflow-hidden rounded-lg border border-border-neutral-default"
                      aria-label="מייצרים תמונה חדשה"
                    >
                      <Skeleton className="absolute inset-0 rounded-lg" aria-hidden />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="size-5 animate-spin text-text-neutral-default" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

          {/* The post's image, in the same grey band every other format ends
              with (Hani, 2026-07-29). Additive — the AI section and the
              thumbnail row above are untouched.

              Under the ?imgcap gate the band is replaced by the caption
              block, which owns the same slot: same grey, same frame, plus
              the caption's own states and controls. */}
          {!hydrating && captionEnabled && (previewUrl || captioningImage) && (
            <ImageCaptionBlock
              aspect="4/5"
              state={
                captioningImage
                  ? "captioning"
                  : captionImageError
                    ? "error"
                    : "idle"
              }
              errorMessage={captionImageError}
              captionedUrl={captionedImage?.url ?? null}
              originalUrl={captionOriginalUrl ?? previewUrl}
              captionOn={captionOn}
              onRetry={() => {
                clearImageCaptionError(postId)
                const source = captionOriginalUrl ?? previewUrl
                if (source) runImageCaption(source)
              }}
              onOpenLightbox={setLightboxSrc}
            />
          )}
          {!hydrating && !captionEnabled && previewUrl && (
            <div className="-mx-6 -mb-6 mt-2 flex flex-col items-center gap-5 bg-gray-95 px-6 py-5 dark:bg-gray-10">
              <p className="text-center text-xs text-text-neutral-default">
                התמונה שלך
              </p>
              <button
                type="button"
                onClick={() => setLightboxSrc(previewUrl)}
                aria-label="התמונה שלך — להגדלה"
                className="group relative w-[200px] aspect-[4/5] overflow-hidden rounded-[10px] border border-border-neutral-default bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              >
                <Image
                  src={previewUrl}
                  alt="התמונה שלך"
                  width={200}
                  height={250}
                  className="h-full w-full object-cover"
                />
              </button>
            </div>
          )}
        </>
      )}

      {/* STORY — AI "media-to-story": generate a designed 9:16 frame set
          (1 frame, or up to 3 when the script is long), with the Hebrew
          text baked in. Mirrors the image_post AI section; the manual
          bring-your-own path stays below. */}
      {/* STORY — rebuilt to the Figma spec (Hani, 2026-07-29, node 597:730).
          Three blocks, top to bottom: make one with AI, or bring your own
          frames by Drive link, then the story itself.

          What the redesign removed, deliberately:
            • the single "paste a link" field — the per-frame list IS the
              link input now, so there was no reason for two;
            • the "הטמעת הכיתוב בסרטון" button — pasting a link is the intent,
              so the caption is burned on import with no second step;
            • the saved-story thumbnail strip — the preview at the bottom is
              the story, at a size you can actually read.
          The candidate strip survives for AI results, which are transient and
          need somewhere to be approved from. */}
      {/* Loading. A skeleton of the REAL layout, not a spinner and not a
          single grey bar: the panel reads from the post over the network, and
          until that lands the controls can't say anything true (is there a
          story? are there links?). Half-drawn controls that then rearrange
          themselves read as a bug; a shape that becomes the thing reads as
          loading. */}
      {format === "story" && (hydrating || openAiConnected === null) && (
        <>
          <Skeleton className="h-[190px] w-full rounded-[18px]" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-px flex-1" />
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-px flex-1" />
          </div>
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="-mx-6 -mb-6 mt-2 flex flex-col items-center gap-5 bg-gray-95 px-6 py-5 dark:bg-gray-10">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="w-[200px] aspect-[9/16] rounded-[10px]" />
          </div>
        </>
      )}

      {format === "story" && !hydrating && openAiConnected !== null && (
        <>
          {/* 1. Make one with AI. Always the full card — the design keeps the
                 explainer visible rather than collapsing to a bare button
                 once frames exist. With no OpenAI key connected, the same slot
                 holds the "connect credits" card instead. */}
          {openAiConnected === false ? (
            <MediaCreditsCard />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4">
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
              <span className="max-w-[286px] text-center text-xs leading-relaxed text-text-neutral-default">
                ניצור רקע שמתאים לתוכן הפוסט ונשלב עליו את הטקסט של הסטורי
              </span>
              <Button
                variant="outline"
                onClick={handleStoryGenerate}
                disabled={!postId}
                className="w-full gap-1.5"
              >
                {storyInFlight > 0 && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                יצירת תמונה לסטורי עם AI
              </Button>
            </div>
          )}

          {/* Candidate sets from AI — not in the design, which shows the
              resting state. They're transient and need a place to be
              approved from, so they stay. The SAVED story is no longer here;
              it's the preview at the bottom. */}
          {storySets.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-1 py-2">
              {storySets.map((set, i) => (
                <button
                  key={`story-set-${i}`}
                  type="button"
                  onClick={() => setStoryLightbox({ set, index: 0 })}
                  className="relative aspect-[9/16] w-[72px] shrink-0 overflow-hidden rounded-lg border border-border-neutral-default transition-colors hover:border-gray-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
                  aria-label={`סטורי ${i + 1} — להגדלה ושמירה`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={localStoryFrameSrc(set[0])}
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
            </div>
          )}

          {/* 2. "או" */}
          <div className="flex items-center gap-3" role="separator">
            <span className="h-px flex-1 bg-border-neutral-default" />
            <span className="text-xs text-text-neutral-default">או</span>
            <span className="h-px flex-1 bg-border-neutral-default" />
          </div>

          {/* 3. Bring your own frames — behind a button until asked for.
                 Row i is frame i, so dragging a row reorders the story
                 itself, not just the form. */}
          {!showStoryDriveLinks ? (
            <Button
              variant="outline"
              onClick={() => setShowStoryDriveLinks(true)}
              className="w-full gap-2"
            >
              {/* The real Drive mark, not a generic cloud glyph — this button
                  is a promise about WHERE the media comes from, and the brand
                  is what makes that legible at a glance. Icon first so it
                  lands on the right in this RTL panel. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/google-drive.svg"
                alt=""
                className="size-4 shrink-0"
              />
              יבוא מדיה מ Google Drive
            </Button>
          ) : (
          <DriveMediaLinks
            savedLinks={storyDriveLinks ?? existingStoryLinkAsFrames}
            onSaveLinks={(links) => onStoryDriveLinksChange?.(links)}
            items={savedStorySet.length > 0 ? savedStorySet : null}
            pairItems
            onItemsReorder={persistStorySet}
            onImport={handleStoryDriveImport}
            importing={storyDriveImporting}
            importProgress={storyDriveProgress}
            importError={storyDriveError}
            onImportErrorClear={() => clearStoryImportError(postId ?? null)}
            heading="ייבוא מדיה"
            helpText="הדביקו קישור ישיר מגוגל דרייב"
            unitLabel="פריים"
            addRowLabel="הוסיפו פריים"
            importLabel="טענו את המדיה"
            autoImport
          />
          )}

          {/* 4. The story itself. Bleeds past the panel's 24px padding so the
                 grey band spans the full rail, as in the design. */}
          {/* 4. The grey band is where the story lives — AND where it's made
                 (Hani, 2026-07-29 — Figma 598:83). Work in progress renders
                 here at full size rather than as a 72px tile off to the side,
                 so what you watch being made is the thing you end up with. */}
          {(savedStorySet.length > 0 || busyOnStory) && (
            <div className="-mx-6 -mb-6 mt-2 flex flex-col items-center gap-5 bg-gray-95 px-6 py-5 dark:bg-gray-10">
              <p className="text-center text-xs text-text-neutral-default">
                {busyOnStory ? "מייצרים מדיה לסטורי..." : "הסטורי שלך"}
              </p>
              {busyOnStory && (
                <div
                  className="flex w-[200px] aspect-[9/16] items-center justify-center rounded-[10px] border border-border-neutral-default bg-gray-90 dark:bg-gray-20"
                  aria-label="מייצרים מדיה לסטורי"
                >
                  <Loader2 className="size-5 animate-spin text-text-neutral-default" />
                </div>
              )}
              {/* Delete is a hover icon ON the media, not a text link under
                  it (Hani, 2026-07-29) — that's the convention everywhere
                  else in the app (the video card, the /core_posts cards, the
                  old story thumbnail). Sits above the player's own controls
                  via z-10 and stops propagation so it can't be read as a tap
                  on the story. */}
              {!busyOnStory && savedStorySet.length > 0 && (
              <div className="group relative">
                <StoryPlayer
                  frames={savedStorySet}
                  className="w-[200px] aspect-[9/16] border border-border-neutral-default"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingStoryDelete(true)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={!postId}
                  aria-label="מחיקת הסטורי"
                  title="מחיקת הסטורי"
                  className="absolute end-2 top-2 z-10 flex size-7 items-center justify-center rounded-md bg-white/90 text-button-destructive-default opacity-0 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bring-your-own media — the video preview + Drive/Canva link input.
          Story shows it in BOTH modes: in "image" mode it's the "paste an
          image link" option next to Create-with-AI; in "video" mode it's how
          the user brings their clip (then burns the caption in).
          Upload-from-computer was removed per Hani; Drive/Canva link only. */}
      {/* Bring-your-own for the OTHER formats. Story is excluded now: its
          per-frame list is the link input, and a second single-link field
          next to it was two doors to the same room (Hani, 2026-07-29). */}
      {format !== "image_post" && format !== "story" && (
        <>
          {/* B-ROLL — same opening shape as the story (Hani, 2026-07-29):
              make one with AI, "או", bring your own. The generator differs
              from the story's: it draws a BACKGROUND and we lay the caption
              over it, because b-roll is an image with a caption on top, not
              a frame the model composes end to end. */}
          {/* Waiting on the OpenAI connection answer. B-roll had no skeleton
              of its own, so this keeps the slot the right height instead of
              letting the AI card render and then flip to the credits card. */}
          {isBRoll && !hydrating && openAiConnected === null && (
            <>
              <Skeleton className="h-[190px] w-full rounded-[18px]" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-px flex-1" />
                <Skeleton className="h-3 w-6" />
                <Skeleton className="h-px flex-1" />
              </div>
            </>
          )}

          {isBRoll && !hydrating && openAiConnected === false && (
            <>
              <MediaCreditsCard />

              <div className="flex items-center gap-3" role="separator">
                <span className="h-px flex-1 bg-border-neutral-default" />
                <span className="text-xs text-text-neutral-default">או</span>
                <span className="h-px flex-1 bg-border-neutral-default" />
              </div>
            </>
          )}

          {isBRoll && !hydrating && openAiConnected === true && (
            <>
              <div className="flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4">
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
                  יצירת בי-רול בלחיצה
                </span>
                <span className="max-w-[286px] text-center text-xs leading-relaxed text-text-neutral-default">
                  ניצור רקע שמתאים לתוכן הפוסט, נשלב עליו את הטקסט של הבי-רול
                  ונהפוך את זה לסרטון קצר
                </span>
                <Button
                  variant="outline"
                  onClick={handleBRollGenerate}
                  disabled={!postId || bRollGenerating}
                  className="w-full gap-1.5"
                >
                  {bRollGenerating && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  יצירת בי-רול עם AI
                </Button>
              </div>

              <div className="flex items-center gap-3" role="separator">
                <span className="h-px flex-1 bg-border-neutral-default" />
                <span className="text-xs text-text-neutral-default">או</span>
                <span className="h-px flex-1 bg-border-neutral-default" />
              </div>
            </>
          )}

          {!hydrating && previewUrl && !isBRoll && (
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
                      ? format === "story" || isBRoll
                        // Both are vertical video with the hook laid over it —
                        // a square frame misrepresents what gets published.
                        ? "aspect-[9/16] w-[200px]"
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
          {format === "b_roll" &&
            !hydrating &&
            previewKind === "video" &&
            previewUrl &&
            (videoTextBurned ? (
              <div className="flex items-center gap-1.5 rounded-lg bg-bg-surface px-3 py-2.5 text-small text-text-primary-default">
                <CircleCheck className="size-4 shrink-0 text-yellow-30" />
                {isBRoll
                  ? "הכיתוב הוטמע בסרטון — הבי-רול מוכן"
                  : "הכיתוב הוטמע בסרטון — הסטורי מוכן"}
              </div>
            ) : burningText ? (
              // The indication the caption is going on. It replaced a button:
              // pasting the link already said "caption this", so a second
              // press was asking the same question twice.
              <p className="inline-flex items-center gap-2 self-start text-xs text-text-neutral-default">
                <Loader2 className="size-3.5 animate-spin" />
                מטמיעים את הכיתוב בסרטון...
              </p>
            ) : null)}

          {/* Bring your own — paste a Drive/Canva link. Drive links are
              attached automatically — a video stays in Drive and plays from
              there, an image is copied over. Canva/other stay as a reference
              link. Upload-from-computer was removed per Hani.

              Once media is attached the field has done its job, and leaving it
              open reads as "you still need to paste something" under a video
              that's already there. Collapse it behind a replace button and only
              bring it back when the user asks to swap the clip. */}
          {isBRoll && !showBRollDriveField ? (
            // Same door as the story's (Hani, 2026-07-29): one button naming
            // where the media comes from, with the field behind it. Doubles
            // as the "replace" affordance once a clip is in — swapping and
            // adding are the same action here, since b-roll holds one clip.
            <Button
              variant="outline"
              onClick={() => {
                setReplacingMedia(true)
                setDriveUrl("")
              }}
              className="w-full gap-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/google-drive.svg"
                alt=""
                className="size-4 shrink-0"
              />
              {previewUrl ? "החלפת מדיה מ Google Drive" : "יבוא מדיה מ Google Drive"}
            </Button>
          ) : (
          <div className="flex flex-col gap-2">
            {/* B-roll follows the story's wording (Hani, 2026-07-29 — Figma
                597:969). Its field auto-pulls on paste already, and the
                caption now goes on straight after, so "ייבוא מדיה" describes
                the whole action rather than just the text box. */}
            <p className="text-small-bold text-text-primary-default">
              {isBRoll
                ? "ייבוא מדיה"
                : format === "story"
                  ? "או הדביקו קישור למדיה"
                  : "מדיה משלכם"}
            </p>
            {isBRoll && (
              <p className="text-xs-body text-text-neutral-default">
                הדביקו קישור ישיר מגוגל דרייב
              </p>
            )}
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
          )}

          {/* The b-roll itself, in the same grey band the story uses — and,
              like the story, the band is also where it's made: the caption
              render shows here rather than as a line of text somewhere else.
              Delete is the hover icon on the clip, matching every other
              media surface in the app. */}
          {/* A b-roll STILL the user brought — under the ?imgcap gate it gets
              the same caption block the image post does, so "בדוק שזה עובד
              טוב בבי-רול" is answered by the same component rather than by a
              second implementation that drifts. A CLIP still runs through the
              ffmpeg burn below; only a still lands here. */}
          {isBRoll &&
            captionEnabled &&
            previewKind === "image" &&
            (previewUrl || captioningImage) && (
              <ImageCaptionBlock
                aspect="9/16"
                state={
                  captioningImage
                    ? "captioning"
                    : captionImageError
                      ? "error"
                      : "idle"
                }
                errorMessage={captionImageError}
                captionedUrl={captionedImage?.url ?? null}
                originalUrl={captionOriginalUrl ?? previewUrl}
                captionOn={captionOn}
                onRetry={() => {
                  clearImageCaptionError(postId)
                  const source = captionOriginalUrl ?? previewUrl
                  if (source) runImageCaption(source)
                }}
                onOpenLightbox={setLightboxSrc}
              />
            )}

          {isBRoll &&
            !(captionEnabled && previewKind === "image") &&
            (previewUrl || burningText || bRollGenerating) && (
            <div className="-mx-6 -mb-6 mt-2 flex flex-col items-center gap-5 bg-gray-95 px-6 py-5 dark:bg-gray-10">
              <p className="text-center text-xs text-text-neutral-default">
                {bRollGenerating
                  ? "מייצרים מדיה לבי-רול..."
                  : burningText
                    ? "מטמיעים את הכיתוב בסרטון..."
                    : "הבי-רול שלך"}
              </p>
              {burningText || bRollGenerating ? (
                <div
                  className="flex w-[200px] aspect-[9/16] items-center justify-center rounded-[10px] border border-border-neutral-default bg-gray-90 dark:bg-gray-20"
                  aria-label="מטמיעים את הכיתוב בסרטון"
                >
                  <Loader2 className="size-5 animate-spin text-text-neutral-default" />
                </div>
              ) : previewUrl ? (
                <div className="group relative w-[200px] aspect-[9/16] overflow-hidden rounded-[10px] border border-border-neutral-default bg-bg-surface">
                  {isDriveUrl(previewUrl) ? (
                    // Link-mode video — streams from Drive, no copy of ours.
                    <DriveVideoPreview url={previewUrl} label="הבי-רול שלך" />
                  ) : previewKind === "image" ? (
                    // An AI b-roll: the caption is already part of the image.
                    // next/image, NOT <img> — the stored asset is a
                    // publish-quality 1080x1920 PNG (~2.3MB) and this slot is
                    // 200px wide. Serving the original here was the "long
                    // delay" (Hani, 2026-07-29).
                    <Image
                      src={previewUrl}
                      alt="הבי-רול שלך"
                      width={200}
                      height={356}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video
                      src={
                        previewUrl.startsWith("blob:")
                          ? previewUrl
                          : `${previewUrl}#t=0.001`
                      }
                      controls
                      playsInline
                      muted
                      // Metadata only until she presses play. A burned clip is
                      // ~2MB and took 3.5s to pull in full — a wait paid on
                      // every panel open for a frame she may never play.
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(true)}
                    disabled={uploading || !postId}
                    aria-label="מחיקת הבי-רול"
                    title="מחיקת הבי-רול"
                    className="absolute end-2 top-2 z-10 flex size-7 items-center justify-center rounded-md bg-white/90 text-button-destructive-default opacity-0 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          )}
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
            // Same player as the canvas card — the panel is where she decides
            // whether to keep a set, so it has to show the real pacing too,
            // not a still she has to click through.
            <StoryPlayer
              frames={storyLightbox.set}
              className="w-full aspect-[9/16] border border-border-neutral-default"
            />
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
