import { toast } from "sonner"
import { flushPendingSaves } from "@/lib/pending-saves"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"

/**
 * Module-level store for image_post AI generations.
 *
 * Generation lives here — NOT inside the media panel component — so that:
 *   • closing the panel (which unmounts the component) does NOT abort an
 *     in-flight generation; the fetch keeps running and its result is
 *     retained until the user reopens the panel,
 *   • multiple generations run in parallel (each `startImageGeneration`
 *     call is an independent fetch),
 *   • the toast fires regardless of whether the panel is open, so the user
 *     is told an image is ready even after they navigated away.
 *
 * DURABILITY: every generated image is uploaded to Storage and its URL is
 * tracked in localStorage (keyed by postId), so ALL past versions survive
 * a page reload — not just the one the user picked. On open we hydrate the
 * kept URLs back into the store. (In-memory `results` may briefly hold a
 * base64 data URL as an upload fallback; those don't persist.)
 */

export interface GenerationState {
  /** Generated images — Storage URLs (persisted) or base64 fallbacks. */
  results: string[]
  /** How many generations are currently running for this post. */
  inFlight: number
}

const MEDIA_BUCKET = "user-media"
const LS_PREFIX = "img-post-candidates:"

function loadPersisted(postId: string): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + postId)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function persistPostUrls(postId: string): void {
  if (typeof window === "undefined") return
  // Only durable http(s) URLs are persisted — base64 fallbacks are dropped.
  const urls = (states.get(postId)?.results ?? []).filter((r) => /^https?:/.test(r))
  try {
    window.localStorage.setItem(LS_PREFIX + postId, JSON.stringify(urls))
  } catch {
    /* quota or disabled storage — session-only is acceptable */
  }
}

function base64ToBlob(b64: string, type = "image/png"): Blob {
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type })
}

/**
 * Upload a generated PNG to Storage under the user's candidates folder and
 * return its public URL. Throws on failure so the caller can fall back to
 * a base64 (session-only) result.
 */
async function uploadCandidate(base64: string): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await getCurrentUser(supabase)
  if (!user) throw new Error("not signed in")
  const path = `${user.id}/image-candidates/${crypto.randomUUID()}.png`
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, base64ToBlob(base64), { contentType: "image/png", upsert: false })
  if (error) throw error
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
}

// Posts whose persisted candidates have already been merged into the store
// this session — so reopening the panel doesn't re-append them.
const hydratedPosts = new Set<string>()

const EMPTY: GenerationState = { results: [], inFlight: 0 }

const states = new Map<string, GenerationState>()
const listeners = new Map<string, Set<() => void>>()

// Per-post monotonic generation index — passed to the route so each
// attempt is steered toward a visually distinct design (route rotates a
// style list by this index). PERSISTED to localStorage so it keeps
// climbing across reloads/sessions; otherwise it would reset to 0 on every
// reload and every "first" generation would land on the same style.
const VARSEQ_PREFIX = "img-post-varseq:"

function nextVariationIndex(postId: string): number {
  const key = VARSEQ_PREFIX + postId
  let n = 0
  if (typeof window !== "undefined") {
    try {
      n = parseInt(window.localStorage.getItem(key) ?? "0", 10) || 0
    } catch {
      /* storage disabled — fall back to 0 */
    }
    try {
      window.localStorage.setItem(key, String(n + 1))
    } catch {
      /* ignore */
    }
  }
  return n
}

// Monotonic counter for unique toast ids (avoids Date.now()/random).
let toastSeq = 0

function emit(key: string) {
  const set = listeners.get(key)
  if (set) for (const l of set) l()
}

function update(key: string, fn: (s: GenerationState) => GenerationState) {
  const prev = states.get(key) ?? EMPTY
  states.set(key, fn(prev))
  emit(key)
}

export function subscribeGeneration(key: string, listener: () => void): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
  }
}

export function getGenerationSnapshot(key: string): GenerationState {
  return states.get(key) ?? EMPTY
}

/**
 * Fire a new AI image generation for `postId`. Returns immediately; the
 * fetch runs detached so it survives the caller unmounting. Safe to call
 * repeatedly — each call runs in parallel and appends its own result.
 * Never throws (failures surface as a toast).
 */
export function startImageGeneration(postId: string): void {
  if (!postId) return
  update(postId, (s) => ({ ...s, inFlight: s.inFlight + 1 }))
  // Steers this attempt toward a design distinct from the previous ones.
  const variationIndex = nextVariationIndex(postId)
  const toastId = `img-gen-${++toastSeq}`
  toast.loading("מייצרים תמונה עם AI... זה יכול לקחת עד דקה", {
    id: toastId,
    duration: Infinity,
  })

  void (async () => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
      const res = await fetch("/api/image-post/generate-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, variationIndex }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        image?: string
        error?: string
        message?: string
      }
      if (!res.ok || !data.image) {
        toast.error(data.message ?? data.error ?? "יצירת התמונה נכשלה", {
          id: toastId,
          duration: 10000,
        })
        return
      }
      // Upload to Storage so the version is kept durably (survives reload).
      // If the upload fails, fall back to a session-only base64 result.
      let entry: string
      try {
        entry = await uploadCandidate(data.image)
      } catch {
        entry = `data:image/png;base64,${data.image}`
      }
      update(postId, (s) => ({ ...s, results: [...s.results, entry] }))
      persistPostUrls(postId)
      toast.success("התמונה מוכנה — הקליקו עליה להגדלה ושמירה", {
        id: toastId,
        duration: 4000,
      })
    } catch (err) {
      toast.error(
        `יצירת התמונה נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: 10000 },
      )
    } finally {
      update(postId, (s) => ({ ...s, inFlight: Math.max(0, s.inFlight - 1) }))
    }
  })()
}

/** Drop a version from the store + its persisted list. */
export function removeGenerationResult(postId: string, src: string): void {
  update(postId, (s) => ({
    ...s,
    results: s.results.filter((r) => r !== src),
  }))
  persistPostUrls(postId)
}

/**
 * Add an image (storage URL) to the kept versions if it isn't already
 * there. Used to preserve the previously-selected image when the user
 * picks a new one, so old versions never disappear from the row.
 */
export function addGenerationResult(postId: string, src: string): void {
  if (!src) return
  update(postId, (s) =>
    s.results.includes(src) ? s : { ...s, results: [...s.results, src] },
  )
  persistPostUrls(postId)
}

/**
 * Merge this post's persisted (kept) version URLs back into the store —
 * once per session. Called when the panel opens so ALL past generations
 * reappear after a reload, not just the saved one.
 */
export function hydrateCandidates(postId: string): void {
  if (!postId || hydratedPosts.has(postId)) return
  hydratedPosts.add(postId)
  const urls = loadPersisted(postId)
  if (urls.length === 0) return
  update(postId, (s) => {
    const merged = [...s.results]
    for (const u of urls) if (!merged.includes(u)) merged.push(u)
    return { ...s, results: merged }
  })
}
