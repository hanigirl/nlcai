import { toast } from "sonner"
import { flushPendingSaves } from "@/lib/pending-saves"

/**
 * Module-level store for story AI generations ("media-to-story").
 *
 * Mirrors image-generation-store, with ONE structural difference: a story
 * generation returns a SET of 1-3 frames (the route splits a long script
 * into up to 3 legible 9:16 frames), so each result is a `string[]` (a
 * frame set), and `sets` is a list of those.
 *
 * Living here — NOT in the media panel component — means:
 *   • closing the panel (which unmounts the component) does NOT abort an
 *     in-flight generation; the fetch keeps running and its set is retained
 *     until the user reopens the panel,
 *   • multiple generations run in parallel,
 *   • the toast fires regardless of whether the panel is open.
 *
 * DURABILITY: unlike image_post, generated sets are kept in memory as
 * base64 and are NOT uploaded per-candidate — only the set the user SAVES
 * is persisted (PATCH /api/core-posts/{id} { storyImages } → media_assets),
 * and it rehydrates on reload via the post's `storyImageUrls`. This matches
 * the carousel model (candidates are ephemeral; the approved set persists).
 */

export interface StoryGenerationState {
  /** Each entry is one generation's frame set (base64 PNGs). */
  sets: string[][]
  /** How many generations are currently running for this post. */
  inFlight: number
}

const EMPTY: StoryGenerationState = { sets: [], inFlight: 0 }

const states = new Map<string, StoryGenerationState>()
const listeners = new Map<string, Set<() => void>>()

// Per-post monotonic generation index — passed to the route so each attempt
// rotates to a different palette/mood. PERSISTED to localStorage so it keeps
// climbing across reloads; otherwise every "first" generation would land on
// the same palette.
const VARSEQ_PREFIX = "story-varseq:"

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

function update(
  key: string,
  fn: (s: StoryGenerationState) => StoryGenerationState,
) {
  const prev = states.get(key) ?? EMPTY
  states.set(key, fn(prev))
  emit(key)
}

export function subscribeStoryGeneration(
  key: string,
  listener: () => void,
): () => void {
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

export function getStoryGenerationSnapshot(key: string): StoryGenerationState {
  return states.get(key) ?? EMPTY
}

/**
 * Fire a new AI story generation for `postId`. Returns immediately; the
 * fetch runs detached so it survives the caller unmounting. Safe to call
 * repeatedly — each call runs in parallel and appends its own frame set.
 * Never throws (failures surface as a toast).
 */
export function startStoryGeneration(postId: string): void {
  if (!postId) return
  update(postId, (s) => ({ ...s, inFlight: s.inFlight + 1 }))
  // Steers this attempt toward a palette distinct from the previous ones.
  const variationIndex = nextVariationIndex(postId)
  const toastId = `story-gen-${++toastSeq}`
  toast.loading("מייצרים סטורי עם AI... זה יכול לקחת עד דקה", {
    id: toastId,
    duration: Infinity,
  })

  void (async () => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
      const res = await fetch("/api/story/generate-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, variationIndex }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        images?: string[]
        frameCount?: number
        error?: string
        message?: string
      }
      if (!res.ok || !data.images || data.images.length === 0) {
        toast.error(data.message ?? data.error ?? "יצירת הסטורי נכשלה", {
          id: toastId,
          duration: 10000,
        })
        return
      }
      const set = data.images
      update(postId, (s) => ({ ...s, sets: [...s.sets, set] }))
      const count = set.length
      toast.success(
        count > 1
          ? `הסטורי מוכן — ${count} פריימים. הקליקו לתצוגה ושמירה`
          : "הסטורי מוכן — הקליקו עליו לתצוגה ושמירה",
        { id: toastId, duration: 4000 },
      )
    } catch (err) {
      toast.error(
        `יצירת הסטורי נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: 10000 },
      )
    } finally {
      update(postId, (s) => ({ ...s, inFlight: Math.max(0, s.inFlight - 1) }))
    }
  })()
}

/** Drop a generated set from the store (e.g. after it's saved or dismissed). */
export function removeStoryGenerationSet(postId: string, set: string[]): void {
  update(postId, (s) => ({
    ...s,
    sets: s.sets.filter((x) => x !== set),
  }))
}
