import { toast } from "sonner"
import { flushPendingSaves } from "@/lib/pending-saves"

/**
 * Background b-roll generation, held OUTSIDE React.
 *
 * The media panel unmounts the moment it's closed — every format flow is
 * rendered only while its `formatId` is selected. So anything whose progress
 * lives in component state dies with it: the request keeps running and the
 * server still saves the result, but the spinner vanishes and the finished
 * clip doesn't appear until a reload.
 *
 * image_post and story already solve this with module-level stores; b-roll
 * was written with local state and didn't. This is the same pattern, so the
 * user can fire a generation, close the panel, work on another format, and
 * come back to a finished b-roll — or see it land on the canvas without
 * touching the panel at all.
 *
 * Keyed by postId: four formats can be generating at once, and two posts open
 * in two tabs must not read each other's progress.
 */

type BRollState = {
  /** How many generations are running for this post. */
  inFlight: number
  /** The most recently finished clip, for whoever mounts next. */
  url: string | null
  /** How many caption burns are running for this post. */
  burning: number
  /** The most recently burned clip, and which format it belongs to. */
  burned: { url: string; format: string } | null
  /** Whether a story Drive import is running for this post. */
  storyImporting: boolean
  /** Human-readable progress for that import ("טוען פריים 2 מתוך 3..."). */
  storyProgress: string
  /** Its error, if it failed. Cleared when a new import starts. */
  storyError: string | null
  /** The frame set it produced, for whoever mounts next. */
  storyFrames: string[] | null
  /** How many STILL-image caption renders are running for this post. */
  captioningImage: number
  /**
   * The most recent captioned still, its untouched original, and which
   * format it belongs to. Both URLs are kept because the panel offers the
   * user a way back to the picture they brought.
   */
  captionedImage: {
    url: string
    originalUrl: string
    format: string
  } | null
  /** Why the last still-caption attempt failed, in Hebrew. */
  captionImageError: string | null
}

const EMPTY: BRollState = {
  inFlight: 0,
  url: null,
  burning: 0,
  burned: null,
  storyImporting: false,
  storyProgress: "",
  storyError: null,
  storyFrames: null,
  captioningImage: 0,
  captionedImage: null,
  captionImageError: null,
}

const states = new Map<string, BRollState>()
const listeners = new Map<string, Set<() => void>>()
let toastSeq = 0

function update(postId: string, fn: (s: BRollState) => BRollState): void {
  const next = fn(states.get(postId) ?? EMPTY)
  states.set(postId, next)
  listeners.get(postId)?.forEach((cb) => cb())
}

export function subscribeBRollGeneration(
  postId: string | null,
  cb: () => void,
): () => void {
  if (!postId) return () => {}
  let set = listeners.get(postId)
  if (!set) {
    set = new Set()
    listeners.set(postId, set)
  }
  set.add(cb)
  return () => {
    set?.delete(cb)
  }
}

export function getBRollGenerationSnapshot(postId: string | null): BRollState {
  if (!postId) return EMPTY
  return states.get(postId) ?? EMPTY
}

/**
 * Fire a generation. Safe to call while another is running — `inFlight` counts
 * them, so the UI shows work in progress until the last one lands.
 *
 * The route persists the clip itself, so a result is never lost even if every
 * listener has gone away; this store only carries the PROGRESS and the URL so
 * the UI can catch up without a reload.
 */
export function startBRollGeneration(
  postId: string,
  variationIndex: number,
): void {
  if (!postId) return
  update(postId, (s) => ({ ...s, inFlight: s.inFlight + 1 }))
  const toastId = `broll-gen-${++toastSeq}`
  toast.loading("מייצרים בי-רול... זה יכול לקחת עד דקה", {
    id: toastId,
    duration: Infinity,
  })

  void (async () => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
      const res = await fetch("/api/b-roll/generate-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, variationIndex }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        url?: string
        error?: string
        message?: string
      }
      if (!res.ok || !data.url) {
        toast.error(data.message ?? data.error ?? "יצירת הבי-רול נכשלה", {
          id: toastId,
          duration: 10000,
        })
        return
      }
      update(postId, (s) => ({ ...s, url: data.url as string }))
      toast.success("הבי-רול נוצר", { id: toastId, duration: 4000 })
    } catch (err) {
      toast.error(
        `יצירת הבי-רול נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: 10000 },
      )
    } finally {
      update(postId, (s) => ({ ...s, inFlight: Math.max(0, s.inFlight - 1) }))
    }
  })()
}

/**
 * Burn the post's caption into the format's video. Lives here for the same
 * reason generation does: it fires automatically the moment a Drive link is
 * pasted, takes tens of seconds, and the panel it was started from is often
 * closed long before it finishes.
 *
 * The route persists the burned clip, so the file survives regardless — this
 * store carries the progress and the resulting URL so the UI catches up
 * without a reload.
 */
export function startCaptionBurn(postId: string, format: string): void {
  if (!postId) return
  update(postId, (s) => ({ ...s, burning: s.burning + 1 }))
  const toastId = `caption-burn-${++toastSeq}`
  toast.loading("מטמיעים את הכיתוב בסרטון...", {
    id: toastId,
    duration: Infinity,
  })

  void (async () => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
      const res = await fetch("/api/story/generate-video-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // b-roll burns the same way story does — same route, same overlay,
        // different variant.
        body: JSON.stringify({ postId, format }),
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
      update(postId, (s) => ({
        ...s,
        burned: { url: data.url as string, format },
      }))
      toast.success("הכיתוב הוטמע בסרטון", { id: toastId, duration: 4000 })
    } catch (err) {
      toast.error(
        `הטמעת הכיתוב נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: 10000 },
      )
    } finally {
      update(postId, (s) => ({ ...s, burning: Math.max(0, s.burning - 1) }))
    }
  })()
}

/**
 * Lay the post's caption over a STILL the user brought — the image sibling of
 * `startCaptionBurn`.
 *
 * Lives in the store for the same reason the video burn does: it fires on its
 * own the moment an image is attached, and the panel that started it is often
 * closed before it lands. Unlike the video burn this one is quick (one satori
 * render), but "quick" is not "instant" on a 50MB Drive photo, and a spinner
 * that dies with its panel is worse than no spinner.
 *
 * `position` is what the user picked in the panel; the caption always
 * carries the post's full text.
 */
export function startImageCaption(
  postId: string,
  format: string,
  opts?: {
    sourceUrl?: string
    position?: "top" | "center" | "bottom"
    /** Suppress the toast when the caller already shows inline progress. */
    quiet?: boolean
  },
): void {
  if (!postId) return
  update(postId, (s) => ({
    ...s,
    captioningImage: s.captioningImage + 1,
    captionImageError: null,
  }))
  const toastId = `image-caption-${++toastSeq}`
  if (!opts?.quiet) {
    toast.loading("מטמיעים את הכיתוב בתמונה...", {
      id: toastId,
      duration: Infinity,
    })
  }

  void (async () => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
      const res = await fetch("/api/media/caption-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          format,
          sourceUrl: opts?.sourceUrl,
          position: opts?.position,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        url?: string
        originalUrl?: string
        error?: string
        message?: string
      }
      if (!res.ok || !data.url) {
        const msg = data.message ?? data.error ?? "הטמעת הכיתוב בתמונה נכשלה"
        update(postId, (s) => ({ ...s, captionImageError: msg }))
        if (!opts?.quiet) toast.error(msg, { id: toastId, duration: 10000 })
        return
      }
      update(postId, (s) => ({
        ...s,
        captionedImage: {
          url: data.url as string,
          originalUrl: data.originalUrl ?? opts?.sourceUrl ?? "",
          format,
        },
      }))
      if (!opts?.quiet) {
        toast.success("הכיתוב הוטמע בתמונה", { id: toastId, duration: 4000 })
      }
    } catch (err) {
      const msg = `הטמעת הכיתוב בתמונה נכשלה: ${
        err instanceof Error ? err.message : String(err)
      }`
      update(postId, (s) => ({ ...s, captionImageError: msg }))
      if (!opts?.quiet) toast.error(msg, { id: toastId, duration: 10000 })
    } finally {
      update(postId, (s) => ({
        ...s,
        captioningImage: Math.max(0, s.captioningImage - 1),
      }))
    }
  })()
}

export function clearImageCaptionError(postId: string | null): void {
  if (!postId) return
  update(postId, (s) => ({ ...s, captionImageError: null }))
}

/** Mirrors the cap the panel's link rows enforce. */
const MAX_FILE_MB = 50

/**
 * Pull the story's frames from Drive and caption each one, in order.
 *
 * The longest-running job in the app — one Drive fetch plus one ffmpeg render
 * per frame — and it starts on its own the moment a link is pasted. Leaving
 * it inside the panel meant closing the panel abandoned a job that was
 * already halfway through burning captions.
 *
 * `existing` is the frame set already on the post: a row with no new link
 * keeps whatever frame it had, so importing a second frame never re-creates
 * the first or drops one the AI generator made.
 */
export function startStoryDriveImport(
  postId: string,
  rows: string[],
  existing: string[],
): void {
  if (!postId) return

  const links = rows.filter(Boolean)
  if (links.length === 0) {
    update(postId, (s) => ({ ...s, storyError: "הדביקו לפחות קישור אחד" }))
    return
  }
  if (links.some((l) => !/drive\.google\.com|docs\.google\.com/i.test(l))) {
    update(postId, (s) => ({
      ...s,
      storyError: "כל הקישורים צריכים להיות מגוגל דרייב (קאנבה לא נתמך כאן)",
    }))
    return
  }

  update(postId, (s) => ({
    ...s,
    storyImporting: true,
    storyError: null,
    storyProgress: "",
  }))

  const errMap: Record<string, string> = {
    invalid_drive_link: "לא זוהה קובץ באחד הקישורים.",
    drive_not_public:
      'אחד הקבצים לא ציבורי — שנו הרשאה ל„כל מי שיש לו הקישור”.',
    file_too_large: `אחד הקבצים גדול מדי (מקסימום ${MAX_FILE_MB}MB).`,
  }

  const setProgress = (text: string) =>
    update(postId, (s) => ({ ...s, storyProgress: text }))

  /**
   * Caption one frame. Returns null on failure — a frame that couldn't be
   * captioned is still a usable frame, so the import keeps the raw one and
   * carries on rather than throwing the whole set away.
   */
  const burnFrame = async (
    url: string,
    frameIndex: number,
    frameCount: number,
  ): Promise<string | null> => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
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
          frameIndex,
          frameCount,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error || !data.url) return null
      return data.url as string
    } catch {
      return null
    }
  }

  void (async () => {
    try {
      const frames: string[] = []
      let pulled = 0
      const toPull = links.length
      // How many frames the finished story will have — the script is split
      // across this many, so it counts every row that ends up carrying a
      // frame, not just the ones being pulled now.
      const totalFrames = Math.max(
        rows.filter((r, i) => !!r || !!existing[i]).length,
        existing.length,
      )

      for (let i = 0; i < rows.length; i++) {
        const link = rows[i]
        if (!link) {
          const kept = existing[i]
          if (kept) frames.push(kept)
          continue
        }
        pulled++
        setProgress(`טוען פריים ${pulled} מתוך ${toPull}...`)
        const res = await fetch("/api/media/from-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link, store: true }),
        })
        const data = await res.json()
        if (!res.ok || data.error || !data.url) {
          update(postId, (s) => ({
            ...s,
            storyError: `${errMap[data.error] ?? "טעינת אחד הפריימים נכשלה."} (פריים ${i + 1})`,
          }))
          return
        }
        setProgress(`מטמיעים כיתוב בפריים ${pulled} מתוך ${toPull}...`)
        // Position in the FINAL set, not in the pull order — the script is
        // divided by where a frame sits in the story, and `i` is exactly that
        // even when earlier rows were left blank.
        const burned = await burnFrame(data.url as string, i, totalFrames)
        frames.push(burned ?? (data.url as string))
      }

      // Frames beyond the rows on screen are still part of the story — keep
      // them rather than truncating the set to the form's length.
      if (existing.length > rows.length) {
        frames.push(...existing.slice(rows.length))
      }

      const saveRes = await fetch(`/api/core-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyImages: frames }),
      })
      if (!saveRes.ok) {
        update(postId, (s) => ({ ...s, storyError: "שמירת הסטורי נכשלה" }))
        return
      }

      update(postId, (s) => ({ ...s, storyFrames: frames }))
      toast.success(`הסטורי נטען מהדרייב (${frames.length} פריימים)`, {
        duration: 5000,
      })
    } catch (err) {
      console.error("[story-drive-import]", err)
      update(postId, (s) => ({
        ...s,
        storyError: "שגיאת רשת בטעינת הפריימים. נסו שוב.",
      }))
    } finally {
      update(postId, (s) => ({
        ...s,
        storyImporting: false,
        storyProgress: "",
      }))
    }
  })()
}

export function clearStoryImportError(postId: string | null): void {
  if (!postId) return
  update(postId, (s) => ({ ...s, storyError: null }))
}
