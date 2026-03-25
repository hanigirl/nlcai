"use client"

import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader2, Smartphone, Video, Layers, Image, Download, ChevronLeft, ChevronRight, Trash2, type LucideIcon } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { InfiniteCanvas } from "@/components/infinite-canvas"
import { WorkflowCard } from "@/components/workflow-card"
import { SelectionCard } from "@/components/selection-card"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { MediaPanel } from "@/components/media-panel"
import type { Avatar } from "@/components/avatar-picker"
import type { SlideData } from "@/lib/carousel-templates"

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

export default function ProjectPage() {
  const searchParams = useSearchParams()
  const idea = searchParams.get("idea") ?? ""
  const hookParam = searchParams.get("hook") ?? ""
  const postId = searchParams.get("post_id") ?? ""
  const flow: Flow = postId ? "saved" : hookParam ? "hook" : "idea"

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

  // Media panel state
  const [selectedFormatCard, setSelectedFormatCard] = useState<string | null>(null)

  // Talking head state (lifted for panel persistence)
  const [thAvatar, setThAvatar] = useState<Avatar | null>(null)
  const [thAudioBlob, setThAudioBlob] = useState<Blob | null>(null)
  const [thTranscript, setThTranscript] = useState("")
  const [thVideoUrl, setThVideoUrl] = useState<string | null>(null)
  const [thSourceMode, setThSourceMode] = useState<"choose" | "upload" | "avatar">("choose")
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

  // The currently active hook text
  const activeHook = flow === "hook" ? hookParam : (selectedHook !== null ? hooks[selectedHook] : "")

  // Saved flow: load post from DB
  useEffect(() => {
    if (flow !== "saved" || !postId) return
    setSavedPostLoading(true)
    fetch(`/api/core-posts/${postId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.post) {
          setCorePost(data.post.body)
          setOriginalCorePost(data.post.body)
          setResponse(data.post.user_response ?? "")
          setActiveCard("post")

          // Restore format variants
          const fp = data.post.formatPosts as Record<string, string>
          if (fp && Object.keys(fp).length > 0) {
            setFormatPosts(fp)
            setDuplicatedFormats(Object.keys(fp))
            setSelectedFormats(Object.keys(fp))
            setShowFormats(true)
          }

          // Restore video URL
          if (data.post.videoUrl) {
            setThVideoUrl(data.post.videoUrl)
          }
        }
      })
      .catch(() => {})
      .finally(() => setSavedPostLoading(false))
  }, [flow, postId])

  // Auto-save video URL when it changes
  useEffect(() => {
    if (!savedPostId || !thVideoUrl) return
    // Don't save blob URLs (local uploads) - only HeyGen URLs
    if (thVideoUrl.startsWith("blob:")) return
    fetch(`/api/core-posts/${savedPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: thVideoUrl }),
    }).catch(() => {})
  }, [savedPostId, thVideoUrl])

  // Idea flow: auto-generate hooks on load
  useEffect(() => {
    if (flow !== "idea" || !idea) return
    setHooksLoading(true)
    fetch("/api/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, count: 10 }),
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
  }, [flow, idea])

  const handleGeneratePost = async () => {
    if (!activeHook || !response.trim()) return

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
            userResponse: response,
            videoUrl: thVideoUrl && !thVideoUrl.startsWith("blob:") ? thVideoUrl : undefined,
          }),
        })
          .then((res) => res.json())
          .then((saveData) => {
            if (saveData.id) setSavedPostId(saveData.id)
          })
          .catch(() => {})
      }
    } catch {
      setPostError("שגיאה ביצירת הפוסט")
    } finally {
      setPostLoading(false)
    }
  }

  const handleFormatCardClick = (fid: string) => {
    setSelectedFormatCard(selectedFormatCard === fid ? null : fid)
  }

  return (
    <AppShell idea={idea || hookParam || (postId ? "עריכת פוסט" : "")}>
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
              חבר את חשבון Claude שלך כדי ליצור תוכן
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
              {/* Idea card */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[346px]"
              >
                <div className="flex items-center bg-bg-surface px-6 py-3 rounded-t-[20px]">
                  <span className="text-p-bold text-text-primary-default">רעיון</span>
                </div>
                <div className="px-6">
                  <p className="text-small text-text-primary-default">{idea}</p>
                </div>
              </div>

              {/* Connector: Idea → Hooks */}
              <div className="flex items-center mt-[55px]">
                <div className="h-[2px] w-7 bg-gray-80" />
              </div>

              {/* Hook selection card */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px]"
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
                  <div className="px-6">
                    <span className="text-small text-button-destructive-default">{error}</span>
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
                      title="מה תרצה להגיד על זה?"
                      subtitle="מה הניסיון האישי שלך? למה זה שונה ממה שהיה עד עכשיו?"
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

          {/* === Flow: from hook === */}
          {flow === "hook" && (
            <>
              {/* Hook card */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[346px]"
              >
                <div className="flex items-center bg-bg-surface px-6 py-3 rounded-t-[20px]">
                  <span className="text-p-bold text-text-primary-default">הוק</span>
                </div>
                <div className="px-6">
                  <p className="text-small text-text-primary-default">{hookParam}</p>
                </div>
              </div>

              {/* Connector */}
              <div className="flex items-center mt-[55px]">
                <div className="h-[2px] w-7 bg-gray-80" />
              </div>

              {/* Workflow card */}
              <div className="flex flex-col items-start">
                <WorkflowCard
                  title="מה תרצה להגיד על זה?"
                  subtitle="מה הניסיון האישי שלך? למה זה שונה ממה שהיה עד עכשיו?"
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
                <div className="flex items-center mt-[55px]">
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
                <div className="relative flex flex-col items-center w-[567px]">
                  {/* Core post card */}
                  <div
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px]"
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
                        className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px]"
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
                                  } catch {
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
                          thVideoCardRef={thVideoCardRef}
                          onThReRecord={() => {
                            setThAudioBlob(null)
                            setThTranscript("")
                            setSelectedFormatCard("talking_head")
                          }}
                          onThDelete={() => {
                            setThVideoUrl(null)
                            setThAudioBlob(null)
                            setThTranscript("")
                            // Delete from DB
                            if (savedPostId) {
                              fetch(`/api/core-posts/${savedPostId}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ deleteVideo: true }),
                              }).catch(() => {})
                            }
                          }}
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
  thVideoCardRef,
  onThReRecord,
  onThDelete,
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
  thVideoCardRef: React.RefObject<HTMLDivElement | null>
  onThReRecord: () => void
  onThDelete: () => void
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
                  <Textarea
                    value={formatPosts[fid] ?? ""}
                    onFocus={() => onActiveChange(`format-${fid}`)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPostChange(fid, e.target.value)}
                    className="min-h-[200px] rounded-[10px] border-border-neutral-default bg-white dark:bg-gray-10 resize-none shadow-none text-small leading-relaxed select-text"
                  />
                  <Button
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectFormat(fid)
                    }}
                    className="w-full rounded-[10px] border-border-neutral-default text-text-primary-default text-small gap-2"
                  >
                    <Icon className="size-4" />
                    ערוך מדיה ל{format.label}
                  </Button>
                </div>
              </div>

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
                      <span className="text-p-bold text-text-primary-default">הוידאו שלך</span>
                      <Video className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      {/* Video + Cover side by side */}
                      <div className="flex gap-4 justify-center">
                        {/* Video */}
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-xs text-text-neutral-default">וידאו</span>
                          <div className="relative w-[160px] aspect-[9/16] rounded-xl overflow-hidden bg-gray-95">
                            <video
                              src={thVideoUrl}
                              controls
                              className="w-full h-full object-cover"
                              onMouseDown={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        {/* Cover */}
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-xs text-text-neutral-default">קאבר</span>
                          <div className="relative w-[160px] aspect-[9/16] rounded-xl overflow-hidden bg-gray-10">
                            {/* Placeholder cover with hook text */}
                            <div className="absolute inset-0 flex flex-col justify-end p-4 bg-gradient-to-t from-black/60 to-black/20">
                              <p className="text-white text-sm font-bold leading-tight text-right" dir="rtl">
                                {hookText || "הוק לדוגמה"}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 w-full items-center">
                        <Button asChild className="flex-1">
                          <a href={thVideoUrl} download="video.mp4">
                            הורד וידאו
                          </a>
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={onThReRecord}>
                          הקלט מחדש
                        </Button>
                        <button
                          onClick={onThDelete}
                          className="flex items-center justify-center size-9 shrink-0 rounded-lg hover:bg-red-95 transition-colors cursor-pointer"
                          title="מחק וידאו"
                        >
                          <Trash2 className="size-4 text-button-destructive-default" />
                        </button>
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
    } catch {
      // silent fail
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
          <span className="text-p-bold text-text-primary-default">הקרוסלה שלך</span>
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
