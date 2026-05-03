"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, Smartphone, Video, Layers, Image, Download, ChevronLeft, ChevronRight, Trash2, Play, Pause, Sparkles, Copy, Check, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/app-shell"
import { InfiniteCanvas } from "@/components/infinite-canvas"
import { WorkflowCard } from "@/components/workflow-card"
import { SelectionCard } from "@/components/selection-card"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipLabel } from "@/components/ui/tooltip"
import { MediaPanel } from "@/components/media-panel"
import { ConfirmModal } from "@/components/confirm-modal"
import type { Avatar } from "@/components/avatar-picker"
import type { SlideData } from "@/lib/carousel-templates"
import { createClient } from "@/lib/supabase/client"
import { userKey } from "@/lib/user-scoped-storage"

type Flow = "idea" | "hook" | "saved"

const FORMATS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "story", label: "סטורי", icon: Smartphone },
  { id: "talking_head", label: "דיבור למצלמה", icon: Video },
  { id: "carousel", label: "קרוסלה", icon: Layers },
  { id: "image_post", label: "פוסט תמונה", icon: Image },
]

const FORMAT_MAP = Object.fromEntries(FORMATS.map((f) => [f.id, f]))

const CARD_WIDTH = 346
const CARD_GAP = 24

function shortenTitle(text: string, maxWords = 7): string {
  if (!text) return text
  let working = text.trim()

  // Remove leading "@username (XK עוקבים, platform) — " pattern
  working = working.replace(/^@\S+\s*\([^)]*\)\s*[—\-–:]\s*/, "")
  // Remove leading "טרנד:" prefix
  working = working.replace(/^טרנד:\s*/, "")
  // Remove brackets at start
  working = working.replace(/^\[/, "").replace(/\]$/, "")

  // Take the first sentence (split by . ! ?)
  const sentenceMatch = working.match(/^[^.!?]+/)
  if (sentenceMatch) working = sentenceMatch[0].trim()

  // Trim to maxWords without ellipsis
  const words = working.split(/\s+/)
  if (words.length <= maxWords) return working
  return words.slice(0, maxWords).join(" ")
}

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectPageInner />
    </Suspense>
  )
}

function ProjectPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialIdea = searchParams.get("idea") ?? ""
  const hookParam = searchParams.get("hook") ?? ""
  const hookIdParam = searchParams.get("hook_id") ?? ""
  const postId = searchParams.get("post_id") ?? ""
  const flow: Flow = postId ? "saved" : hookParam ? "hook" : "idea"

  const [idea, setIdea] = useState(initialIdea)
  useEffect(() => { setIdea(initialIdea) }, [initialIdea])
  const [hooks, setHooks] = useState<string[]>([])
  const [selectedHook, setSelectedHook] = useState<number | null>(null)
  const [hooksLoading, setHooksLoading] = useState(false)
  const [error, setError] = useState("")
  const [apiNotConnected, setApiNotConnected] = useState(false)
  const [response, setResponse] = useState("")
  const [corePost, setCorePost] = useState("")
  const [postLoading, setPostLoading] = useState(false)
  const [postError, setPostError] = useState("")
  const [showFormats, setShowFormats] = useState(false)
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [duplicatedFormats, setDuplicatedFormats] = useState<string[]>([])
  const [formatPosts, setFormatPosts] = useState<Record<string, string>>({})
  const [activeCard, setActiveCard] = useState<string>(flow === "hook" ? "response" : "hooks")
  const [editableHook, setEditableHook] = useState<string>(hookParam || "")

  // Media panel state
  const [selectedFormatCard, setSelectedFormatCard] = useState<string | null>(null)

  // Talking head state (lifted for panel persistence)
  const [thAvatar, setThAvatar] = useState<Avatar | null>(null)
  const [thAudioBlob, setThAudioBlob] = useState<Blob | null>(null)
  const [thTranscript, setThTranscript] = useState("")
  const [thVideoUrl, setThVideoUrl] = useState<string | null>(null)
  const [thSourceMode, setThSourceMode] = useState<"choose" | "upload" | "avatar">("choose")
  const [thCoverImage, setThCoverImage] = useState<string | null>(null)
  const [thCoverLoading, setThCoverLoading] = useState(false)
  // Confirmation modal — opened from the trash icon on the video card. The
  // actual delete only fires after the user clicks "כן, למחוק". The cover has
  // no standalone delete action; it lives and dies with the video.
  const [pendingVideoDelete, setPendingVideoDelete] = useState(false)
  // Video-card skeleton state. The DB load + heygen-embed conversion can take
  // a couple of seconds; without this the talking_head card just doesn't
  // render at all during that gap and the page looks like it has no video.
  const [thVideoLoading, setThVideoLoading] = useState(!!postId)
  const [coverText, setCoverText] = useState("")
  const [thVideoFrameDataUrl, setThVideoFrameDataUrl] = useState<string | null>(null)
  const thVideoCardRef = useRef<HTMLDivElement>(null)

  // Carousel state (lifted for panel persistence)
  const [carouselImages, setCarouselImages] = useState<string[] | null>(null)
  const [carouselSlides, setCarouselSlides] = useState<SlideData[] | null>(null)
  const carouselCardRef = useRef<HTMLDivElement>(null)

  // Learning log — store originals to detect edits
  const [originalHooks, setOriginalHooks] = useState<string[]>([])
  const [originalCorePost, setOriginalCorePost] = useState("")

  // Saved post tracking
  const [savedPostId, setSavedPostId] = useState<string | null>(postId || null)
  const [savedPostLoading, setSavedPostLoading] = useState(!!postId)
  const [savedHookText, setSavedHookText] = useState("")

  // Keep savedPostId in sync with the URL's post_id. After a recovery navigate
  // (router.replace below) the URL gains a post_id but savedPostId would stay
  // null otherwise — that breaks the videoUrl/cover auto-save useEffects which
  // gate on savedPostId.
  useEffect(() => {
    if (postId && !savedPostId) setSavedPostId(postId)
  }, [postId, savedPostId])

  // Persist canvas state across refresh — keyed by URL params so different sessions don't bleed
  const CANVAS_KEY = "canvasState_v1"
  const sessionKey = `${flow}|${initialIdea}|${hookParam}|${postId}`
  const restoredRef = useRef(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (restoredRef.current) return
    if (!userId) return
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(userKey(CANVAS_KEY, userId))
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved?.sessionKey !== sessionKey) return
      // Recovery: if we previously auto-saved a post under this hook flow but
      // the URL doesn't carry post_id (e.g. the tab was opened before the URL
      // sync was wired up), navigate to the saved-flow URL so the DB load fires
      // and restores avatar video, cover, and format variants.
      if (typeof saved.savedPostId === "string" && saved.savedPostId && !postId) {
        const params = new URLSearchParams(window.location.search)
        params.set("post_id", saved.savedPostId)
        router.replace(`${window.location.pathname}?${params.toString()}`)
        return
      }
      if (typeof saved.idea === "string") setIdea(saved.idea)
      if (Array.isArray(saved.hooks)) setHooks(saved.hooks)
      if (saved.selectedHook === null || typeof saved.selectedHook === "number") setSelectedHook(saved.selectedHook)
      if (typeof saved.response === "string") setResponse(saved.response)
      if (typeof saved.corePost === "string") setCorePost(saved.corePost)
      if (typeof saved.showFormats === "boolean") setShowFormats(saved.showFormats)
      if (Array.isArray(saved.selectedFormats)) setSelectedFormats(saved.selectedFormats)
      if (Array.isArray(saved.duplicatedFormats)) setDuplicatedFormats(saved.duplicatedFormats)
      if (saved.formatPosts && typeof saved.formatPosts === "object") setFormatPosts(saved.formatPosts)
      if (typeof saved.editableHook === "string") setEditableHook(saved.editableHook)
      if (typeof saved.coverText === "string") setCoverText(saved.coverText)
      if (typeof saved.thTranscript === "string") setThTranscript(saved.thTranscript)
      if (saved.thSourceMode === "choose" || saved.thSourceMode === "upload" || saved.thSourceMode === "avatar") setThSourceMode(saved.thSourceMode)
      if (typeof saved.savedHookText === "string") setSavedHookText(saved.savedHookText)
      if (Array.isArray(saved.originalHooks)) setOriginalHooks(saved.originalHooks)
      if (typeof saved.originalCorePost === "string") setOriginalCorePost(saved.originalCorePost)
    } catch (err) { console.error("[project][canvas-restore]", err) }
  }, [sessionKey, postId, router, userId])

  // Save canvas state on changes (debounced)
  useEffect(() => {
    if (!restoredRef.current) return
    if (!userId) return
    const t = setTimeout(() => {
      try {
        const state = {
          sessionKey,
          idea, hooks, selectedHook, response, corePost,
          showFormats, selectedFormats, duplicatedFormats, formatPosts,
          editableHook, coverText, thTranscript, thSourceMode,
          savedHookText, originalHooks, originalCorePost,
          // Persist the auto-saved post id so a refresh on a tab whose URL
          // hasn't been synced yet (e.g. opened before the URL-sync was wired
          // up) can still recover the saved post via the restore effect above.
          savedPostId,
        }
        localStorage.setItem(userKey(CANVAS_KEY, userId), JSON.stringify(state))
      } catch (err) { console.error("[project][canvas-save]", err) }
    }, 300)
    return () => clearTimeout(t)
  }, [sessionKey, idea, hooks, selectedHook, response, corePost, showFormats, selectedFormats, duplicatedFormats, formatPosts, editableHook, coverText, thTranscript, thSourceMode, savedHookText, originalHooks, originalCorePost, savedPostId, userId])

  // Extract a frame from a video URL as a data URL
  const extractVideoFrame = (videoSrc: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = document.createElement("video")
      video.crossOrigin = "anonymous"
      video.muted = true
      video.src = videoSrc
      video.onloadeddata = () => {
        video.currentTime = 1 // grab frame at 1 second
      }
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas")
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const ctx = canvas.getContext("2d")
          ctx?.drawImage(video, 0, 0)
          resolve(canvas.toDataURL("image/jpeg", 0.8))
        } catch (err) {
          console.error("[project][video-frame-capture]", err)
          resolve(null)
        }
      }
      video.onerror = () => resolve(null)
      setTimeout(() => resolve(null), 5000)
    })
  }

  // Generate cover with optional video frame as thumbnail
  const generateCoverForPost = async (hookText: string, videoSrc?: string) => {
    setThCoverLoading(true)
    let thumbnailUrl: string | undefined

    // Reuse saved frame data URL if available
    if (thVideoFrameDataUrl) {
      thumbnailUrl = thVideoFrameDataUrl
    } else if (videoSrc && !videoSrc.includes("heygen.com")) {
      const isImageUrl = videoSrc.includes("/video-thumb/") || videoSrc.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
      if (isImageUrl) {
        thumbnailUrl = videoSrc
      } else {
        const frame = await extractVideoFrame(videoSrc)
        if (frame) {
          thumbnailUrl = frame
          setThVideoFrameDataUrl(frame)
        }
      }
    }

    try {
      const res = await fetch("/api/reel-cover/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: hookText, thumbnail_url: thumbnailUrl }),
      })
      const d = await res.json()
      if (d.covers?.[0]) setThCoverImage(d.covers[0])
    } catch (err) { console.error("[project][th-cover-generate]", err) }
    finally { setThCoverLoading(false) }
  }

  // The currently active hook text
  const activeHook = flow === "hook" ? editableHook : flow === "saved" ? savedHookText : (selectedHook !== null ? hooks[selectedHook] : "")

  // Sync cover text with active hook (only set if empty)
  useEffect(() => {
    if (activeHook && !coverText) setCoverText(activeHook)
  }, [activeHook, coverText])

  // Saved flow: load post from DB.
  //
  // Skip the fetch when we're transitioning from an in-session generate —
  // `corePost` is already populated, and re-fetching would (a) flip
  // savedPostLoading to true (which would unmount the hook + workflow cards)
  // and (b) race against any unsaved local edits to `response`.
  useEffect(() => {
    if (flow !== "saved" || !postId) return
    if (corePost) return
    setSavedPostLoading(true)
    fetch(`/api/core-posts/${postId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.post) {
          setCorePost(data.post.body)
          setOriginalCorePost(data.post.body)
          setResponse(data.post.user_response ?? "")
          if (data.post.hook_text) {
            setSavedHookText(data.post.hook_text as string)
            // Hydrate editableHook so the saved flow can reuse the same hook
            // card + workflow card rendering as the live "from hook" flow —
            // otherwise both controls vanish on refresh / re-entry.
            setEditableHook(data.post.hook_text as string)
            setCoverText((data.post.cover_text as string) || (data.post.hook_text as string))
          }
          setActiveCard("post")

          // Restore format variants
          const fp = data.post.formatPosts as Record<string, string>
          if (fp && Object.keys(fp).length > 0) {
            setFormatPosts(fp)
            setDuplicatedFormats(Object.keys(fp))
            setSelectedFormats(Object.keys(fp))
            setShowFormats(true)
          }

          // Restore saved cover if exists. Flip thCoverLoading on while we
          // fetch + decode so the cover area shows a skeleton instead of
          // empty space (the fetch + FileReader takes ~1s on slow networks).
          if (data.post.coverUrl) {
            setThCoverLoading(true)
            fetch(data.post.coverUrl as string)
              .then((r) => r.blob())
              .then((blob) => {
                const reader = new FileReader()
                reader.onload = () => {
                  const dataUrl = reader.result as string
                  const base64 = dataUrl.split(",")[1]
                  if (base64) setThCoverImage(base64)
                  setThCoverLoading(false)
                }
                reader.onerror = () => setThCoverLoading(false)
                reader.readAsDataURL(blob)
              })
              .catch(() => setThCoverLoading(false))
          }

          // Load video thumbnail as data URL for cover regeneration
          if (data.post.videoUrl) {
            const vUrl = data.post.videoUrl as string
            const isThumb = vUrl.includes("/video-thumb/") || vUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
            if (isThumb) {
              fetch(vUrl)
                .then((r) => r.blob())
                .then((blob) => {
                  const reader = new FileReader()
                  reader.onload = () => setThVideoFrameDataUrl(reader.result as string)
                  reader.readAsDataURL(blob)
                })
                .catch(() => {})
            }
          }

          // No video in DB — clear the skeleton so the layout collapses.
          if (!data.post.videoUrl) {
            setThVideoLoading(false)
          }

          // Restore video URL and auto-generate cover if no saved cover
          if (data.post.videoUrl) {
            const videoUrl = data.post.videoUrl as string
            const hookForCover = (data.post.hook_text as string) || ""
            const hasSavedCover = !!data.post.coverUrl

            // Convert HeyGen embed to stored MP4
            const embedMatch = videoUrl.match(/heygen\.com\/embeds\/([a-f0-9]+)/)
            if (embedMatch) {
              fetch(`/api/videos/${embedMatch[1]}`)
                .then((r) => r.json())
                .then(async (vData) => {
                  if (vData.video_url) {
                    const storeRes = await fetch("/api/videos/store", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ video_url: vData.video_url }),
                    })
                    const stored = await storeRes.json()
                    if (stored.url) {
                      setThVideoUrl(stored.url)
                      if (postId) {
                        fetch(`/api/core-posts/${postId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ videoUrl: stored.url }),
                        }).catch(() => {})
                      }
                      if (hookForCover && !hasSavedCover) generateCoverForPost(hookForCover, stored.url)
                      return
                    }
                  }
                  setThVideoUrl(videoUrl)
                  if (hookForCover && !hasSavedCover) generateCoverForPost(hookForCover)
                })
                .catch(() => {
                  setThVideoUrl(videoUrl)
                  if (hookForCover && !hasSavedCover) generateCoverForPost(hookForCover)
                })
            } else {
              setThVideoUrl(videoUrl)
              if (hookForCover && !hasSavedCover) generateCoverForPost(hookForCover, videoUrl)
            }
          }
        }
      })
      .catch(() => setThVideoLoading(false))
      .finally(() => setSavedPostLoading(false))
  }, [flow, postId])

  // Once the video URL lands in state (from any path — DB load, heygen
  // conversion, or a fresh upload), the skeleton placeholder can stand down.
  useEffect(() => {
    if (thVideoUrl) setThVideoLoading(false)
  }, [thVideoUrl])

  // Auto-save video URL when it changes
  useEffect(() => {
    if (!savedPostId || !thVideoUrl) return
    if (thVideoUrl.startsWith("blob:")) return
    fetch(`/api/core-posts/${savedPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: thVideoUrl }),
    }).catch(() => {})
  }, [savedPostId, thVideoUrl])

  // Auto-save cover when it changes
  useEffect(() => {
    if (!savedPostId || !thCoverImage) return
    fetch(`/api/core-posts/${savedPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverBase64: thCoverImage }),
    }).catch(() => {})
  }, [savedPostId, thCoverImage])

  // Auto-save cover text when it changes (debounced by dependency)
  // Auto-save cover text (debounced)
  const prevCoverTextRef = useRef(coverText)
  useEffect(() => {
    if (!savedPostId || !coverText || coverText === prevCoverTextRef.current) return
    prevCoverTextRef.current = coverText
    const timer = setTimeout(() => {
      fetch(`/api/core-posts/${savedPostId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverText }),
      }).catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [savedPostId, coverText])

  // Manual hooks generation (no auto-generation)
  const handleGenerateHooks = () => {
    if (!idea) return
    setHooksLoading(true)
    fetch("/api/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea,
        count: 10,
        fieldIdeas: (() => {
          try {
            if (!userId) return []
            const s = localStorage.getItem(userKey("generatedIdeas_v23", userId))
            if (!s) return []
            return JSON.parse(s).map((i: { text: string; source?: string; category?: string; url?: string }) => ({
              text: i.text,
              source: i.source,
              category: i.category,
              url: i.url,
            }))
          } catch (err) { console.error("[project][ideas-payload-parse]", err); return [] }
        })(),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error === "anthropic_not_connected") {
          setApiNotConnected(true)
        } else if (data.error) {
          setError(data.error)
        } else if (data.hooks) {
          setHooks(data.hooks)
          setOriginalHooks(data.hooks)
        }
      })
      .catch(() => setError("שגיאה ביצירת הוקים"))
      .finally(() => setHooksLoading(false))
  }

  const handleGeneratePost = async () => {
    if (!activeHook || !response.trim()) return

    // Hydrate editableHook + savedHookText so the post-generation UI (which
    // mirrors the "from hook" / "from saved" rendering) has the right hook
    // text regardless of whether we came from idea/hook/saved. Without this,
    // an idea-flow user loses both their hook and the textarea once the URL
    // gets a post_id and Next 16's useSearchParams flips `flow` to "saved".
    setEditableHook(activeHook)
    setSavedHookText(activeHook)

    // Learning log: detect hook edit (fire and forget)
    if (selectedHook !== null && originalHooks[selectedHook] && hooks[selectedHook] !== originalHooks[selectedHook]) {
      fetch("/api/learning-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: originalHooks[selectedHook],
          editedText: hooks[selectedHook],
          contentType: "hook",
        }),
      }).catch(() => {})
    }

    setPostLoading(true)
    setPostError("")
    setCorePost("")

    try {
      const res = await fetch("/api/core-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hook: activeHook,
          userResponse: response,
        }),
      })
      const data = await res.json()
      if (data.error === "anthropic_not_connected") {
        setApiNotConnected(true)
      } else if (data.error) {
        setPostError(data.error)
      } else if (data.post) {
        setCorePost(data.post)
        setOriginalCorePost(data.post)
        setActiveCard("post")

        // Auto-save to DB (fire and forget)
        fetch("/api/core-posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: data.post,
            hookText: activeHook,
            hookId: hookIdParam || undefined,
            userResponse: response,
            videoUrl: thVideoUrl && !thVideoUrl.startsWith("blob:") ? thVideoUrl : undefined,
          }),
        })
          .then((res) => res.json())
          .then((saveData) => {
            if (saveData.id) {
              setSavedPostId(saveData.id)
              // Update URL with post_id so a refresh re-loads this exact post
              // (incl. avatar video, cover, formats). replaceState avoids a
              // Next.js navigation — current in-memory `flow` stays at "hook",
              // but on refresh `useSearchParams` reads post_id and switches to
              // the "saved" flow which re-fetches the row from DB.
              const url = new URL(window.location.href)
              if (!url.searchParams.get("post_id")) {
                url.searchParams.set("post_id", saveData.id)
                window.history.replaceState({}, "", url.toString())
              }
            }
          })
          .catch(() => {})
      }
    } catch (err) {
      console.error("[project][create-post]", err)
      setPostError("שגיאה ביצירת הפוסט")
    } finally {
      setPostLoading(false)
    }
  }

  const handleFormatCardClick = (fid: string) => {
    setSelectedFormatCard(selectedFormatCard === fid ? null : fid)
  }

  return (
    <AppShell idea={shortenTitle(idea || hookParam || (postId ? "עריכת פוסט" : ""))}>
      {/* Media Panel — sibling to InfiniteCanvas, slides from left */}
      <MediaPanel
        formatId={selectedFormatCard}
        onClose={() => setSelectedFormatCard(null)}
        thAvatar={thAvatar}
        thAudioBlob={thAudioBlob}
        thTranscript={thTranscript}
        thVideoUrl={thVideoUrl}
        thSourceMode={thSourceMode}
        onThAvatarChange={setThAvatar}
        onThAudioBlobChange={setThAudioBlob}
        onThTranscriptChange={setThTranscript}
        onThVideoUrlChange={setThVideoUrl}
        onThSourceModeChange={setThSourceMode}
        thCoverImage={thCoverImage}
        onThCoverImageChange={setThCoverImage}
        onThCoverLoadingChange={setThCoverLoading}
        onThVideoFrameChange={setThVideoFrameDataUrl}
        hookText={activeHook}
        onScrollToVideo={() => thVideoCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
        carouselImages={carouselImages}
        carouselSlides={carouselSlides}
        onCarouselImagesChange={setCarouselImages}
        onCarouselSlidesChange={setCarouselSlides}
        carouselText={formatPosts["carousel"] ?? ""}
        onScrollToCarousel={() => carouselCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
      />

      <InfiniteCanvas>
        {apiNotConnected && (
          <div dir="rtl" className="mx-6 mt-6 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4 flex items-center justify-between">
            <p className="text-small text-text-neutral-default">
              חברו את חשבון Claude שלכם כדי ליצור תוכן
            </p>
            <Link href="/settings" className="text-small font-semibold text-text-primary-default hover:underline">
              עבור להגדרות
            </Link>
          </div>
        )}
        <div className="flex items-start gap-0 pt-24 pr-24" dir="rtl">

          {/* === Flow: from idea === */}
          {flow === "idea" && (
            <>
              {/* Idea card — editable */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[346px] shrink-0"
              >
                <div className="flex items-center bg-bg-surface px-6 py-3 rounded-t-[20px]">
                  <span className="text-p-bold text-text-primary-default">רעיון</span>
                </div>
                <div className="px-6">
                  <div className="rounded-lg p-2 transition-colors focus-within:bg-gray-95">
                    <Textarea
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      placeholder="כתבו או ערכו את הרעיון..."
                      className="min-h-[120px] text-small text-text-primary-default border-none bg-transparent shadow-none p-0 resize-none focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>

              {/* Connector: Idea → Hooks */}
              <div className="flex items-center mt-[55px]">
                <div className="h-[2px] w-7 bg-gray-80" />
              </div>

              {/* Hook selection card */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px] shrink-0"
              >
                <div className={`flex items-center px-6 py-3 rounded-t-[20px] ${activeCard === "hooks" ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}>
                  <span className="text-p-bold text-text-primary-default">בחירת הוק</span>
                </div>

                {hooksLoading && (
                  <div className="flex items-center justify-center gap-2 px-6 py-8">
                    <Loader2 className="size-5 animate-spin text-yellow-50" />
                    <span className="text-small text-text-neutral-default">מייצר הוקים...</span>
                  </div>
                )}

                {error && !hooksLoading && (
                  <div className="px-6 flex flex-col gap-2 items-center">
                    {error === "anthropic_overloaded" ? (
                      <>
                        <span className="text-small text-text-primary-default">השרתים של Anthropic עמוסים כרגע. נסו שוב בעוד דקה</span>
                        <Button size="sm" onClick={() => { setError(""); handleGenerateHooks() }} className="gap-1.5">
                          <Sparkles className="size-3.5" />
                          נסו שוב
                        </Button>
                      </>
                    ) : error === "credits_exhausted" ? (
                      <>
                        <span className="text-small text-text-primary-default">נגמרו לכם הקרדיטים של Anthropic</span>
                        <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="text-small-bold text-text-primary-default hover:underline">
                          לרכישת קרדיטים →
                        </a>
                      </>
                    ) : (
                      <span className="text-small text-button-destructive-default">{error}</span>
                    )}
                  </div>
                )}

                {hooks.length === 0 && !hooksLoading && !error && (
                  <div className="flex justify-center px-6 py-4">
                    <Button onClick={handleGenerateHooks} size="sm" className="gap-1.5">
                      <Sparkles className="size-3.5" />
                      תייצר לי הוקים
                    </Button>
                  </div>
                )}

                {hooks.length > 0 && !hooksLoading && (
                  <div className="flex flex-col gap-3 px-6">
                    {hooks.map((hook, i) => (
                      <SelectionCard
                        key={i}
                        description={hook}
                        isSelected={selectedHook === i}
                        editable
                        onSelect={() => {
                          setSelectedHook(selectedHook === i ? null : i)
                          setActiveCard("hooks")
                        }}
                        onTextChange={(text) => {
                          const updated = [...hooks]
                          updated[i] = text
                          setHooks(updated)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Workflow card — only appears after hook is selected */}
              {selectedHook !== null && (
                <>
                  <div className="flex items-center mt-[55px]">
                    <div className="h-[2px] w-7 bg-gray-80" />
                  </div>
                  <div className="flex flex-col items-start">
                    <WorkflowCard
                      title="מה תרצו להגיד על זה?"
                      subtitle="מה הניסיון האישי שלכם? למה זה שונה ממה שהיה עד עכשיו?"
                      buttonLabel="אפשר גם להקליט"
                      submitLabel="תייצר לי פוסט ליבה"
                      warningText={corePost ? "ג׳ינרוט מחדש יבטל את הפוסט הנוכחי" : undefined}
                      active={activeCard === "response"}
                      value={response}
                      onFocus={() => setActiveCard("response")}
                      onChange={(val) => setResponse(val)}
                      onSubmit={handleGeneratePost}
                      className="w-[567px]"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* === Flow: from hook (also reused for saved-post re-entry and
                for the in-session transition to saved). Trigger on hook text
                presence rather than on `savedPostLoading`, because Next 16's
                useSearchParams reacts to `history.replaceState` from the
                auto-save and would otherwise unmount these cards a second or
                two after generation. === */}
          {(flow === "hook" || (flow === "saved" && !!(savedHookText || editableHook))) && (
            <>
              {/* Hook card — editable */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[346px] shrink-0"
              >
                <div className="flex items-center bg-bg-surface px-6 py-3 rounded-t-[20px]">
                  <span className="text-p-bold text-text-primary-default">הוק</span>
                </div>
                <div className="px-6">
                  <div className="rounded-lg p-2 transition-colors focus-within:bg-gray-95">
                    <Textarea
                      value={editableHook}
                      onChange={(e) => setEditableHook(e.target.value)}
                      placeholder="כתבו או ערכו את ההוק..."
                      className="min-h-[120px] text-small text-text-primary-default border-none bg-transparent shadow-none p-0 resize-none focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>

              {/* Connector */}
              <div className="flex items-center mt-[55px]">
                <div className="h-[2px] w-7 bg-gray-80" />
              </div>

              {/* Workflow card */}
              <div className="flex flex-col items-start">
                <WorkflowCard
                  title="מה תרצו להגיד על זה?"
                  subtitle="מה הניסיון האישי שלכם? למה זה שונה ממה שהיה עד עכשיו?"
                  buttonLabel="אפשר גם להקליט"
                  submitLabel="תייצר לי פוסט ליבה"
                  active={activeCard === "response"}
                  value={response}
                  onFocus={() => setActiveCard("response")}
                  onChange={(val) => setResponse(val)}
                  onSubmit={handleGeneratePost}
                  className="w-[567px]"
                />
              </div>
            </>
          )}

          {/* === Flow: from saved post === */}
          {flow === "saved" && savedPostLoading && (
            <div className="flex items-center gap-2 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4">
              <Loader2 className="size-5 animate-spin text-yellow-50" />
              <span className="text-small text-text-neutral-default">טוען פוסט...</span>
            </div>
          )}

          {/* === Core Post result — shared by all flows === */}
          {(postLoading || corePost || postError) && (
            <>
              {flow !== "saved" && (
                <div className="flex items-center mt-[55px]">
                  <div className="h-[2px] w-7 bg-gray-80" />
                </div>
              )}

              {postLoading && (
                <div className="flex items-center mt-[29px]">
                  <div className="flex items-center gap-2 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4">
                    <Loader2 className="size-5 animate-spin text-yellow-50" />
                    <span className="text-small text-text-neutral-default">כותב את הפוסט...</span>
                  </div>
                </div>
              )}

              {postError && !postLoading && (
                <div className="flex items-center mt-[55px]">
                  <div className="rounded-[20px] border border-button-destructive-default bg-white dark:bg-gray-10 px-6 py-4">
                    <span className="text-small text-button-destructive-default">{postError}</span>
                  </div>
                </div>
              )}

              {corePost && !postLoading && (
                <div className="relative flex flex-col items-center w-[567px] shrink-0">
                  {/* Core post card */}
                  <div
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px] shrink-0"
                  >
                    <div className={`flex items-center px-6 py-3 rounded-t-[20px] ${activeCard === "post" ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}>
                      <span className="text-p-bold text-text-primary-default">פוסט ליבה</span>
                    </div>
                    <div className="flex flex-col gap-4 px-6 items-end">
                      <Textarea
                        value={corePost}
                        onFocus={() => setActiveCard("post")}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => setCorePost(e.target.value)}
                        className="w-full min-h-[250px] rounded-[10px] border-border-neutral-default bg-white dark:bg-gray-10 resize-none shadow-none text-small leading-relaxed select-text"
                      />
                      <Button
                        disabled={activeCard !== "post"}
                        onClick={() => {
                          // Learning log: detect core post edit (fire and forget)
                          if (originalCorePost && corePost.trim() !== originalCorePost.trim()) {
                            fetch("/api/learning-log", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                originalText: originalCorePost,
                                editedText: corePost,
                                contentType: "core_post",
                              }),
                            }).catch(() => {})
                          }
                          setShowFormats(true)
                          setActiveCard("formats")
                        }}
                      >
                        שיכפול לפורמטים
                      </Button>
                    </div>
                  </div>

                  {/* Vertical connector + Formats card */}
                  {showFormats && (
                    <>
                      <div className="w-[2px] h-7 bg-gray-80" />
                      <div
                        dir="rtl"
                        className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px] shrink-0"
                      >
                        <div className={`flex items-center px-6 py-3 rounded-t-[20px] ${activeCard === "formats" ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}>
                          <span className="text-p-bold text-text-primary-default">לאיזה פורמטים לשכפל?</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 px-6">
                          {FORMATS.map((format) => (
                            <SelectionCard
                              key={format.id}
                              description={format.label}
                              icon={<format.icon className="size-4" />}
                              isSelected={selectedFormats.includes(format.id)}
                              onSelect={() => {
                                setSelectedFormats((prev) =>
                                  prev.includes(format.id)
                                    ? prev.filter((f) => f !== format.id)
                                    : [...prev, format.id]
                                )
                                setActiveCard("formats")
                              }}
                            />
                          ))}
                        </div>
                        <div className="px-6 flex justify-end">
                          <Button
                            disabled={selectedFormats.length === 0 || activeCard !== "formats"}
                            onClick={async () => {
                              const formats = [...selectedFormats]
                              setDuplicatedFormats(formats)
                              // Initialize with loading placeholder
                              const posts: Record<string, string> = {}
                              formats.forEach((fid) => {
                                posts[fid] = "מייצר..."
                              })
                              setFormatPosts(posts)

                              // Call format agents in parallel
                              const results: Record<string, string> = {}
                              await Promise.all(
                                formats.map(async (fid) => {
                                  try {
                                    const endpoint = `/api/format/${fid === "talking_head" ? "talking-head" : fid === "image_post" ? "image-post" : fid}`
                                    const res = await fetch(endpoint, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ corePostText: corePost }),
                                    })
                                    const data = await res.json()
                                    const text = data.text || corePost
                                    results[fid] = text
                                    setFormatPosts((prev) => ({ ...prev, [fid]: text }))
                                  } catch (err) {
                                    console.error("[project][format-variant-generate]", err)
                                    results[fid] = corePost
                                    setFormatPosts((prev) => ({ ...prev, [fid]: corePost }))
                                  }
                                })
                              )

                              // Auto-save format variants to DB (fire and forget)
                              if (savedPostId) {
                                fetch(`/api/core-posts/${savedPostId}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ formatPosts: results }),
                                }).catch(() => {})
                              }
                            }}
                          >
                            שכפל!
                          </Button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Format result tree */}
                  {duplicatedFormats.length > 0 && (
                    <div className="relative w-full">
                      <div className="absolute top-0 left-1/2 -translate-x-1/2">
                        <FormatTree
                          formats={duplicatedFormats}
                          formatPosts={formatPosts}
                          onPostChange={(fid, text) => setFormatPosts((prev) => ({ ...prev, [fid]: text }))}
                          activeCard={activeCard}
                          onActiveChange={setActiveCard}
                          selectedFormat={selectedFormatCard}
                          onSelectFormat={handleFormatCardClick}
                          hookText={activeHook}
                          thVideoUrl={thVideoUrl}
                          thVideoLoading={thVideoLoading}
                          thVideoCardRef={thVideoCardRef}
                          onThReRecord={() => {
                            setThAudioBlob(null)
                            setThTranscript("")
                            setSelectedFormatCard("talking_head")
                          }}
                          onThDelete={() => setPendingVideoDelete(true)}
                          thCoverImage={thCoverImage}
                          thCoverLoading={thCoverLoading}
                          coverText={coverText}
                          onCoverTextChange={setCoverText}
                          onCoverRegenerate={() => generateCoverForPost(coverText, thVideoUrl || undefined)}
                          carouselImages={carouselImages}
                          carouselCardRef={carouselCardRef}
                          onCarouselRegenerate={() => {
                            setCarouselImages(null)
                            setCarouselSlides(null)
                            setSelectedFormatCard("carousel")
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        </div>
      </InfiniteCanvas>

      <ConfirmModal
        open={pendingVideoDelete}
        onOpenChange={(open) => { if (!open) setPendingVideoDelete(false) }}
        title="בטוח למחוק את הסרטון?"
        description="פעולה זו תמחק את הסרטון הקיים ולא בטוח שאפשר יהיה לגשת אליו שוב."
        confirmLabel="כן, למחוק"
        cancelLabel="לא, אל תמחק"
        onConfirm={async () => {
          // Snapshot before the delete: video URL + cover base64. The cover
          // travels with the video — they're shown together, deleted together,
          // restored together. If the cover hasn't streamed into local state
          // yet (slow initial fetch), grab it now from DB so the undo path
          // has something to put back.
          const prevVideoUrl = thVideoUrl
          let prevCoverImage = thCoverImage
          if (!prevCoverImage && savedPostId) {
            try {
              const r = await fetch(`/api/core-posts/${savedPostId}`)
              const d = await r.json()
              if (d?.post?.coverUrl) {
                const cr = await fetch(d.post.coverUrl as string)
                const blob = await cr.blob()
                prevCoverImage = await new Promise<string | null>((resolve) => {
                  const fr = new FileReader()
                  fr.onload = () => {
                    const dataUrl = fr.result as string
                    resolve(dataUrl.split(",")[1] || null)
                  }
                  fr.onerror = () => resolve(null)
                  fr.readAsDataURL(blob)
                })
              }
            } catch (err) { console.error("[project][prefetch-cover-for-undo]", err) }
          }
          if (savedPostId) {
            // Await so the modal stays open (with spinner) until the DB
            // deletes actually complete. Otherwise a quick refresh would race
            // the in-flight PATCH and the assets would re-appear after reload.
            try {
              await fetch(`/api/core-posts/${savedPostId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deleteVideo: true, deleteCover: true }),
              })
            } catch (err) { console.error("[project][delete-th-assets]", err) }
          }
          setThVideoUrl(null)
          setThAudioBlob(null)
          setThTranscript("")
          setThCoverImage(null)

          toast("הסרטון נמחק", {
            duration: 30_000,
            className: "toast-destructive",
            action: prevVideoUrl ? {
              label: "שיחזור",
              onClick: async () => {
                setThVideoUrl(prevVideoUrl)
                if (prevCoverImage) setThCoverImage(prevCoverImage)
                if (savedPostId) {
                  try {
                    await fetch(`/api/core-posts/${savedPostId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        videoUrl: prevVideoUrl,
                        ...(prevCoverImage ? { coverBase64: prevCoverImage } : {}),
                      }),
                    })
                    toast.success("הסרטון שוחזר")
                  } catch (err) {
                    console.error("[project][restore-th]", err)
                    toast.error("השחזור נכשל")
                  }
                }
              },
            } : undefined,
          })
        }}
      />

    </AppShell>
  )
}

function FormatTree({
  formats,
  formatPosts,
  onPostChange,
  activeCard,
  onActiveChange,
  selectedFormat,
  onSelectFormat,
  hookText,
  thVideoUrl,
  thVideoLoading,
  thVideoCardRef,
  onThReRecord,
  onThDelete,
  thCoverImage,
  thCoverLoading,
  coverText,
  onCoverTextChange,
  onCoverRegenerate,
  carouselImages,
  carouselCardRef,
  onCarouselRegenerate,
}: {
  formats: string[]
  formatPosts: Record<string, string>
  onPostChange: (fid: string, text: string) => void
  activeCard: string
  onActiveChange: (card: string) => void
  selectedFormat: string | null
  onSelectFormat: (fid: string) => void
  hookText: string
  thVideoUrl: string | null
  thVideoLoading: boolean
  thVideoCardRef: React.RefObject<HTMLDivElement | null>
  onThReRecord: () => void
  onThDelete: () => void
  thCoverImage: string | null
  thCoverLoading: boolean
  coverText: string
  onCoverTextChange: (text: string) => void
  onCoverRegenerate: () => void
  carouselImages: string[] | null
  carouselCardRef: React.RefObject<HTMLDivElement | null>
  onCarouselRegenerate: () => void
}) {
  const count = formats.length
  const totalWidth = count * CARD_WIDTH + (count - 1) * CARD_GAP

  return (
    <div className="flex flex-col items-center">
      {/* Vertical line from formats card */}
      <div className="w-[2px] h-10 bg-gray-80" />

      {/* Horizontal connector bar + branches */}
      {count > 1 && (
        <div className="relative" style={{ width: totalWidth }}>
          {/* Horizontal line */}
          <div
            className="absolute top-0 h-[2px] bg-gray-80"
            style={{
              right: CARD_WIDTH / 2,
              left: CARD_WIDTH / 2,
            }}
          />
          {/* Vertical branches down from horizontal line */}
          <div className="flex justify-between">
            {formats.map((fid) => (
              <div
                key={fid}
                className="flex justify-center"
                style={{ width: CARD_WIDTH }}
              >
                <div className="w-[2px] h-10 bg-gray-80" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format cards — all uniform width, text-only */}
      <div
        className="flex items-start gap-6"
        style={{ width: count > 1 ? totalWidth : undefined }}
        dir="rtl"
      >
        {formats.map((fid) => {
          const format = FORMAT_MAP[fid]
          if (!format) return null
          const Icon = format.icon
          const isActive = activeCard === `format-${fid}`
          const isSelected = selectedFormat === fid

          return (
            <div key={fid} className="flex flex-col items-center" style={{ width: CARD_WIDTH }}>
              <div
                className={`flex flex-col gap-3 rounded-[20px] border bg-white dark:bg-gray-10 pb-6 transition-all w-full ${
                  isSelected
                    ? "border-yellow-50 ring-2 ring-yellow-50"
                    : "border-border-neutral-default"
                }`}
                dir="rtl"
              >
                <div className={`flex items-center gap-2 px-6 py-3 rounded-t-[20px] ${isActive ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}>
                  <span className="text-p-bold text-text-primary-default">{format.label}</span>
                  <Icon className="size-4 text-text-neutral-default" />
                </div>
                <div className="px-6 flex flex-col gap-3">
                  <div className="relative group">
                    <Textarea
                      value={formatPosts[fid] ?? ""}
                      onFocus={() => onActiveChange(`format-${fid}`)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onPostChange(fid, e.target.value)}
                      className="min-h-[200px] rounded-[10px] border-border-neutral-default bg-white dark:bg-gray-10 resize-none shadow-none text-small leading-relaxed select-text"
                    />
                    <CopyButton text={formatPosts[fid] ?? ""} />
                  </div>
                  <Button
                    variant="outline"
                    // talking_head only — disabled once a video exists, since
                    // editing then happens via the video card's "עריכת סרטון"
                    // button below. Other formats are still "(בקרוב)".
                    disabled={fid !== "talking_head" || !!thVideoUrl}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (fid === "talking_head" && !thVideoUrl) onSelectFormat(fid)
                    }}
                    className="w-full rounded-[10px] border-border-neutral-default text-text-primary-default text-small gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon className="size-4" />
                    {fid === "talking_head"
                      ? `עריכת מדיה ל${format.label}`
                      : `עריכת מדיה ל${format.label} (בקרוב)`}
                  </Button>
                </div>
              </div>

              {/* Video skeleton — placeholder while the saved post is being
                  loaded from DB and we don't yet know if there is a video.
                  Same shape as the real card so the layout doesn't jump. */}
              {fid === "talking_head" && !thVideoUrl && thVideoLoading && (
                <>
                  <div className="w-[2px] h-7 bg-gray-80" />
                  <div
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
                  >
                    <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
                      <span className="text-p-bold text-text-primary-default">הוידאו שלכם</span>
                      <Video className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      <div className="flex justify-center">
                        <Skeleton className="w-[200px] aspect-[9/16] rounded-xl" />
                      </div>
                      <div className="flex gap-3 w-full items-center">
                        <Skeleton className="flex-1 h-11 rounded-[12px]" />
                        <Skeleton className="w-11 h-11 rounded-[12px]" />
                        <Skeleton className="w-11 h-11 rounded-[12px]" />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Video result below talking_head card */}
              {fid === "talking_head" && thVideoUrl && (
                <>
                  {/* Connector line */}
                  <div className="w-[2px] h-7 bg-gray-80" />

                  {/* Video card */}
                  <div
                    ref={thVideoCardRef}
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
                  >
                    <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
                      <span className="text-p-bold text-text-primary-default">הוידאו שלכם</span>
                      <Video className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      <div className="flex justify-center">
                        <VideoPlayer url={thVideoUrl} />
                      </div>
                      <div className="flex gap-3 w-full items-center">
                        <Button variant="outline" className="flex-1" onClick={onThReRecord}>
                          עריכת סרטון
                        </Button>
                        <TooltipLabel label="הורד וידאו">
                          <Button
                            variant="outline"
                            type="button"
                            aria-label="הורד וידאו"
                            className="w-11 px-0"
                            onClick={async () => {
                              if (!thVideoUrl) return
                              try {
                                const res = await fetch(thVideoUrl)
                                if (!res.ok) throw new Error("fetch_failed")
                                const blob = await res.blob()
                                const objectUrl = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = objectUrl
                                a.download = `video-${Date.now()}.mp4`
                                document.body.appendChild(a)
                                a.click()
                                a.remove()
                                URL.revokeObjectURL(objectUrl)
                              } catch (err) {
                                console.error("[project][th-video-download]", err)
                                // CORS-blocked or network failure — fall back to a new tab
                                // so the user can right-click → save manually.
                                window.open(thVideoUrl, "_blank")
                              }
                            }}
                          >
                            <Download className="size-4" />
                          </Button>
                        </TooltipLabel>
                        <TooltipLabel label="מחק וידאו">
                          <button
                            type="button"
                            onClick={onThDelete}
                            aria-label="מחק וידאו"
                            className="flex items-center justify-center size-9 shrink-0 rounded-lg hover:bg-red-95 transition-colors cursor-pointer"
                          >
                            <Trash2 className="size-4 text-button-destructive-default" />
                          </button>
                        </TooltipLabel>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Cover skeleton — shows while the cover is generating or being
                  fetched from DB after a refresh. Same shape as the real cover
                  card so the layout doesn't jump when content arrives. */}
              {fid === "talking_head" && thCoverLoading && !thCoverImage && (
                <>
                  <div className="w-[2px] h-7 bg-gray-80" />
                  <div
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
                  >
                    <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface">
                      <span className="text-p-bold text-text-primary-default">קאבר</span>
                      <Image className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-3 w-20 rounded" />
                        <div className="flex gap-2">
                          <Skeleton className="flex-1 h-9 rounded-lg" />
                          <Skeleton className="h-9 w-14 rounded-[8px]" />
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <Skeleton className="w-[200px] aspect-[9/16] rounded-xl" />
                      </div>
                      <Skeleton className="w-full h-11 rounded-[12px]" />
                    </div>
                  </div>
                </>
              )}

              {/* Cover card below video card */}
              {fid === "talking_head" && thCoverImage && (
                <>
                  <div className="w-[2px] h-7 bg-gray-80" />
                  <div
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
                  >
                    <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
                      <span className="text-p-bold text-text-primary-default">קאבר</span>
                      <Image className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      {/* Editable cover text */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-text-neutral-default">טקסט לקאבר</label>
                        <div className="flex gap-2">
                          <input
                            value={coverText}
                            onChange={(e) => onCoverTextChange(e.target.value)}
                            className="flex-1 rounded-lg border border-border-neutral-default bg-transparent px-3 py-2 text-sm text-text-primary-default outline-none focus:border-yellow-50"
                            onMouseDown={(e) => e.stopPropagation()}
                          />
                          <Button size="sm" onClick={onCoverRegenerate} disabled={thCoverLoading} className="shrink-0 gap-2">
                            {thCoverLoading && <Loader2 className="size-4 animate-spin" />}
                            {thCoverLoading ? "יוצר..." : "צור"}
                          </Button>
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <div className="relative w-[200px] aspect-[9/16] rounded-xl overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`data:image/png;base64,${thCoverImage}`}
                            alt="cover"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-center">
                        <TooltipLabel label="הורד קאבר">
                          <Button
                            asChild
                            variant="outline"
                            aria-label="הורד קאבר"
                            className="w-11 px-0"
                          >
                            <a href={`data:image/png;base64,${thCoverImage}`} download="reel-cover.png">
                              <Download className="size-4" />
                            </a>
                          </Button>
                        </TooltipLabel>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Carousel result below carousel card */}
              {fid === "carousel" && carouselImages && carouselImages.length > 0 && (
                <CarouselResultCard
                  images={carouselImages}
                  cardRef={carouselCardRef}
                  onRegenerate={onCarouselRegenerate}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Carousel Result Card — shows generated slides below carousel card  */
/* ------------------------------------------------------------------ */

function CarouselResultCard({
  images,
  cardRef,
  onRegenerate,
}: {
  images: string[]
  cardRef: React.RefObject<HTMLDivElement | null>
  onRegenerate: () => void
}) {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [downloading, setDownloading] = useState(false)

  const handleDownloadAll = async () => {
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
      console.error("[project][carousel-download]", err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <div className="w-[2px] h-7 bg-gray-80" />
      <div
        ref={cardRef}
        dir="rtl"
        className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
      >
        <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
          <span className="text-p-bold text-text-primary-default">הקרוסלה שלכם</span>
          <Layers className="size-4 text-text-neutral-default" />
        </div>
        <div className="px-6 flex flex-col items-center gap-4">
          {/* Slide preview */}
          <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-gray-95">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${images[currentSlide]}`}
              alt={`סלייד ${currentSlide + 1}`}
              className="w-full h-full object-contain"
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); setCurrentSlide(Math.max(0, currentSlide - 1)) }}
              disabled={currentSlide === 0}
              className="p-1.5 rounded-lg hover:bg-bg-surface disabled:opacity-30 transition-colors"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ChevronRight className="size-4 text-text-primary-default" />
            </button>
            <span className="text-small text-text-neutral-default">
              {currentSlide + 1} / {images.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setCurrentSlide(Math.min(images.length - 1, currentSlide + 1)) }}
              disabled={currentSlide === images.length - 1}
              className="p-1.5 rounded-lg hover:bg-bg-surface disabled:opacity-30 transition-colors"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ChevronLeft className="size-4 text-text-primary-default" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 w-full">
            <Button onClick={handleDownloadAll} disabled={downloading} className="flex-1 gap-2">
              <Download className="size-4" />
              {downloading ? "מוריד..." : "הורד הכל"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={onRegenerate}>
              צור מחדש
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Minimal Video Player — play/pause overlay, portrait, no controls  */
/* ------------------------------------------------------------------ */

function VideoPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  // Skeleton overlay until the underlying media (img / video) fires its
  // load event. Without this the card shows an empty gray rectangle while
  // the source is fetched from Supabase Storage on a fresh refresh.
  const [mediaLoaded, setMediaLoaded] = useState(false)

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  const isEmbed = url.includes("heygen.com/embeds")
  const isThumbnail = url.includes("/video-thumb/") || url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
  const isBlob = url.startsWith("blob:")

  // Reset + ensure-loaded logic when the URL changes. Some browsers don't
  // fire onLoadedData reliably for cached videos (the data is already there
  // before React's listeners attach), and iframes for embeds don't always
  // fire onLoad either. Belt-and-suspenders: check readyState on attach,
  // and force-clear after a timeout so the skeleton can never get stuck.
  useEffect(() => {
    setMediaLoaded(false)
    const v = videoRef.current
    if (v && v.readyState >= 2) {
      setMediaLoaded(true)
      return
    }
    const t = setTimeout(() => setMediaLoaded(true), 4000)
    return () => clearTimeout(t)
  }, [url])

  // When mediaLoaded, do NOT keep `animate-pulse` on the element — its
  // @keyframes drives `opacity` directly and overrides the static
  // `opacity-0`, leaving the skeleton visibly pulsing on top of an already
  // playable video. Render the pulse only while loading.
  const skeleton = mediaLoaded ? null : (
    <div className="absolute inset-0 z-10 animate-pulse bg-accent" />
  )

  if (isEmbed) {
    return (
      <div className="relative w-[200px] aspect-[9/16] rounded-xl overflow-hidden bg-gray-95">
        {skeleton}
        <iframe
          src={url}
          className="w-full h-full"
          allow="encrypted-media; fullscreen;"
          allowFullScreen
          onLoad={() => setMediaLoaded(true)}
        />
      </div>
    )
  }

  // Saved thumbnail — show as image
  if (isThumbnail && !isBlob) {
    return (
      <div className="relative w-[200px] aspect-[9/16] rounded-xl overflow-hidden bg-gray-95">
        {skeleton}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="video thumbnail"
          className="w-full h-full object-cover"
          onLoad={() => setMediaLoaded(true)}
          onError={() => setMediaLoaded(true)}
        />
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${mediaLoaded ? "opacity-100" : "opacity-0"}`}>
          <div className="size-12 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm">
            <Play className="size-5 text-white ms-0.5" />
          </div>
        </div>
      </div>
    )
  }

  // Playable video (blob or direct mp4)
  return (
    <div className="relative w-[200px] aspect-[9/16] rounded-xl overflow-hidden bg-gray-95 cursor-pointer" onClick={toggle} onMouseDown={(e) => e.stopPropagation()}>
      {skeleton}
      <video
        ref={videoRef}
        src={url}
        className="w-full h-full object-cover"
        playsInline
        preload="metadata"
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={() => setMediaLoaded(true)}
        onLoadedData={() => setMediaLoaded(true)}
        onCanPlay={() => setMediaLoaded(true)}
        onError={() => setMediaLoaded(true)}
      />
      <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${mediaLoaded ? (playing ? "opacity-0 hover:opacity-100" : "opacity-100") : "opacity-0"}`}>
        <div className="size-12 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm">
          {playing ? <Pause className="size-5 text-white" /> : <Play className="size-5 text-white ms-0.5" />}
        </div>
      </div>
    </div>
  )
}

// Hover-revealed copy button anchored to the top-right (start side in RTL) of
// each format card's textarea. One-click clipboard copy with a 1.5s checkmark
// confirmation, replacing the previous "select-text + cmd+C" flow.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("הועתק ללוח")
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error("[project][copy-to-clipboard]", err)
      toast.error("ההעתקה נכשלה")
    }
  }
  return (
    <TooltipLabel label={copied ? "הועתק" : "העתק"}>
      <button
        type="button"
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="העתק טקסט"
        className="absolute top-2 start-2 z-10 size-7 rounded-md border border-border-neutral-default bg-white dark:bg-gray-10 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-gray-95 dark:hover:bg-gray-20 cursor-pointer"
      >
        {copied ? (
          <Check className="size-3.5 text-button-primary-default" />
        ) : (
          <Copy className="size-3.5 text-text-neutral-default" />
        )}
      </button>
    </TooltipLabel>
  )
}
