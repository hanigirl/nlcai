"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, Smartphone, Video, Layers, Image, Film, Download, ChevronLeft, ChevronRight, Trash2, Play, Pause, Sparkles, Copy, Check, RotateCw, Info, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/app-shell"
import { GeminiConnectNoticeCard, useGeminiNoticeVisible } from "@/components/gemini-connect-notice"
import { InfiniteCanvas } from "@/components/infinite-canvas"
import { WorkflowCard } from "@/components/workflow-card"
import { SelectionCard } from "@/components/selection-card"
import { Textarea } from "@/components/ui/textarea"
import { RichBodyEditor } from "@/components/rich-body-editor"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipLabel } from "@/components/ui/tooltip"
import { MediaPanel } from "@/components/media-panel"
import { ConfirmModal } from "@/components/confirm-modal"
import { CorePostCelebration } from "@/components/core-post-celebration"
import { ScheduleInCalendarBar } from "@/components/schedule-in-calendar-bar"
import { CorePostChat } from "@/components/core-post-chat"
import { AiRefineButton } from "@/components/ai-refine-button"
import { StoryPlayer, storyFrameSrc } from "@/components/story-player"
import { ColorSwatchPicker } from "@/components/color-swatch-picker"
import type { Avatar } from "@/components/avatar-picker"
import type { SlideData } from "@/lib/carousel-templates"
import { createClient } from "@/lib/supabase/client"
import { DriveVideoPreview } from "@/components/drive-video-preview"
import {
  isDriveUrl,
  extractDriveFileId,
  driveThumbnailUrl,
} from "@/lib/drive-media"
import { copyToClipboard } from "@/lib/copy-to-clipboard"
import { userKey } from "@/lib/user-scoped-storage"
import { logLearningEdit } from "@/lib/learning-capture"
import { BROLL_SCRIPT_CTA } from "@/lib/broll-copy"

type Flow = "idea" | "hook" | "saved"

const FORMATS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "story", label: "סטורי", icon: Smartphone },
  { id: "talking_head", label: "דיבור למצלמה", icon: Video },
  { id: "carousel", label: "קרוסלה", icon: Layers },
  { id: "image_post", label: "פוסט תמונה", icon: Image },
  { id: "b_roll", label: "בי-רול", icon: Film },
]

/**
 * Formats that duplicate without calling a generation agent.
 *
 * The other four each have an `/api/format/<id>` route that rewrites the core
 * post into that format's voice. בי-רול has nothing to rewrite: the footage is
 * the user's own, and the only text on screen is the hook the core post already
 * carries. Sending it through an LLM would spend a model call to paraphrase a
 * line we already have — and worse, drift it away from the hook the rest of the
 * post is built on. So `שכפל!` creates the variant locally with the hook as its
 * body, and the panel then waits for a Drive link.
 */
const FORMATS_WITHOUT_GENERATION = new Set(["b_roll"])

const FORMAT_MAP = Object.fromEntries(FORMATS.map((f) => [f.id, f]))

/**
 * Sentinel parked in `formatPosts[fid]` while that format's agent is in
 * flight. Two things depend on the exact string:
 *   - PATCH /api/core-posts/{id} skips it, so a placeholder is never
 *     persisted as a real variant body.
 *   - `hasFormatText` treats it as "no text yet", so a format still
 *     generating counts as missing and won't block a re-run.
 */
const FORMAT_GENERATING = "מייצר..."

/**
 * Does this format already hold a real (non-placeholder) script? This is the
 * predicate the duplication flow is built on: "שכפל!" only generates formats
 * for which this is false, so ticking a fifth format never rewrites the four
 * the user has already edited.
 */
function hasFormatText(
  formatPosts: Record<string, string>,
  fid: string,
): boolean {
  const text = formatPosts[fid]
  return !!text && text !== FORMAT_GENERATING && text.trim().length > 0
}

/**
 * Change-detection snapshot for a carousel slide set, so the autosave can tell
 * "this is the same carousel I already persisted" from "this changed" without
 * deep-comparing full base64 payloads.
 *
 * Every slide contributes, not just the first. It used to be `length|first 32
 * chars of slide 1`, which is blind to a reorder: dragging slides 2 and 3 past
 * each other left both the count and slide 1 untouched, so the new order was
 * never saved and came back wrong on reload.
 */
function carouselSignature(images: string[] | null): string {
  if (!images || images.length === 0) return ""
  return `${images.length}|${images.map((img) => img.slice(0, 16)).join("|")}`
}

/**
 * PATCH a core post and TELL THE USER when it fails.
 *
 * Every autosave on this page used to end in `.catch(() => {})`. A rejected
 * save — expired session, offline laptop, a 500 from the media writer — looked
 * exactly like a successful one: the media sat on the canvas, nothing was
 * persisted, and the loss only surfaced on the next reload. Media saves are the
 * expensive ones to lose (a generated cover, a burned story clip, ten carousel
 * slides), so they now surface a toast.
 *
 * `id` on the toast dedupes: a flapping connection retries on every dependency
 * change and would otherwise stack a tower of identical errors.
 */
async function savePatch(
  postId: string,
  body: Record<string, unknown>,
  label: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/core-posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error || `status ${res.status}`)
    }
    return true
  } catch (err) {
    console.error(`[project][save:${label}]`, err)
    toast.error(`שמירת ${label} נכשלה`, { id: `save-fail-${label}` })
    return false
  }
}

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
  // Parallel array of DB ids for the generated hooks above. Indexed by
  // position — hookIds[i] is the id of hooks[i]. Empty string when an insert
  // failed; the core-post route then falls back to matching on text.
  const [hookIds, setHookIds] = useState<string[]>([])
  const [selectedHook, setSelectedHook] = useState<number | null>(null)
  const [hooksLoading, setHooksLoading] = useState(false)
  const [error, setError] = useState("")
  // Which provider is still unconnected — hooks run on Gemini, the core post
  // still runs on Claude, so the banner has to name the one that's actually
  // missing instead of always saying "Claude".
  const [apiNotConnected, setApiNotConnected] = useState<"Claude" | "Gemini" | null>(null)
  // Read at page level, not inside the notice, so the canvas can reserve room
  // for the pinned card instead of letting it land on the first flow card.
  const geminiNoticeVisible = useGeminiNoticeVisible()
  const [response, setResponse] = useState("")
  const [corePost, setCorePost] = useState("")
  const [postLoading, setPostLoading] = useState(false)
  const [postError, setPostError] = useState("")
  const [celebrationKey, setCelebrationKey] = useState(0)
  const [bodySaveStatus, setBodySaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [showFormats, setShowFormats] = useState(false)
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [duplicatedFormats, setDuplicatedFormats] = useState<string[]>([])
  // "Keep chatting with the AI about the post" floating panel. Only usable
  // BEFORE the post is duplicated to formats — once format variants exist the
  // core post is frozen (editing it wouldn't propagate to the duplicates), so
  // the trigger is disabled and the panel force-closed.
  const [chatOpen, setChatOpen] = useState(false)
  // True while the chat's AI is generating a revision — drives the shimmer
  // animation on the core post card so the user sees it's working.
  const [chatBusy, setChatBusy] = useState(false)
  const [formatPosts, setFormatPosts] = useState<Record<string, string>>({})
  const [activeCard, setActiveCard] = useState<string>(flow === "hook" ? "response" : "hooks")
  const [editableHook, setEditableHook] = useState<string>(hookParam || "")

  // Product + trigger-word controls (per-session; persisted via canvas state).
  // The product dropdown shows ALL of the user's products. If the active hook
  // already has a product_ids[0] assigned by the classifier, we auto-select it.
  // The trigger word is optional — when set, it appears in the core-post CTA.
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [hookProductIds, setHookProductIds] = useState<Record<string, string[]>>({})
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [triggerWord, setTriggerWord] = useState<string>("")
  // Tracks whether the user has manually picked a product this session. Once
  // they have, we stop auto-overwriting it from the active hook's product_ids.
  const productManuallySetRef = useRef(false)

  // Media panel state
  const [selectedFormatCard, setSelectedFormatCard] = useState<string | null>(null)

  // Talking head state (lifted for panel persistence)
  const [thAvatar, setThAvatar] = useState<Avatar | null>(null)
  const [thAudioBlob, setThAudioBlob] = useState<Blob | null>(null)
  const [thVideoUrl, setThVideoUrl] = useState<string | null>(null)
  const [thSourceMode, setThSourceMode] = useState<"choose" | "upload" | "avatar">("choose")
  const [thCoverImage, setThCoverImage] = useState<string | null>(null)
  const [thCoverLoading, setThCoverLoading] = useState(false)
  // Cover pill colour, picked from the colour wheel next to the cover
  // preview in FormatTree. Defaults to black to match the existing
  // baseline. generateCoverForPost reads it (or an explicit override
  // when the user just picked a new colour, so the state-update race
  // doesn't bite).
  const [pillColor, setPillColor] = useState("#000000")
  // Live colour the picker is currently dragging towards. `null` = picker
  // closed → fall back to the baked PNG (`thCoverImage`). While dragging
  // we show a CSS pill overlay so colour changes feel instant; the PNG
  // is only regenerated once on commit.
  const [livePillColor, setLivePillColor] = useState<string | null>(null)
  // Confirmation modal — opened from the trash icon on the video card. The
  // actual delete only fires after the user clicks "כן, למחוק". The cover has
  // no standalone delete action; it lives and dies with the video.
  const [pendingVideoDelete, setPendingVideoDelete] = useState(false)
  // Format id whose script the user asked to regenerate, awaiting confirmation.
  // Regeneration overwrites text they may have hand-edited, so the card's
  // button only arms this — the actual agent call happens on confirm.
  const [pendingFormatRegen, setPendingFormatRegen] = useState<string | null>(null)
  // Video-card skeleton state. The DB load + heygen-embed conversion can take
  // a couple of seconds; without this the talking_head card just doesn't
  // render at all during that gap and the page looks like it has no video.
  const [thVideoLoading, setThVideoLoading] = useState(!!postId)
  const [coverText, setCoverText] = useState("")
  const [thVideoFrameDataUrl, setThVideoFrameDataUrl] = useState<string | null>(null)
  const thVideoCardRef = useRef<HTMLDivElement>(null)
  // Anchor for the post-generation visual feedback. We point it at the
  // first card that mounts when handleGeneratePost runs (either the
  // "כותב את הפוסט..." loading chip or the core post card itself) and
  // smooth-scroll to it so the user can see Claude is working — otherwise
  // the click stays at the bottom of the canvas and reads as "nothing
  // happened".
  const corePostResultRef = useRef<HTMLDivElement>(null)

  // Carousel state (lifted for panel persistence)
  const [carouselImages, setCarouselImages] = useState<string[] | null>(null)
  const [carouselSlides, setCarouselSlides] = useState<SlideData[] | null>(null)
  // Per-slide Drive links behind an imported carousel, in slide order. Lives
  // on the post (migration 027), not in this browser — so the list follows the
  // post to any device, the way the slides themselves already did.
  const [carouselDriveLinks, setCarouselDriveLinks] = useState<string[] | null>(null)
  // Same idea for the story frame set — it imports from Drive with the exact
  // same per-frame link mechanic the carousel uses.
  const [storyDriveLinks, setStoryDriveLinks] = useState<string[] | null>(null)
  const [bRollDriveLinks, setBRollDriveLinks] = useState<string[] | null>(null)
  // Per-format media URLs from the post load. Handed to MediaPanel so a panel
  // can paint its existing media immediately instead of blocking on its own
  // copy of a fetch this page already made.
  const [formatMedia, setFormatMedia] = useState<Record<string, string>>({})
  // The b-roll's finished clip, mirrored from the panel so it renders as its
  // own workflow card under the b-roll script.
  const [bRollUrl, setBRollUrl] = useState<string | null>(null)
  // Set ONLY after the post GET has actually resolved. `savedPostLoading`
  // can't stand in for this: it starts false whenever the URL carries no
  // post_id, which reads as "loaded" for a post that was never fetched — and
  // that told the media panel to skip its own fetch and render nothing.
  const [postFetched, setPostFetched] = useState(false)
  const carouselCardRef = useRef<HTMLDivElement>(null)

  // Image-post state (lifted so the approved image renders as its own
  // workflow card below the image_post format card — same pattern as the
  // talking_head video/cover cards). Holds the persisted storage URL; set
  // on DB hydration and again when the panel reports a fresh save.
  const [imagePostUrl, setImagePostUrl] = useState<string | null>(null)
  const imagePostCardRef = useRef<HTMLDivElement>(null)

  // Story state — the saved AI frame set (1-3 frames) lifted so it renders
  // as its own workflow card below the story format card, same pattern as
  // image_post/carousel. Frames are storage URLs on hydration, or base64
  // right after a panel save (both handled by the card's src helper).
  const [storyImages, setStoryImages] = useState<string[] | null>(null)
  const storyCardRef = useRef<HTMLDivElement>(null)
  // Story VIDEO counterpart — the user's clip with the hook burned in, lifted
  // from the panel so it renders as its own workflow card like the frame set.
  const [storyVideoUrl, setStoryVideoUrl] = useState<string | null>(null)
  const storyVideoCardRef = useRef<HTMLDivElement>(null)
  const bRollCardRef = useRef<HTMLDivElement>(null)

  // Learning log — store originals to detect edits
  const [originalHooks, setOriginalHooks] = useState<string[]>([])
  const [originalCorePost, setOriginalCorePost] = useState("")
  /**
   * The last AI-authored version of the post — the baseline a manual edit is
   * measured against.
   *
   * Deliberately NOT `originalCorePost`: the body autosave rewrites that to the
   * current text every 800ms, so by the time the user reached the formats step
   * the two were equal and the edit was almost never logged. This ref is only
   * written when the AI produces text (generate, load, chat revision).
   */
  const aiCorePostRef = useRef("")
  /** Baseline already logged, so one AI version yields at most one insight. */
  const loggedBaselineRef = useRef("")

  // Saved post tracking
  const [savedPostId, setSavedPostId] = useState<string | null>(postId || null)
  const [savedPostLoading, setSavedPostLoading] = useState(!!postId)
  const [savedHookText, setSavedHookText] = useState("")
  // Save lifecycle for the auto-POST that persists a freshly-generated core
  // post. Previously this was fire-and-forget with `.catch(() => {})` which
  // silently swallowed failures — the user would walk away thinking they had
  // a saved post when there was actually no DB row. We surface the failure
  // and let them retry without having to regenerate the AI text.
  const [savingPost, setSavingPost] = useState(false)
  const [saveError, setSaveError] = useState<string>("")
  // Cached payload for the retry button — we don't want to recompute the
  // hook/userResponse pairing from state because by the time the user clicks
  // retry, those fields may have moved on.
  const [pendingSavePayload, setPendingSavePayload] = useState<{
    body: string
    hookText: string
    hookId?: string
    userResponse: string
    videoUrl?: string
  } | null>(null)

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
  /**
   * The post id whose MEDIA this page has already hydrated from the server.
   * Guards the saved-flow load effect so it runs exactly once per post, which is
   * what lets media hydration stop depending on the `corePost` emptiness check
   * (that check exists to protect TEXT state, and it was silently suppressing
   * media hydration too). Also distinguishes a first load from a post switch.
   */
  const hydratedForPostRef = useRef<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null)
    })
  }, [])

  // Load the user's products once. Used to populate the product dropdown on
  // the core-post WorkflowCard.
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    supabase
      .from("products")
      .select("id, name")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error("[project][products-load]", error)
          return
        }
        if (data) setProducts(data as Array<{ id: string; name: string }>)
      })
  }, [userId])

  // Fetch product_ids for any hook we currently need (hook-flow via hookIdParam,
  // saved-flow via the core_post's hook_id, idea-flow via hookIds[selectedHook]).
  // Cached in hookProductIds so re-selecting doesn't re-fetch.
  useEffect(() => {
    if (!userId) return
    const targetHookId =
      hookIdParam ||
      (selectedHook !== null && hookIds[selectedHook] ? hookIds[selectedHook] : "")
    if (!targetHookId) return
    if (hookProductIds[targetHookId]) return
    const supabase = createClient()
    supabase
      .from("hooks")
      .select("product_ids")
      .eq("id", targetHookId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("[project][hook-products-load]", error)
          return
        }
        const row = data as { product_ids: string[] | null } | null
        const ids = row?.product_ids ?? []
        setHookProductIds((prev) => ({ ...prev, [targetHookId]: ids }))
      })
  }, [userId, hookIdParam, selectedHook, hookIds, hookProductIds])

  // Auto-select the hook's first product (if any) until the user makes a
  // manual choice. After a manual change, productManuallySetRef stays true and
  // we leave selectedProductId alone.
  useEffect(() => {
    if (productManuallySetRef.current) return
    const targetHookId =
      hookIdParam ||
      (selectedHook !== null && hookIds[selectedHook] ? hookIds[selectedHook] : "")
    if (!targetHookId) return
    const ids = hookProductIds[targetHookId]
    if (!ids) return // still loading
    setSelectedProductId(ids[0] ?? null)
  }, [hookIdParam, selectedHook, hookIds, hookProductIds])

  // Hook flow: reconcile editableHook against the DB (source of truth).
  //
  // The ?hook= URL param is a render-time snapshot taken in /hooks when the
  // "create post" arrow is clicked — it's built from hook_text captured in the
  // render closure, while the inline edit commits to that list state only
  // *after* an awaited DB write. So a user who edits a hook and then opens it
  // on the canvas can ship a pre-edit value in ?hook=, and the canvas (which
  // otherwise only uses hook_id to look up product_ids) would show the stale
  // hook forever. ?hook= is treated as a cache; the hooks row pointed to by
  // ?hook_id= is authoritative. Runs once on entry — before the user can type
  // into the canvas hook field — so it never clobbers an in-canvas edit.
  const reconciledHookTextRef = useRef(false)
  useEffect(() => {
    if (flow !== "hook") return
    if (!userId || !hookIdParam) return
    if (reconciledHookTextRef.current) return
    reconciledHookTextRef.current = true
    const supabase = createClient()
    supabase
      .from("hooks")
      .select("hook_text")
      .eq("id", hookIdParam)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("[project][hook-text-reconcile]", error)
          return
        }
        const fresh = (data as { hook_text: string | null } | null)?.hook_text?.trim()
        // Resolves after the synchronous canvas-restore setEditableHook, so the
        // DB value wins over any stale localStorage snapshot too.
        if (fresh) setEditableHook(fresh)
      })
  }, [flow, userId, hookIdParam])

  useEffect(() => {
    if (restoredRef.current) return
    if (!userId) return
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(userKey(CANVAS_KEY, userId))
      if (!raw) return
      const saved = JSON.parse(raw)
      // Match by exact sessionKey OR by draft id. The second match handles
      // the user navigating back to /project?post_id=<draftId> after
      // viewing /core_posts — the URL has dropped the original ?idea=
      // param so sessionKey no longer matches, but it's still the same
      // in-progress draft and we want to restore its hook list + selection
      // so the user keeps the full idea-flow layout instead of falling
      // into the single-hook "saved" rendering.
      const matchesSession = saved?.sessionKey === sessionKey
      const matchesDraft = !!postId && saved?.savedPostId === postId
      if (!matchesSession && !matchesDraft) return
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
      if (Array.isArray(saved.hookIds)) setHookIds(saved.hookIds)
      if (saved.selectedHook === null || typeof saved.selectedHook === "number") setSelectedHook(saved.selectedHook)
      if (typeof saved.response === "string") setResponse(saved.response)
      if (typeof saved.corePost === "string") setCorePost(saved.corePost)
      if (typeof saved.showFormats === "boolean") setShowFormats(saved.showFormats)
      if (Array.isArray(saved.selectedFormats)) setSelectedFormats(saved.selectedFormats)
      if (Array.isArray(saved.duplicatedFormats)) setDuplicatedFormats(saved.duplicatedFormats)
      if (saved.formatPosts && typeof saved.formatPosts === "object") setFormatPosts(saved.formatPosts)
      if (typeof saved.editableHook === "string") setEditableHook(saved.editableHook)
      if (typeof saved.coverText === "string") setCoverText(saved.coverText)
      if (saved.thSourceMode === "choose" || saved.thSourceMode === "upload" || saved.thSourceMode === "avatar") setThSourceMode(saved.thSourceMode)
      if (typeof saved.savedHookText === "string") setSavedHookText(saved.savedHookText)
      if (Array.isArray(saved.originalHooks)) setOriginalHooks(saved.originalHooks)
      if (typeof saved.originalCorePost === "string") setOriginalCorePost(saved.originalCorePost)
      // Refs don't survive a reload, so without this the AI baseline is lost
      // and an edit made after refreshing the page teaches us nothing.
      if (typeof saved.aiCorePost === "string") aiCorePostRef.current = saved.aiCorePost
      if (typeof saved.loggedBaseline === "string") loggedBaselineRef.current = saved.loggedBaseline
      if (typeof saved.selectedProductId === "string" || saved.selectedProductId === null) {
        setSelectedProductId(saved.selectedProductId ?? null)
        // A restored product counts as a manual choice — don't overwrite it
        // from the hook's classifier suggestion.
        if (saved.selectedProductId !== undefined) productManuallySetRef.current = true
      }
      if (typeof saved.triggerWord === "string") setTriggerWord(saved.triggerWord)
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
          idea, hooks, hookIds, selectedHook, response, corePost,
          showFormats, selectedFormats, duplicatedFormats, formatPosts,
          editableHook, coverText, thSourceMode,
          savedHookText, originalHooks, originalCorePost,
          selectedProductId, triggerWord,
          // Learning-capture baselines (see aiCorePostRef) — read from refs so
          // they're whatever the latest AI output was at save time.
          aiCorePost: aiCorePostRef.current,
          loggedBaseline: loggedBaselineRef.current,
          // Persist the auto-saved post id so a refresh on a tab whose URL
          // hasn't been synced yet (e.g. opened before the URL-sync was wired
          // up) can still recover the saved post via the restore effect above.
          savedPostId,
        }
        localStorage.setItem(userKey(CANVAS_KEY, userId), JSON.stringify(state))
      } catch (err) { console.error("[project][canvas-save]", err) }
    }, 300)
    return () => clearTimeout(t)
  }, [sessionKey, idea, hooks, hookIds, selectedHook, response, corePost, showFormats, selectedFormats, duplicatedFormats, formatPosts, editableHook, coverText, thSourceMode, savedHookText, originalHooks, originalCorePost, selectedProductId, triggerWord, savedPostId, userId])

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

  // Generate cover with optional video frame as thumbnail. colorOverride
  // sidesteps the state-update race when the user picks a new pill colour
  // and we kick off a regenerate before pillColor has flushed through
  // the next render.
  const generateCoverForPost = async (hookText: string, videoSrc?: string, colorOverride?: string) => {
    setThCoverLoading(true)
    let thumbnailUrl: string | undefined

    // Reuse saved frame data URL if available
    if (thVideoFrameDataUrl) {
      thumbnailUrl = thVideoFrameDataUrl
    } else if (isDriveUrl(videoSrc)) {
      // Link-mode video: the clip lives in Drive, so a canvas frame-grab
      // would taint (no CORS) and `extractVideoFrame` would just burn its
      // 5s timeout and return null. Drive renders its own poster
      // server-side, and the cover route fetches remote URLs, so hand it
      // that instead of a data URL.
      const fileId = extractDriveFileId(videoSrc!)
      if (fileId) thumbnailUrl = driveThumbnailUrl(fileId)
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
        body: JSON.stringify({
          title: hookText,
          thumbnail_url: thumbnailUrl,
          pill_color: colorOverride ?? pillColor,
        }),
      })
      const d = await res.json()
      if (d.covers?.[0]) setThCoverImage(d.covers[0])
    } catch (err) { console.error("[project][th-cover-generate]", err) }
    finally { setThCoverLoading(false) }
  }

  // The currently active hook text.
  //
  // Selection precedence (Hani 2026-05-14): if the user picked a hook from
  // the in-page list (`selectedHook` is a valid index and the row has text),
  // THAT is the active hook — no matter which flow the page entered via.
  // Otherwise fall back to the flow-specific source:
  //   - `hook` flow  → `editableHook` (came in from /hooks with a single hook)
  //   - `saved` flow → `savedHookText` (the hook persisted on the post row)
  //   - `idea` flow  → empty until the user picks a generated hook
  //
  // The previous version pinned saved-flow to `savedHookText` unconditionally,
  // so re-picking a hook on a saved post regenerated against the OLD hook.
  const activeHook = (selectedHook !== null && hooks[selectedHook])
    ? hooks[selectedHook]
    : flow === "hook"
      ? editableHook
      : flow === "saved"
        ? savedHookText
        : ""

  // Sync cover text with active hook (only set if empty)
  useEffect(() => {
    if (activeHook && !coverText) setCoverText(activeHook)
  }, [activeHook, coverText])

  // Saved flow: load post from DB.
  //
  // This used to bail entirely on `if (corePost) return`. The guard's purpose is
  // real — when we transition from an in-session generate, `corePost` is already
  // populated and re-applying the server copy would flip savedPostLoading (which
  // unmounts the hook + workflow cards) and race unsaved local edits to
  // `response`. But bailing skipped the MEDIA hydration too, so any path that
  // arrived here with post text already in state opened the post with its video,
  // cover, story frames, carousel slides and image all missing. The two concerns
  // are now separated:
  //
  //   - TEXT state is still only restored when the page doesn't already have it.
  //   - MEDIA always hydrates, exactly once per post id (`hydratedForPostRef`).
  //
  // The ref also makes the effect safe to re-run when `flow` flips mid-session,
  // which it does via history.replaceState.
  useEffect(() => {
    if (flow !== "saved" || !postId) return
    if (hydratedForPostRef.current === postId) return

    // A DIFFERENT post was hydrated before this one — i.e. the page switched
    // posts without unmounting. Only then do we clear media the server doesn't
    // report, because only then can there be another post's media on screen. On
    // a first hydration there is nothing stale to clear, and clearing would risk
    // wiping media attached in-session before the fetch resolved.
    const isPostSwitch =
      hydratedForPostRef.current !== null && hydratedForPostRef.current !== postId
    hydratedForPostRef.current = postId

    // Whether to take over the text state. Captured now, not inside .then().
    // A genuine post switch always restores — otherwise post B would render
    // post A's body.
    const restoreText = !corePost || isPostSwitch

    if (restoreText) setSavedPostLoading(true)
    fetch(`/api/core-posts/${postId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.post) {
          if (restoreText) {
          setCorePost(data.post.body)
          setOriginalCorePost(data.post.body)
          aiCorePostRef.current = data.post.body ?? ""
          setResponse(data.post.user_response ?? "")
          // Restore the originating idea so the breadcrumb / shell title and
          // any future regenerate flows have it. We only set when the URL
          // didn't already carry an `?idea=...` — keeps an in-progress session
          // that just navigated to ?post_id from clobbering its own state.
          if (typeof data.post.idea_text === "string" && data.post.idea_text && !idea) {
            setIdea(data.post.idea_text)
          }
          if (data.post.hook_text) {
            setSavedHookText(data.post.hook_text as string)
            // Hydrate editableHook so the saved flow can reuse the same hook
            // card + workflow card rendering as the live "from hook" flow —
            // otherwise both controls vanish on refresh / re-entry.
            setEditableHook(data.post.hook_text as string)
            setCoverText((data.post.cover_text as string) || (data.post.hook_text as string))
          }
          // Restore the product + trigger-word the user picked when they
          // created/edited this draft. Mark productManuallySetRef so the
          // auto-assign-from-hook-classifier effect doesn't overwrite the
          // restored selection.
          if (data.post.product_id) {
            setSelectedProductId(data.post.product_id as string)
            productManuallySetRef.current = true
          }
          if (typeof data.post.trigger_word === "string") {
            setTriggerWord(data.post.trigger_word as string)
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
          } // end restoreText — everything below is MEDIA and always runs

          // Restore the pill colour the cover was baked with so the picker
          // opens already aligned with what's on screen. Falls through to
          // the localStorage hydrator below if the server didn't store one
          // (older covers, pre-metadata).
          if (typeof data.post.coverPillColor === "string") {
            setPillColor(data.post.coverPillColor as string)
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
          } else if (isPostSwitch) {
            setThCoverImage(null)
            setThCoverLoading(false)
          }

          // Restore saved image_post media so its workflow card shows on
          // load. formatMedia is the per-format URL map the detail
          // endpoint already returns; image_post's entry is the persisted
          // image (AI-generated or manually uploaded).
          const fm = data.post.formatMedia as Record<string, string> | undefined
          if (fm?.image_post) setImagePostUrl(fm.image_post)
          else if (isPostSwitch) setImagePostUrl(null)

          // Restore the saved story frame set so its workflow card shows on
          // load. Unlike carousel, we keep them as storage URLs (the card +
          // panel handle both URL and base64), so no fetch/decode is needed.
          if (
            Array.isArray(data.post.storyImageUrls) &&
            data.post.storyImageUrls.length > 0
          ) {
            setStoryImages(data.post.storyImageUrls as string[])
          } else if (isPostSwitch) {
            setStoryImages(null)
          }
          // A finished story VIDEO (hook burned in) is stored under a
          // "burned-" filename — surface it as the story workflow card too.
          if (fm?.story && /\/video\/burned-[^/]+\.mp4/.test(fm.story)) {
            setStoryVideoUrl(fm.story)
          } else if (isPostSwitch) {
            setStoryVideoUrl(null)
          }

          // Restore saved carousel slides. They're stored as public URLs,
          // but MediaPanel renders base64 (`data:image/png;base64,...`), so
          // fetch + decode each one — mirrors the cover restore above. We
          // match prevCarouselSigRef to the restored set first so the
          // carousel autosave effect treats these as already-persisted and
          // doesn't re-upload them on hydration.
          if (
            Array.isArray(data.post.carouselImageUrls) &&
            data.post.carouselImageUrls.length > 0
          ) {
            const urls = data.post.carouselImageUrls as string[]
            // Show the card immediately from the URLs. The base64 decode
            // below still runs — the media panel needs base64 to re-save a
            // set — but the canvas no longer waits for it, and a failed
            // decode can no longer hide the carousel entirely.
            prevCarouselSigRef.current = carouselSignature(urls)
            setCarouselImages(urls)
            Promise.all(
              urls.map((u) =>
                fetch(u)
                  .then((r) => r.blob())
                  .then(
                    (blob) =>
                      new Promise<string>((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onload = () => {
                          const b64 = (reader.result as string).split(",")[1]
                          if (b64) resolve(b64)
                          else reject(new Error("empty carousel slide"))
                        }
                        reader.onerror = () => reject(new Error("carousel read failed"))
                        reader.readAsDataURL(blob)
                      }),
                  ),
              ),
            )
              .then((b64s) => {
                prevCarouselSigRef.current = carouselSignature(b64s)
                setCarouselImages(b64s)
              })
              .catch((err) => {
                // One failed slide fetch used to drop the WHOLE carousel from
                // state without a word, which reads as "my slides disappeared".
                console.error("[project][carousel-hydrate]", err)
                toast.error("חלק מהשקופיות לא נטענו. רעננו את הדף.")
              })
          } else if (isPostSwitch) {
            setCarouselImages(null)
            // Keep the autosave signature aligned with the cleared state,
            // otherwise the carousel effect treats the next real set as a
            // no-op and never persists it.
            prevCarouselSigRef.current = ""
          }

          // The Drive links the carousel was imported from. Restored straight
          // from the post — no decoding needed, unlike the slides above.
          if (Array.isArray(data.post.carouselDriveLinks)) {
            setCarouselDriveLinks(data.post.carouselDriveLinks as string[])
          }
          if (Array.isArray(data.post.storyDriveLinks)) {
            setStoryDriveLinks(data.post.storyDriveLinks as string[])
          }
          if (Array.isArray(data.post.bRollDriveLinks)) {
            setBRollDriveLinks(data.post.bRollDriveLinks as string[])
          }
          if (data.post.formatMedia && typeof data.post.formatMedia === "object") {
            const media = data.post.formatMedia as Record<string, string>
            setFormatMedia(media)
            if (media.b_roll) setBRollUrl(media.b_roll)
          }
          setPostFetched(true)

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
            // ...and drop the previous post's video, which the skeleton clear
            // alone never did.
            if (isPostSwitch) setThVideoUrl(null)
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

  // Fetch every hook the user has previously generated for the current idea,
  // straight from the DB. The full list shows up on the idea-flow stack —
  // this is what guarantees the user always sees ALL their hooks for an
  // idea, regardless of how they got to /project (fresh idea, draft view via
  // /core_posts card click with no ?idea= param, different browser, cleared
  // localStorage). The DB is the source of truth; canvas restore from
  // localStorage is now just a fast-path for in-session continuation.
  //
  // Anchored on `idea` state (URL ?idea= populates it on mount; saved-flow
  // load populates it from data.post.idea_text after the fetch returns). A
  // per-idea ref prevents the fetch from re-firing when the user starts
  // editing the idea textarea — we only ever fetch the first time an idea
  // value appears.
  const fetchedHooksForIdeaRef = useRef<string | null>(null)
  useEffect(() => {
    if (!userId) return
    const anchorIdea = (idea || "").trim()
    if (!anchorIdea) return
    if (fetchedHooksForIdeaRef.current === anchorIdea) return
    fetchedHooksForIdeaRef.current = anchorIdea

    const supabase = createClient()
    supabase
      .from("hooks")
      .select("id, hook_text")
      .eq("user_id", userId)
      .eq("idea_text", anchorIdea)
      // Sort by display_order ASC so the user sees the same order they
      // picked from originally — the position they remember picking should
      // still be the position they see highlighted. created_at-DESC inverted
      // it, which is why "the wrong hook looks selected" was the report.
      .order("display_order", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error("[project][fetch-hooks-by-idea]", error)
          return
        }
        if (!data || data.length === 0) return
        const fetched = data as unknown as { id: string; hook_text: string }[]
        const texts = fetched.map((h) => h.hook_text)
        const ids = fetched.map((h) => h.id)
        setHooks(texts)
        setHookIds(ids)
        setOriginalHooks(texts)
      })
  }, [idea, userId])

  // Derive the selected-hook index from the saved post's hook_text whenever
  // the hooks list or savedHookText changes. Split out from the fetch above
  // so the matching catches up when each piece arrives (saved-flow load and
  // hooks-by-idea fetch race; either can land first).
  //
  // Re-runs on hooks/savedHookText changes — NOT on selectedHook changes —
  // so the DB-derived selection overrides any stale index that canvas
  // restore wrote from the previous hook ordering (localStorage stored
  // selectedHook=2 from the old sort, the DB fetch then re-sorts by
  // created_at desc, position 2 now holds a different hook). Excluding
  // selectedHook from the deps also means a manual click won't trigger a
  // re-derive — the user's pick wins.
  useEffect(() => {
    if (!savedHookText) return
    if (hooks.length === 0) return
    const idx = hooks.findIndex((h) => h === savedHookText)
    if (idx >= 0) setSelectedHook(idx)
  }, [savedHookText, hooks])

  // Create a draft core_post the moment the user picks a hook in the idea
  // flow. The draft has an empty body — it's just a stub so an editable card
  // shows up on /core_posts immediately. When the user later clicks "תייצר
  // לי פוסט ליבה", handleGeneratePost PATCHes this same row with the body
  // instead of inserting a new one. We guard on `postId` so the saved-flow
  // load isn't racing the create.
  const draftInFlightRef = useRef(false)
  useEffect(() => {
    if (savedPostId) return
    if (postId) return
    if (flow !== "idea") return
    if (selectedHook === null) return
    if (draftInFlightRef.current) return
    const chosenText = hooks[selectedHook]?.trim()
    if (!chosenText) return
    const chosenId = hookIds[selectedHook] || undefined

    draftInFlightRef.current = true
    fetch("/api/core-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: "",
        hookText: chosenText,
        hookId: chosenId,
        userResponse: "",
        idea: idea || undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setSavedPostId(data.id)
          // Reflect the new draft id in the URL so a refresh recovers it
          // without re-creating. We use replaceState so Next 16's
          // useSearchParams doesn't flip `flow` to "saved" mid-session.
          const url = new URL(window.location.href)
          if (!url.searchParams.get("post_id")) {
            url.searchParams.set("post_id", data.id)
            window.history.replaceState({}, "", url.toString())
          }
        }
      })
      .catch((err) => console.error("[project][create-draft]", err))
      .finally(() => { draftInFlightRef.current = false })
  }, [flow, savedPostId, postId, selectedHook, hooks, hookIds, idea])

  // If the user re-picks a hook (or edits its text) after the draft / saved
  // post already exists, keep the row's hook_text in sync. Debounced so
  // rapid clicking between hooks doesn't fire a PATCH per click. Runs in
  // both `idea` AND `saved` flows post-2026-05-14 — without this, picking
  // an alternative hook on a saved post would only sync to DB at "generate"
  // time, and any other surface reading the post (Sheet, queue panel)
  // would still see the previous hook until then.
  useEffect(() => {
    if (!savedPostId) return
    if (flow !== "idea" && flow !== "saved") return
    if (selectedHook === null) return
    const chosenText = hooks[selectedHook]?.trim()
    if (!chosenText) return
    const chosenId = hookIds[selectedHook] || undefined
    const timer = setTimeout(() => {
      fetch(`/api/core-posts/${savedPostId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hookText: chosenText, hookId: chosenId }),
      }).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [savedPostId, flow, selectedHook, hooks, hookIds])

  // Auto-save video URL when it changes
  const prevVideoUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!savedPostId || !thVideoUrl) return
    if (thVideoUrl.startsWith("blob:")) return
    // Only PATCH when the URL actually changed. Without this the effect re-fired
    // on unrelated re-renders and each run replaced the video row — which is how
    // one variant ended up with 40 video rows pointing at 4 distinct URLs.
    if (thVideoUrl === prevVideoUrlRef.current) return
    prevVideoUrlRef.current = thVideoUrl
    void savePatch(savedPostId, { videoUrl: thVideoUrl }, "הסרטון")
  }, [savedPostId, thVideoUrl])

  // Auto-save cover when it changes. Send pillColor too so the picker
  // can open already aligned with what's actually baked into the PNG on
  // the next mount (otherwise the swatch resets to black and you see a
  // mismatch between the cover and the swatch).
  //
  // THE 138-ROW ENGINE. This effect depends on `pillColor` as well as the image,
  // and every run uploads a brand-new PNG under a fresh UUID server-side. With
  // no idempotency check it re-fired on unrelated re-renders and on every colour
  // nudge, so one post accumulated 138 cover rows pointing at 138 separate
  // uploads over a single afternoon. The signature ref makes a repeat run a
  // no-op, and skipping while a cover is still generating stops us persisting a
  // half-finished intermediate.
  const prevCoverSigRef = useRef<string>("")
  useEffect(() => {
    if (!savedPostId || !thCoverImage) return
    if (thCoverLoading) return
    const sig = `${thCoverImage.length}|${thCoverImage.slice(0, 32)}|${pillColor}`
    if (sig === prevCoverSigRef.current) return
    prevCoverSigRef.current = sig
    void savePatch(
      savedPostId,
      { coverBase64: thCoverImage, coverPillColor: pillColor },
      "הקאבר",
    )
  }, [savedPostId, thCoverImage, pillColor, thCoverLoading])

  // Auto-save inline hook edits. The user can edit any hook text directly
  // in the picker on /project; without this effect the change lived in
  // local state only, and the next DB-by-idea fetch (refresh, navigation
  // back) overwrote it with the original generated text. Compares the
  // current hooks array against originalHooks (which is only updated by
  // source loads — /api/hooks response, canvas restore, DB fetch — never
  // by user edits) and PATCHes the diffed rows directly through the
  // Supabase client, matching the pattern /hooks already uses for the
  // inventory edit handler.
  useEffect(() => {
    if (!userId) return
    if (hooks.length === 0) return
    if (hooks.length !== originalHooks.length) return
    if (hooks.length !== hookIds.length) return

    const changed: Array<{ id: string; text: string }> = []
    for (let i = 0; i < hooks.length; i++) {
      if (!hookIds[i]) continue
      if (hooks[i].trim() === (originalHooks[i] ?? "").trim()) continue
      changed.push({ id: hookIds[i], text: hooks[i] })
    }
    if (changed.length === 0) return

    const timer = setTimeout(async () => {
      try {
        const supabase = createClient()
        await Promise.all(
          changed.map(({ id, text }) =>
            supabase
              .from("hooks")
              .update({ hook_text: text } as never)
              .eq("id", id)
              .eq("user_id", userId),
          ),
        )
        // Sync the baseline so this effect doesn't re-fire for the same diff.
        setOriginalHooks([...hooks])
      } catch (err) {
        console.error("[project][autosave-hook-edits]", err)
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [hooks, hookIds, originalHooks, userId])

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

  // Auto-save product selection. PATCH fires whenever the user picks a
  // different product (or clears it to null). Tracked separately from
  // coverText so the prev-ref idempotency works per-field.
  const prevProductIdRef = useRef<string | null>(selectedProductId)
  useEffect(() => {
    if (!savedPostId) return
    if (selectedProductId === prevProductIdRef.current) return
    prevProductIdRef.current = selectedProductId
    fetch(`/api/core-posts/${savedPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: selectedProductId }),
    }).catch(() => {})
  }, [savedPostId, selectedProductId])

  // Auto-save trigger-word, debounced so we don't fire a PATCH on every
  // keystroke. Empty string is a valid "user cleared it" value and gets
  // persisted as such.
  const prevTriggerWordRef = useRef(triggerWord)
  useEffect(() => {
    if (!savedPostId) return
    if (triggerWord === prevTriggerWordRef.current) return
    const next = triggerWord
    const timer = setTimeout(() => {
      prevTriggerWordRef.current = next
      fetch(`/api/core-posts/${savedPostId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerWord: next }),
      }).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [savedPostId, triggerWord])

  // Auto-save "what do you want to say". Used to live only in React state,
  // so a regeneration / navigation re-read the draft's user_response="" from
  // DB and wiped what the user typed. Debounced like trigger-word.
  const prevResponseRef = useRef(response)
  useEffect(() => {
    if (!savedPostId) return
    if (response === prevResponseRef.current) return
    const next = response
    const timer = setTimeout(() => {
      prevResponseRef.current = next
      fetch(`/api/core-posts/${savedPostId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userResponse: next }),
      }).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [savedPostId, response])

  // Auto-save core post body — debounced PATCH whenever the user edits the
  // textarea. Without this, edits live only in local state (+ sessionStorage)
  // and get overwritten by the original DB body on the next /project?post_id
  // load. Duplication to formats then runs on the original text, not the
  // user's version.
  useEffect(() => {
    if (!savedPostId) return
    if (!corePost) return
    if (corePost === originalCorePost) return

    setBodySaveStatus("saving")
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/core-posts/${savedPostId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: corePost }),
        })
        if (!res.ok) throw new Error(`save failed: ${res.status}`)
        setOriginalCorePost(corePost)
        setBodySaveStatus("saved")
      } catch (err) {
        console.error("[project][autosave-body]", err)
        setBodySaveStatus("error")
        toast.error("שמירת הפוסט נכשלה")
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [savedPostId, corePost, originalCorePost])

  // Learning log: capture a manual edit to the AI's post once the user stops
  // typing. Used to fire only on the "שיכפול לפורמטים" click, which meant an
  // edit was learned from only if the user happened to continue to the formats
  // step — anyone who edited and navigated away taught the system nothing.
  // Capped at one insight per AI version so a long editing session doesn't
  // flood learning_logs with near-identical rows.
  useEffect(() => {
    const baseline = aiCorePostRef.current
    if (!baseline || !corePost) return
    if (corePost.trim() === baseline.trim()) return
    if (loggedBaselineRef.current === baseline) return

    const timer = setTimeout(() => {
      const logged = logLearningEdit({
        originalText: baseline,
        editedText: corePost,
        contentType: "core_post",
        source: "manual_edit",
      })
      if (logged) loggedBaselineRef.current = baseline
    }, 4000)
    return () => clearTimeout(timer)
  }, [corePost])

  // Auto-save carousel images. Skips when null/empty so a delete-all flow
  // uses the explicit carousel-clear path instead of a no-op POST.
  const prevCarouselSigRef = useRef<string>("")
  useEffect(() => {
    if (!savedPostId) return
    const sig = carouselSignature(carouselImages)
    if (sig === prevCarouselSigRef.current) return
    prevCarouselSigRef.current = sig
    if (!carouselImages || carouselImages.length === 0) return
    void savePatch(savedPostId, { carouselImages }, "הקרוסלה")
  }, [savedPostId, carouselImages])

  // Manual hooks generation (no auto-generation)
  const handleGenerateHooks = (opts?: { replace?: boolean }) => {
    if (!idea) return
    const isReplace = opts?.replace === true
    if (isReplace) {
      // Wipe the local selection + the per-idea fetch ref so the DB-by-idea
      // effect treats the post-regen state as fresh. The actual hooks in
      // state get replaced by the API response below.
      setSelectedHook(null)
      fetchedHooksForIdeaRef.current = null
    }
    setHooksLoading(true)
    fetch("/api/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea,
        count: 10,
        // Server-side: deletes is_used=false hooks for this user+idea before
        // inserting the new batch, so /project shows a clean replacement
        // instead of the old + new union.
        replaceExisting: isReplace,
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
        if (data.error === "gemini_not_connected") {
          setApiNotConnected("Gemini")
        } else if (data.error === "anthropic_not_connected") {
          setApiNotConnected("Claude")
        } else if (data.error) {
          setError(data.error)
        } else if (data.hooks) {
          // /api/hooks now returns Array<{id, hook_text}> (it persists every
          // generated hook to the user's inventory). Stay compatible with the
          // older string[] response in case anything else hits this endpoint.
          const isObjShape = data.hooks.length > 0 && typeof data.hooks[0] === "object"
          const texts: string[] = isObjShape
            ? data.hooks.map((h: { hook_text: string }) => h.hook_text)
            : data.hooks
          const ids: string[] = isObjShape
            ? data.hooks.map((h: { id: string }) => h.id)
            : []
          setHooks(texts)
          setOriginalHooks(texts)
          setHookIds(ids)
        }
      })
      .catch(() => setError("שגיאה ביצירת הוקים"))
      .finally(() => setHooksLoading(false))
  }

  // Persist a freshly-generated core post to the DB.
  //
  // Called from `handleGeneratePost` once the AI returns text, and again from
  // the retry button if the first attempt fails. Returns true on success so
  // the caller can clear any error state.
  //
  // Why awaited (not fire-and-forget): a missing DB row breaks every flow
  // downstream — the post never shows up in /core_posts, in the calendar
  // queue, or in the saved-flow URL recovery. The original `.catch(() => {})`
  // hid that class of bug entirely. We now expose the failure to the user.
  const persistCorePost = async (payload: {
    body: string
    hookText: string
    hookId?: string
    userResponse: string
    videoUrl?: string
    idea?: string
  }): Promise<boolean> => {
    setSavingPost(true)
    setSaveError("")
    try {
      const res = await fetch("/api/core-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const saveData = await res.json()
      if (!res.ok || saveData?.error) {
        throw new Error(saveData?.error || `HTTP ${res.status}`)
      }
      if (saveData.id) {
        setSavedPostId(saveData.id)
        setPendingSavePayload(null)
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
        return true
      }
      throw new Error("Save returned no id")
    } catch (err) {
      console.error("[project][save-core-post]", err)
      // Cache the payload for retry — by the time the user clicks "נסו שוב",
      // the textarea / hook may have changed, but we want to save the version
      // they actually generated.
      setPendingSavePayload(payload)
      setSaveError("שמירת הפוסט נכשלה — נסו שוב")
      return false
    } finally {
      setSavingPost(false)
    }
  }

  const retrySavePost = () => {
    if (!pendingSavePayload) return
    void persistCorePost(pendingSavePayload)
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
    if (selectedHook !== null && originalHooks[selectedHook]) {
      logLearningEdit({
        originalText: originalHooks[selectedHook],
        editedText: hooks[selectedHook],
        contentType: "hook",
        source: "manual_edit",
      })
    }

    setPostLoading(true)
    setPostError("")
    setCorePost("")
    // Wait one frame so the loading chip mounts and the ref attaches before
    // we ask the browser to scroll. block: "start" lands the chip near the
    // top of the viewport so the user actually sees the spinner.
    requestAnimationFrame(() => {
      corePostResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })

    try {
      const res = await fetch("/api/core-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hook: activeHook,
          userResponse: response,
          productId: selectedProductId || undefined,
          triggerWord: triggerWord.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (data.error === "anthropic_not_connected") {
        setApiNotConnected("Claude")
      } else if (data.error) {
        setPostError(data.error)
      } else if (data.post) {
        setCorePost(data.post)
        setOriginalCorePost(data.post)
        aiCorePostRef.current = data.post
        setActiveCard("post")
        setCelebrationKey((k) => k + 1)

        // Persist the body to DB. If a draft already exists (idea flow
        // created one when the user picked a hook, or this is a saved-flow
        // regeneration), PATCH it so we don't end up with duplicate rows.
        // Otherwise create a new row via persistCorePost — surfaces save
        // failures via banner + retry instead of swallowing them.
        const selectedHookId =
          selectedHook !== null && hookIds[selectedHook]
            ? hookIds[selectedHook]
            : undefined
        if (savedPostId) {
          fetch(`/api/core-posts/${savedPostId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body: data.post,
              hookText: activeHook,
              hookId: hookIdParam || selectedHookId,
              idea: idea || undefined,
            }),
          }).catch(() => {})
        } else {
          void persistCorePost({
            body: data.post,
            hookText: activeHook,
            hookId: hookIdParam || selectedHookId,
            userResponse: response,
            videoUrl: thVideoUrl && !thVideoUrl.startsWith("blob:") ? thVideoUrl : undefined,
            idea: idea || undefined,
          })
        }
      }
    } catch (err) {
      console.error("[project][create-post]", err)
      setPostError("שגיאה ביצירת הפוסט")
    } finally {
      setPostLoading(false)
    }
  }

  /**
   * Run the format agents for EXACTLY the formats passed in, and persist what
   * comes back. Nothing outside `formats` is read or written.
   *
   * That scoping is the whole point. The duplication step used to regenerate
   * every ticked format on each press of "שכפל!", so adding a fourth format
   * silently rewrote the three the user had already edited. Both callers now
   * hand over a narrow list:
   *   - "שכפל!" passes only the formats with no script yet.
   *   - The per-card "יצירה מחדש" passes exactly that one format, after the
   *     user confirms they want its text replaced.
   *
   * The PATCH upserts per-format (`format_variants` keyed on
   * core_post_id+format), so sending a partial map is safe — formats absent
   * from `results` keep their stored body.
   */
  const generateFormatVariants = async (formats: string[]) => {
    if (formats.length === 0) return

    setFormatPosts((prev) => {
      const next = { ...prev }
      formats.forEach((fid) => {
        next[fid] = FORMAT_GENERATING
      })
      return next
    })

    const results: Record<string, string> = {}
    await Promise.all(
      formats.map(async (fid) => {
        // בי-רול has no generation agent — see FORMATS_WITHOUT_GENERATION.
        // Its body is the hook, verbatim, so it resolves without a round trip.
        // Falling through to the fetch below would 404 on /api/format/b_roll
        // and land the whole core post in the variant via the catch.
        if (FORMATS_WITHOUT_GENERATION.has(fid)) {
          // Hook + the call-to-action that pairs with the clip's on-screen
          // line (Hani, 2026-07-29). Same constant the API seeds with, so a
          // b-roll reads identically whichever path created it.
          const text = [activeHook || corePost, BROLL_SCRIPT_CTA]
            .filter(Boolean)
            .join("\n\n")
          results[fid] = text
          setFormatPosts((prev) => ({ ...prev, [fid]: text }))
          return
        }
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

    // Auto-save the new variants to DB. Not silent: losing these means the
    // format cards render text that exists nowhere but this tab.
    if (savedPostId) {
      void savePatch(savedPostId, { formatPosts: results }, "טקסטי הפורמטים")
    }
  }

  // Autosave the per-format scripts, the way the core post already autosaves
  // (Hani asked 2026-07-29 — it didn't). Editing a format's text only ever
  // reached this browser's canvas state, so the edit survived a refresh here
  // and nowhere else: another machine showed the old text, and a carousel
  // generated from the "saved" script used the pre-edit version.
  //
  // Debounced, and it skips the placeholder a format wears while its agent is
  // still writing — persisting "מייצר..." as the script would be worse than
  // not saving at all.
  // Per-format save status, same three states the core post shows. Keyed by
  // format so four cards can each report their own.
  const [formatSaveStatus, setFormatSaveStatus] = useState<
    Record<string, "saving" | "saved" | "error">
  >({})
  const savedFormatPostsRef = useRef<string>("")
  useEffect(() => {
    if (!savedPostId) return
    const persistable: Record<string, string> = {}
    for (const [fid, text] of Object.entries(formatPosts)) {
      if (hasFormatText(formatPosts, fid)) persistable[fid] = text
    }
    if (Object.keys(persistable).length === 0) return
    const snapshot = JSON.stringify(persistable)
    if (snapshot === savedFormatPostsRef.current) return

    const changed = Object.keys(persistable)
    const timer = setTimeout(() => {
      savedFormatPostsRef.current = snapshot
      setFormatSaveStatus((prev) => {
        const next = { ...prev }
        changed.forEach((fid) => (next[fid] = "saving"))
        return next
      })
      void savePatch(
        savedPostId,
        { formatPosts: persistable },
        "טקסטי הפורמטים",
      ).then((ok) => {
        setFormatSaveStatus((prev) => {
          const next = { ...prev }
          changed.forEach((fid) => (next[fid] = ok ? "saved" : "error"))
          return next
        })
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [formatPosts, savedPostId])

  const handleFormatCardClick = (fid: string) => {
    setSelectedFormatCard(selectedFormatCard === fid ? null : fid)
  }

  // Once the post has been duplicated to formats the core post is frozen —
  // further chat edits would silently diverge from the format variants. Lock
  // the "chat about the post" affordance and force the panel shut.
  const formatsLocked = duplicatedFormats.length > 0
  useEffect(() => {
    if (formatsLocked && chatOpen) setChatOpen(false)
  }, [formatsLocked, chatOpen])

  return (
    <AppShell idea={shortenTitle(idea || hookParam || (postId ? "עריכת פוסט" : ""))}>
      {/* Media Panel — sibling to InfiniteCanvas, slides from left */}
      <MediaPanel
        formatId={selectedFormatCard}
        onClose={() => setSelectedFormatCard(null)}
        postId={savedPostId}
        thAvatar={thAvatar}
        thAudioBlob={thAudioBlob}
        thVideoUrl={thVideoUrl}
        thSourceMode={thSourceMode}
        onThAvatarChange={setThAvatar}
        onThAudioBlobChange={setThAudioBlob}
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
        carouselDriveLinks={carouselDriveLinks}
        onCarouselDriveLinksChange={(links) => {
          setCarouselDriveLinks(links)
          // Saved on every edit — the list is small, and losing it to a
          // navigation is exactly the annoyance this replaced.
          if (savedPostId) {
            fetch(`/api/core-posts/${savedPostId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ carouselDriveLinks: links }),
            }).catch((err) =>
              console.error("[project][save-carousel-drive-links]", err),
            )
          }
        }}
        storyDriveLinks={storyDriveLinks}
        onStoryDriveLinksChange={(links) => {
          setStoryDriveLinks(links)
          if (savedPostId) {
            fetch(`/api/core-posts/${savedPostId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ storyDriveLinks: links }),
            }).catch((err) =>
              console.error("[project][save-story-drive-links]", err),
            )
          }
        }}
        initialFormatMedia={formatMedia}
        initialStoryFrames={storyImages}
        // Only when the page genuinely holds this post's data. In the
        // hook/idea flows nothing is fetched here, so the panel keeps doing
        // its own load rather than rendering an empty shell.
        postLoaded={postFetched && savedPostId === postId}
        onBRollUrlChange={setBRollUrl}
        bRollDriveLinks={bRollDriveLinks}
        onBRollDriveLinksChange={(links) => {
          setBRollDriveLinks(links)
          if (savedPostId) {
            fetch(`/api/core-posts/${savedPostId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bRollDriveLinks: links }),
            }).catch((err) =>
              console.error("[project][save-broll-drive-links]", err),
            )
          }
        }}
        onImagePostUrlChange={setImagePostUrl}
        onStoryImagesChange={setStoryImages}
        onStoryVideoUrlChange={setStoryVideoUrl}
      />

      {/* "Keep chatting about the post" floating panel — sibling to the
          canvas (fixed positioning) so the pan/zoom transform doesn't drag
          it. Force-closed once the post is duplicated to formats. */}
      <CorePostChat
        open={chatOpen && !formatsLocked}
        onOpenChange={setChatOpen}
        corePost={corePost}
        hookText={activeHook}
        onPreview={(text) => {
          // Live-preview the AI's revision straight into the core post card;
          // the chat's Apply/Cancel then keep or revert it.
          //
          // Re-baseline: this text is AI-authored, so the manual-edit capture
          // must not attribute it to the user. The chat records its own
          // accept/reject signal for it separately.
          aiCorePostRef.current = text
          setCorePost(text)
          setActiveCard("post")
        }}
        onBusyChange={setChatBusy}
      />

      {/* Overlay layer — OUTSIDE InfiniteCanvas on purpose. The canvas applies
          `transform: translate(...) scale(...)` to its children, and a fixed
          element inside a transformed ancestor anchors to that ancestor rather
          than the viewport. Placed within the canvas it therefore panned and
          zoomed along with the cards instead of staying put. As a sibling it
          is a true overlay: the canvas moves underneath it, untouched.
          Renders nothing once a key is connected. */}
      {geminiNoticeVisible && <GeminiConnectNoticeCard variant="floating" />}

      <InfiniteCanvas>
        {apiNotConnected && (
          <div dir="rtl" className="mx-6 mt-6 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4 flex items-center justify-between">
            <p className="text-small text-text-neutral-default">
              חברו את חשבון {apiNotConnected} שלכם כדי ליצור תוכן
            </p>
            <Link href="/settings" className="text-small font-semibold text-text-primary-default hover:underline">
              עבור להגדרות
            </Link>
          </div>
        )}
        <div className="flex items-start gap-0 pt-24 pr-24" dir="rtl">

          {/* === Flow: from idea ===
                Trigger on state (hooks generated or fresh idea entry) rather
                than on `flow === "idea"` alone. Next 16's useSearchParams
                reacts to the `history.replaceState` that the draft-on-hook-
                selection effect fires, so `flow` flips to "saved" mid-session
                and would otherwise unmount the entire idea card stack
                including the generated hooks.
                We deliberately DO NOT gate on `!corePost`: once the user has
                generated hooks for this session, the full list stays visible
                even after the core post is created. The rule from product is
                "anything the user generated or wrote stays on screen until
                they explicitly remove it" — collapsing back to a single-hook
                view broke that. The hook-flow card stack below is mutex'd
                against this so they never render simultaneously. */}
          {((flow === "idea") || hooks.length > 0) && (
            <>
              {/* Idea card — editable */}
              <div
                dir="rtl"
                className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[346px] shrink-0"
              >
                <div className={`flex items-center px-6 py-3 rounded-t-[20px] ${activeCard === "idea" ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}>
                  <span className="text-p-bold text-text-primary-default">רעיון</span>
                </div>
                <div className="px-6">
                  <div className="rounded-lg p-2 transition-colors focus-within:bg-gray-95">
                    <Textarea
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      onFocus={() => setActiveCard("idea")}
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
                  {/* Regenerate action — only when there are already hooks to
                      replace. Visual position: left of the title in RTL
                      (ms-auto), matching the "נשמר ✓" tag pattern on the core
                      post card. Clears the selection + the per-idea fetch ref
                      and re-runs /api/hooks with replaceExisting=true so the
                      old unused batch is removed before the new one lands. */}
                  {hooks.length > 0 && !hooksLoading && (
                    <button
                      type="button"
                      onClick={() => handleGenerateHooks({ replace: true })}
                      disabled={!idea}
                      className="ms-auto flex items-center gap-1 text-xs text-text-neutral-default hover:text-text-primary-default transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <RotateCw className="size-3" />
                      <span>תייצר מחדש</span>
                    </button>
                  )}
                </div>

                {hooksLoading && (
                  <div className="flex items-center justify-center gap-2 px-6 py-8">
                    <Loader2 className="size-5 animate-spin text-yellow-50" />
                    <span className="text-small text-text-neutral-default">מייצר הוקים...</span>
                  </div>
                )}

                {error && !hooksLoading && (
                  <div className="px-6 flex flex-col gap-2 items-center">
                    {error === "anthropic_overloaded" || error === "gemini_overloaded" || error === "no_hooks_generated" ? (
                      <>
                        <span className="text-small text-text-primary-default">
                          {error === "no_hooks_generated"
                            ? "לא הצלחנו לייצר הוקים הפעם. נסו שוב"
                            : error === "gemini_overloaded"
                              ? "השרתים של Gemini עמוסים כרגע. נסו שוב בעוד דקה"
                              : "השרתים של Anthropic עמוסים כרגע. נסו שוב בעוד דקה"}
                        </span>
                        <Button size="sm" onClick={() => { setError(""); handleGenerateHooks() }} className="gap-1.5">
                          <Sparkles className="size-3.5" />
                          נסו שוב
                        </Button>
                      </>
                    ) : error === "gemini_quota_exceeded" ? (
                      <>
                        <span className="text-small text-text-primary-default">חרגתם מהמכסה של Gemini</span>
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-small-bold text-text-primary-default hover:underline">
                          לבדיקת המכסה ←
                        </a>
                      </>
                    ) : error === "gemini_key_invalid" ? (
                      <>
                        <span className="text-small text-text-primary-default">מפתח ה-Gemini לא תקף יותר. צריך לחבר אותו מחדש</span>
                        <Link href="/settings?tab=connections&sub=gemini" className="text-small-bold text-text-primary-default hover:underline">
                          לעמוד ההגדרות ←
                        </Link>
                      </>
                    ) : error === "credits_exhausted" ? (
                      <>
                        <span className="text-small text-text-primary-default">נגמרו לכם הקרדיטים של Anthropic</span>
                        <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="text-small-bold text-text-primary-default hover:underline">
                          לרכישת קרדיטים ←
                        </a>
                      </>
                    ) : (
                      <span className="text-small text-button-destructive-default">{error}</span>
                    )}
                  </div>
                )}

                {hooks.length === 0 && !hooksLoading && !error && (
                  <div className="flex justify-center px-6 py-4">
                    <Button onClick={() => handleGenerateHooks()} size="sm" className="gap-1.5">
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
                      products={products}
                      productId={selectedProductId}
                      onProductChange={(id) => {
                        productManuallySetRef.current = true
                        setSelectedProductId(id)
                      }}
                      triggerWord={triggerWord}
                      onTriggerWordChange={setTriggerWord}
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
                two after generation. ===
                Mutex against the idea-flow stack above so the two never
                render at once. The idea-flow stack covers any session where
                we have hooks in state (in-session or hydrated by the DB-by-
                idea fetch); this stack is reserved for hook-flow entries
                without an associated idea-text + hooks set. */}
          {!((flow === "idea") || hooks.length > 0) &&
            (flow === "hook" || (flow === "saved" && !!(savedHookText || editableHook))) && (
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
                  products={products}
                  productId={selectedProductId}
                  onProductChange={(id) => {
                    productManuallySetRef.current = true
                    setSelectedProductId(id)
                  }}
                  triggerWord={triggerWord}
                  onTriggerWordChange={setTriggerWord}
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
              {/* Connector to whatever card precedes the core post. In `saved`
                  flow the workflow/hook cards now render too (after generation
                  the URL flips to `saved`), so the connector must follow them
                  rather than be omitted as it was when `saved` had nothing
                  before the core post. */}
              {(flow !== "saved" || !!(savedHookText || editableHook)) && (
                <div className="flex items-center mt-[55px]">
                  <div className="h-[2px] w-7 bg-gray-80" />
                </div>
              )}

              {postLoading && (
                <div ref={corePostResultRef} className="flex items-center mt-[29px]">
                  <div className="flex items-center gap-2 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 px-6 py-4">
                    <Loader2 className="size-5 animate-spin text-yellow-50" />
                    <span className="text-small text-text-neutral-default">כותב את הפוסט...</span>
                  </div>
                </div>
              )}

              {postError && !postLoading && (
                <div className="flex items-center mt-[55px]">
                  <div
                    dir="rtl"
                    className="flex flex-col gap-1 rounded-[20px] border border-button-destructive-default bg-white dark:bg-gray-10 px-6 py-4 text-right"
                  >
                    {postError === "anthropic_overloaded" ? (
                      <>
                        <span className="text-small-bold text-button-destructive-default">
                          קרעתם את קלוד אה? :(
                        </span>
                        <span className="text-small text-button-destructive-default">
                          השרתים של אנתרופיק עמוסים ולא ניתן זמנית לייצר תוכן. אפשר לנסות שוב בעוד כמה דקות.
                        </span>
                      </>
                    ) : (
                      <span className="text-small text-button-destructive-default">{postError}</span>
                    )}
                  </div>
                </div>
              )}

              {(corePost || savedPostId) && !postLoading && (
                <div className="relative isolate flex flex-col items-center w-[567px] shrink-0">
                  <CorePostCelebration trigger={celebrationKey} />
                  {/* Save-failure banner — sits above the card so the user
                      sees it before scanning the post body. The post itself
                      is fully visible/editable; only persistence failed. */}
                  {saveError && (
                    <div
                      dir="rtl"
                      role="alert"
                      className="mb-3 w-[567px] rounded-[12px] border border-button-destructive-default bg-white dark:bg-gray-10 px-4 py-3 flex items-center gap-3"
                    >
                      <span className="text-small text-button-destructive-default flex-1">
                        {saveError}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={retrySavePost}
                        disabled={savingPost}
                        className="gap-1.5 shrink-0"
                      >
                        {savingPost ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            שומר...
                          </>
                        ) : (
                          "נסו שוב לשמור"
                        )}
                      </Button>
                    </div>
                  )}


                  {/* Core post card */}
                  <div
                    dir="rtl"
                    className={`flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px] shrink-0 ${chatBusy ? "ai-card-working" : ""}`}
                  >
                    <div className={`flex items-center px-6 py-3 rounded-t-[20px] ${activeCard === "post" ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}>
                      <span className="text-p-bold text-text-primary-default">פוסט ליבה</span>
                      {/* While the chat AI is generating a revision, show a
                          "מעדכן..." indicator (takes over the save-status slot). */}
                      {chatBusy && (
                        <span className="ms-auto flex items-center gap-1 text-xs text-yellow-40">
                          <Sparkles className="size-3 animate-pulse" />
                          <span>מעדכן...</span>
                        </span>
                      )}
                      {!chatBusy && savedPostId && (
                        <span className="ms-auto flex items-center gap-1 text-xs text-text-neutral-default">
                          {bodySaveStatus === "saving" ? (
                            <>
                              <Loader2 className="size-3 animate-spin" />
                              <span>שומר...</span>
                            </>
                          ) : bodySaveStatus === "error" ? (
                            <span className="text-button-destructive-default">שגיאה בשמירה</span>
                          ) : (
                            <>
                              <Check className="size-3" />
                              <span>נשמר</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-4 px-6 items-end">
                      <RichBodyEditor
                        value={corePost}
                        onChange={setCorePost}
                        onFocus={() => setActiveCard("post")}
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`w-full min-h-[250px] rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 shadow-none text-small leading-relaxed select-text ${chatBusy ? "ai-text-shimmer pointer-events-none" : ""}`}
                      />
                      <p className="flex w-full items-center gap-1.5 text-xs-body text-text-neutral-default">
                        <Info className="size-4 shrink-0" aria-hidden="true" />
                        <span>כל עריכה שלכם תשפיע על הלמידה של ה-AI להבין את סגנון הכתיבה שלכם ולהשתפר</span>
                      </p>
                      <div className="flex items-center gap-2">
                        {/* Chat about the post — usable only until the post is
                            duplicated to formats (then the core post is frozen
                            and this is disabled). Wrapped in a span so the
                            tooltip still fires while the button is disabled. */}
                        <TooltipLabel
                          label={
                            formatsLocked
                              ? "אי אפשר לערוך בשיחה אחרי שיכפול לפורמטים"
                              : "עריכה עם AI"
                          }
                        >
                          <span className="inline-flex">
                            <AiRefineButton
                              disabled={formatsLocked}
                              busy={chatBusy}
                              onClick={() => setChatOpen(true)}
                            />
                          </span>
                        </TooltipLabel>
                        <Button
                          disabled={activeCard !== "post"}
                          onClick={() => {
                            // Learning log: flush any pending core post edit
                            // before moving on, in case the user continued to
                            // formats faster than the idle capture fires.
                            const baseline = aiCorePostRef.current
                            if (baseline && loggedBaselineRef.current !== baseline) {
                              const logged = logLearningEdit({
                                originalText: baseline,
                                editedText: corePost,
                                contentType: "core_post",
                                source: "manual_edit",
                              })
                              if (logged) loggedBaselineRef.current = baseline
                            }
                            setShowFormats(true)
                            setActiveCard("formats")
                          }}
                        >
                          שיכפול לפורמטים
                        </Button>
                      </div>
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
                          {FORMATS.map((format) => {
                            // A format that already has a script can't be
                            // un-ticked here. Un-ticking used to drop its card
                            // from the canvas while the variant stayed in the
                            // DB (so it came back on reload) — a silent lie.
                            // Removing a format is a destructive action and
                            // belongs behind its own control, not behind a
                            // checkbox that also means "generate".
                            const alreadyDuplicated = hasFormatText(formatPosts, format.id)
                            return (
                              // Native title rather than <TooltipLabel>:
                              // SelectionCard doesn't forward refs/props, so it
                              // can't serve as a Radix TooltipTrigger asChild.
                              <div
                                key={format.id}
                                title={alreadyDuplicated ? `${format.label} כבר שוכפל` : undefined}
                              >
                                <SelectionCard
                                  description={format.label}
                                  icon={<format.icon className="size-4" />}
                                  isSelected={selectedFormats.includes(format.id)}
                                  className={alreadyDuplicated ? "cursor-default" : undefined}
                                  onSelect={() => {
                                    if (alreadyDuplicated) return
                                    setSelectedFormats((prev) =>
                                      prev.includes(format.id)
                                        ? prev.filter((f) => f !== format.id)
                                        : [...prev, format.id]
                                    )
                                    setActiveCard("formats")
                                  }}
                                />
                              </div>
                            )
                          })}
                        </div>
                        <div className="px-6 flex justify-end">
                          {(() => {
                            // Only the ticked formats that have no script yet.
                            // Everything already duplicated is left untouched —
                            // pressing "שכפל!" after adding a format must fill
                            // the gap, not restart the whole set.
                            const pendingFormats = selectedFormats.filter(
                              (fid) => !hasFormatText(formatPosts, fid),
                            )
                            // A format mid-generation still reads as "missing"
                            // (its body is the placeholder), so without this
                            // guard a second press would fire the same agents
                            // again while the first round is in flight.
                            const anyGenerating =
                              Object.values(formatPosts).includes(FORMAT_GENERATING)
                            return (
                              <Button
                                disabled={
                                  pendingFormats.length === 0 ||
                                  anyGenerating ||
                                  activeCard !== "formats"
                                }
                                onClick={async () => {
                                  // Union, ordered by FORMATS, so existing cards
                                  // keep their position when a new one appears.
                                  setDuplicatedFormats((prev) => {
                                    const union = new Set([...prev, ...pendingFormats])
                                    return FORMATS.map((f) => f.id).filter((id) => union.has(id))
                                  })
                                  await generateFormatVariants(pendingFormats)
                                }}
                              >
                                שכפל!
                              </Button>
                            )
                          })()}
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
                          onRegenerateFormat={(fid) => setPendingFormatRegen(fid)}
                          formatSaveStatus={formatSaveStatus}
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
                            setSelectedFormatCard("talking_head")
                          }}
                          onThDelete={() => setPendingVideoDelete(true)}
                          thCoverImage={thCoverImage}
                          thCoverLoading={thCoverLoading}
                          coverText={coverText}
                          onCoverTextChange={setCoverText}
                          onCoverRegenerate={() => generateCoverForPost(coverText, thVideoUrl || undefined)}
                          pillColor={pillColor}
                          onPillColorChange={(next) => {
                            setPillColor(next)
                            // The picker leaves `livePillColor` armed when it
                            // commits; we drop the CSS overlay only after the
                            // regenerated PNG lands so the user never sees
                            // the old colour flash back during the round-trip.
                            generateCoverForPost(coverText, thVideoUrl || undefined, next)
                              .finally(() => setLivePillColor(null))
                          }}
                          livePillColor={livePillColor}
                          onLivePillPreview={setLivePillColor}
                          thVideoFrameDataUrl={thVideoFrameDataUrl}
                          userId={userId}
                          carouselImages={carouselImages}
                          carouselCardRef={carouselCardRef}
                          // Opening the media panel must NOT throw the current
                          // carousel away (Hani, 2026-07-28): the old handler
                          // cleared images+slides on click, so pressing what
                          // read as "edit" destroyed the carousel before she
                          // had seen a single alternative. Now it just opens
                          // the panel — same as story / image_post — where the
                          // saved carousel is shown on its template tile and
                          // deleting it is a separate, explicit action.
                          onCarouselEdit={() => setSelectedFormatCard("carousel")}
                          imagePostUrl={imagePostUrl}
                          imagePostCardRef={imagePostCardRef}
                          onImagePostEdit={() => setSelectedFormatCard("image_post")}
                          storyImages={storyImages}
                          storyCardRef={storyCardRef}
                          onStoryEdit={() => setSelectedFormatCard("story")}
                          storyVideoUrl={storyVideoUrl}
                          bRollUrl={bRollUrl}
                          bRollCardRef={bRollCardRef}
                          onBRollEdit={() => setSelectedFormatCard("b_roll")}
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

      {/* Floating schedule bar — appears once we have a saved post id, on
          top of the canvas. Picks up its state from timing-storage. */}
      <ScheduleInCalendarBar
        corePostId={savedPostId}
        hookText={activeHook}
        hasUploadedMedia={
          // A cover (thCoverImage) is a derived thumbnail, NOT media in a
          // format — the server excludes it from formatsWithMedia too. Only
          // an actual uploaded/recorded asset counts: avatar video or
          // carousel images. (Old posts ship a cover but no real media, and
          // were wrongly showing the schedule toast.)
          !!thVideoUrl ||
          (carouselImages?.length ?? 0) > 0 ||
          (storyImages?.length ?? 0) > 0 ||
          !!storyVideoUrl
        }
      />

      {/* Re-run one format's agent. Confirmed rather than immediate: the card
          may hold text the user edited by hand, and the new draft replaces it.
          Only `pendingFormatRegen` is regenerated — the sibling formats are
          never in the request. */}
      <ConfirmModal
        open={!!pendingFormatRegen}
        onOpenChange={(open) => { if (!open) setPendingFormatRegen(null) }}
        title={
          pendingFormatRegen
            ? `ליצור מחדש את הטקסט ל${FORMAT_MAP[pendingFormatRegen]?.label ?? ""}?`
            : ""
        }
        description="ניצור גרסה חדשה מפוסט הליבה. הטקסט שנמצא כרגע בפורמט הזה יוחלף — שאר הפורמטים לא ישתנו."
        confirmLabel="כן, ליצור מחדש"
        cancelLabel="לא, להשאיר"
        onConfirm={async () => {
          const fid = pendingFormatRegen
          setPendingFormatRegen(null)
          if (fid) await generateFormatVariants([fid])
        }}
      />

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
  onRegenerateFormat,
  formatSaveStatus,
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
  pillColor,
  onPillColorChange,
  livePillColor,
  onLivePillPreview,
  thVideoFrameDataUrl,
  userId,
  carouselImages,
  carouselCardRef,
  onCarouselEdit,
  imagePostUrl,
  imagePostCardRef,
  onImagePostEdit,
  storyImages,
  storyCardRef,
  onStoryEdit,
  storyVideoUrl,
  bRollUrl,
  bRollCardRef,
  onBRollEdit,
}: {
  formats: string[]
  formatPosts: Record<string, string>
  onPostChange: (fid: string, text: string) => void
  /** Arms the confirm dialog for re-running ONE format's agent. */
  onRegenerateFormat: (fid: string) => void
  /** Autosave state per format, shown next to each card's title. */
  formatSaveStatus: Record<string, "saving" | "saved" | "error">
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
  pillColor: string
  onPillColorChange: (color: string) => void
  livePillColor: string | null
  onLivePillPreview: (color: string | null) => void
  thVideoFrameDataUrl: string | null
  userId: string | null
  carouselImages: string[] | null
  carouselCardRef: React.RefObject<HTMLDivElement | null>
  onCarouselEdit: () => void
  imagePostUrl: string | null
  imagePostCardRef: React.RefObject<HTMLDivElement | null>
  onImagePostEdit: () => void
  storyImages: string[] | null
  storyCardRef: React.RefObject<HTMLDivElement | null>
  onStoryEdit: () => void
  storyVideoUrl: string | null
  bRollUrl: string | null
  bRollCardRef: React.RefObject<HTMLDivElement | null>
  onBRollEdit: () => void
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
          const isGenerating = formatPosts[fid] === FORMAT_GENERATING

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
                  {/* Autosave state, the same three the core post shows —
                      editing a format script now persists, so it needs to say
                      so (Hani, 2026-07-29). Sits before the regenerate icon,
                      which keeps its `ms-auto` and holds the far end. */}
                  {formatSaveStatus[fid] && (
                    <span className="flex items-center gap-1 text-xs text-text-neutral-default">
                      {formatSaveStatus[fid] === "saving" ? (
                        <>
                          <Loader2 className="size-3 animate-spin" />
                          <span>שומר...</span>
                        </>
                      ) : formatSaveStatus[fid] === "error" ? (
                        <span className="text-button-destructive-default">
                          שגיאה בשמירה
                        </span>
                      ) : (
                        <>
                          <Check className="size-3" />
                          <span>נשמר</span>
                        </>
                      )}
                    </span>
                  )}

                  {/* Per-format re-run of the duplication. Lives INSIDE the
                      format card (not in the "לאיזה פורמטים לשכפל?" card)
                      so re-generating one format can never touch the others.
                      `ms-auto` parks it at the far end of the RTL header. */}
                  <TooltipLabel label={`יצירה מחדש של הטקסט ל${format.label}`}>
                    <button
                      type="button"
                      aria-label={`יצירה מחדש של הטקסט ל${format.label}`}
                      disabled={isGenerating}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRegenerateFormat(fid)
                      }}
                      className="ms-auto flex items-center justify-center size-8 shrink-0 rounded-lg transition-colors cursor-pointer hover:bg-bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RotateCw
                        className={`size-4 text-text-neutral-default ${isGenerating ? "animate-spin" : ""}`}
                      />
                    </button>
                  </TooltipLabel>
                </div>
                <div className="px-6 flex flex-col gap-3">
                  <div className="relative group">
                    <RichBodyEditor
                      value={formatPosts[fid] ?? ""}
                      onChange={(text) => onPostChange(fid, text)}
                      onFocus={() => onActiveChange(`format-${fid}`)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="min-h-[200px] rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 shadow-none text-small leading-relaxed select-text"
                    />
                    <CopyButton text={formatPosts[fid] ?? ""} />
                  </div>
                  <Button
                    variant="outline"
                    // For talking_head, we disable the button once a video
                    // exists — editing then happens via the video card's
                    // "עריכת סרטון" button below. For other formats, the
                    // button always opens MediaPanel (MediaUploadFlow handles
                    // upload + Drive link, just like the avatar module).
                    disabled={fid === "talking_head" && !!thVideoUrl}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (fid === "talking_head" && thVideoUrl) return
                      onSelectFormat(fid)
                    }}
                    className="w-full rounded-[10px] border-border-neutral-default text-text-primary-default text-small gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon className="size-4" />
                    עריכת מדיה ל{format.label}
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
                          {livePillColor !== null ? (
                            // Live client composite. Mirrors the server's
                            // DEFAULT_BRAND_STYLE (center/center, Rubik
                            // ExtraBold, 24px radius, 24×40 padding) at the
                            // 200px-wide preview scale (~5.4× smaller than
                            // the 1080-wide PNG) so the colour change feels
                            // instant while the picker is open. PNG takes
                            // over again on commit.
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {thVideoFrameDataUrl ? (
                                <img
                                  src={thVideoFrameDataUrl}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              ) : (
                                <div
                                  className="absolute inset-0"
                                  style={{ backgroundImage: "linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}
                                />
                              )}
                              <div className="absolute inset-0 flex items-center justify-center px-[11px]">
                                <span
                                  className="text-white text-center"
                                  style={{
                                    backgroundColor: livePillColor,
                                    padding: "4px 7px",
                                    borderRadius: 4,
                                    fontFamily: "Rubik, sans-serif",
                                    fontWeight: 800,
                                    fontSize: 13,
                                    lineHeight: 1,
                                    letterSpacing: 0,
                                    maxWidth: "100%",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {coverText}
                                </span>
                              </div>
                            </>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`data:image/png;base64,${thCoverImage}`}
                              alt="cover"
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                      </div>
                      {/* Footer row: swatch picker on the right (RTL first
                          child), download button on the left. Matches the
                          shared layout pattern from the Figma. */}
                      <div className="flex items-center justify-between gap-3" dir="rtl">
                        <ColorSwatchPicker
                          value={pillColor}
                          onChange={onPillColorChange}
                          onLivePreview={onLivePillPreview}
                          userId={userId}
                          label="רקע הכותרת"
                        />
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
                  onEdit={onCarouselEdit}
                />
              )}

              {/* Story result below the story card — the saved AI frame set
                  (1-3 frames). Same connected-card pattern as image_post. */}
              {/* ONE story card, one ordered frame list (Hani, 2026-07-28).
                  Frames and a story video used to render as two separate
                  "הסטורי שלכם" cards, so a story with both looked like two
                  stories. A story is a single sequence: whatever is already
                  there keeps its position, and anything added lands after it.
                  The clip is appended only when it isn't already a frame —
                  the burn flow writes it as a standalone video asset, and
                  dropping the card outright would have lost it. */}
              {fid === "story" && (() => {
                const frames = [
                  ...(storyImages ?? []),
                  ...(storyVideoUrl && !(storyImages ?? []).includes(storyVideoUrl)
                    ? [storyVideoUrl]
                    : []),
                ]
                if (frames.length === 0) return null
                return (
                  <StoryResultCard
                    frames={frames}
                    cardRef={storyCardRef}
                    onEdit={onStoryEdit}
                  />
                )
              })()}

              {/* The generated b-roll clip, as its own card under the b-roll
                  script — the same shape story and talking_head use, so every
                  format's finished media reads the same way on the canvas. */}
              {fid === "b_roll" && bRollUrl && (
                <>
                  <div className="w-[2px] h-7 bg-gray-80" />
                  <div
                    ref={bRollCardRef}
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
                  >
                    <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
                      <span className="text-p-bold text-text-primary-default">הבי-רול שלכם</span>
                      <Film className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      <div className="flex justify-center">
                        <div className="w-[200px] aspect-[9/16] overflow-hidden rounded-xl border border-border-neutral-default bg-bg-surface">
                          <video
                            src={`${bRollUrl}#t=0.001`}
                            controls
                            playsInline
                            muted
                            // Metadata only — the card sits on the canvas
                            // whether or not she plays it.
                            preload="metadata"
                            className="w-full h-full object-cover"
                            onMouseDown={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                      <Button variant="outline" className="w-full" onClick={onBRollEdit}>
                        עריכת בי-רול
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {/* Image result below image_post card — appears once the user
                  has generated + approved (or uploaded) an image. Same
                  connected-card pattern as the talking_head video/cover
                  cards above. */}
              {fid === "image_post" && imagePostUrl && (
                <>
                  <div className="w-[2px] h-7 bg-gray-80" />
                  <div
                    ref={imagePostCardRef}
                    dir="rtl"
                    className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
                  >
                    <div className="flex items-center gap-2 px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
                      <span className="text-p-bold text-text-primary-default">התמונה שלכם</span>
                      <Image className="size-4 text-text-neutral-default" />
                    </div>
                    <div className="px-6 flex flex-col gap-4">
                      <div className="flex justify-center">
                        <div className="relative w-[200px] aspect-[4/5] rounded-xl overflow-hidden bg-bg-surface border border-border-neutral-default">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imagePostUrl}
                            alt="התמונה שנוצרה לפוסט"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                      <div className="flex gap-3 w-full items-center">
                        <Button variant="outline" className="flex-1" onClick={onImagePostEdit}>
                          עריכת תמונה
                        </Button>
                        <TooltipLabel label="הורד תמונה">
                          <Button
                            variant="outline"
                            type="button"
                            aria-label="הורד תמונה"
                            className="w-11 px-0"
                            onClick={async () => {
                              try {
                                const res = await fetch(imagePostUrl)
                                if (!res.ok) throw new Error("fetch_failed")
                                const blob = await res.blob()
                                const objectUrl = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = objectUrl
                                a.download = `image-post-${Date.now()}.png`
                                document.body.appendChild(a)
                                a.click()
                                a.remove()
                                URL.revokeObjectURL(objectUrl)
                              } catch (err) {
                                console.error("[project][image-post-download]", err)
                                // CORS-blocked or network failure — fall back to a
                                // new tab so the user can save manually.
                                window.open(imagePostUrl, "_blank")
                              }
                            }}
                          >
                            <Download className="size-4" />
                          </Button>
                        </TooltipLabel>
                      </div>
                    </div>
                  </div>
                </>
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
  onEdit,
}: {
  images: string[]
  cardRef: React.RefObject<HTMLDivElement | null>
  /** Opens the media panel. Non-destructive — see `onCarouselEdit`. */
  onEdit: () => void
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
          {/* Slide preview — no fixed aspect: templates are square (1080²)
              or IG-portrait (1080×1350); the img sets its natural ratio. */}
          <div className="relative w-full rounded-xl overflow-hidden bg-gray-95">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              // URL or base64. The card used to assume base64 only, so it
              // depended on the page decoding every slide from storage on
              // load — an async step that fails silently and left the canvas
              // with no carousel card at all (Hani, 2026-07-29).
              src={storyFrameSrc(images[currentSlide])}
              alt={`סלייד ${currentSlide + 1}`}
              className="w-full h-auto"
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
            {/* "עריכת קרוסלה", not "צור מחדש" — the label now matches what
                the click does. Same wording + behaviour as the image_post and
                story result cards. */}
            <Button variant="outline" className="flex-1" onClick={onEdit}>
              עריכת קרוסלה
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Story Result Card — shows the saved AI frame set below story card  */
/* ------------------------------------------------------------------ */

function StoryResultCard({
  frames,
  cardRef,
  onEdit,
}: {
  frames: string[]
  cardRef: React.RefObject<HTMLDivElement | null>
  onEdit: () => void
}) {
  const [downloading, setDownloading] = useState(false)

  const downloadOne = async (src: string, i: number) => {
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error("fetch_failed")
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = `story-${i + 1}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      console.error("[project][story-download]", err)
      window.open(src, "_blank")
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      // One frame → download it; multiple → download each in order.
      for (let i = 0; i < frames.length; i++) {
        await downloadOne(storyFrameSrc(frames[i]), i)
      }
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
          <span className="text-p-bold text-text-primary-default">הסטורי שלכם</span>
          <Smartphone className="size-4 text-text-neutral-default" />
        </div>
        <div className="px-6 flex flex-col items-center gap-4">
          {/* Plays on Instagram's clock rather than sitting on frame 1 — the
              point of the preview is to show the pacing the audience gets. */}
          <StoryPlayer
            frames={frames}
            className="w-[200px] aspect-[9/16] border border-border-neutral-default"
          />

          <div className="flex gap-3 w-full items-center">
            <Button variant="outline" className="flex-1" onClick={onEdit}>
              עריכת סטורי
            </Button>
            <TooltipLabel label={frames.length > 1 ? "הורד הכל" : "הורד סטורי"}>
              <Button
                variant="outline"
                type="button"
                aria-label={frames.length > 1 ? "הורד הכל" : "הורד סטורי"}
                className="w-11 px-0"
                disabled={downloading}
                onClick={handleDownload}
              >
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
            </TooltipLabel>
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

  // Link-mode Drive video. NOT the iframe branch below: Drive's player has
  // a minimum width and gets clipped at card size, and the canvas eats the
  // pointer events before they reach it. DriveVideoPreview shows a poster
  // with our own play control and opens the real player in a dialog.
  if (isDriveUrl(url)) {
    return (
      <div className="relative w-[200px] aspect-[9/16] rounded-xl overflow-hidden bg-gray-95">
        <DriveVideoPreview url={url} label="הוידאו שלכם" />
      </div>
    )
  }

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
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast.error("ההעתקה נכשלה — נסו שוב")
      return
    }
    setCopied(true)
    toast.success("הועתק ללוח")
    setTimeout(() => setCopied(false), 1500)
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
