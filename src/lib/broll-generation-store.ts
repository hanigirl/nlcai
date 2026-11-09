import type { MediaGenResult } from "@/lib/media-brief"
import type { MediaStyle } from "@/lib/visual-language/types"
import { toast } from "sonner"
import { longWaitDone, startLongWait } from "@/lib/long-wait"
import { flushPendingSaves } from "@/lib/pending-saves"
import { storyFrames } from "@/lib/story-text-split"

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
  /**
   * The format of each running burn, one entry per burn. `burning` alone
   * can't say whether the story or the b-roll is the one waiting, and the
   * canvas needs to know which card to hold a skeleton for.
   */
  burningFormats: string[]
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
  /** The format of each running still-caption render — see `burningFormats`. */
  captioningFormats: string[]
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
  /**
   * Why the last caption burn failed, and for which format — so the panel
   * can say it and offer to try again (it used to be a toast only, and the
   * bare clip stayed as if it were done). Cleared when a burn starts.
   */
  burnError: { format: string; message: string } | null
}

const EMPTY: BRollState = {
  inFlight: 0,
  url: null,
  burning: 0,
  burningFormats: [],
  burned: null,
  storyImporting: false,
  storyProgress: "",
  storyError: null,
  storyFrames: null,
  captioningImage: 0,
  captioningFormats: [],
  captionedImage: null,
  captionImageError: null,
  burnError: null,
}

const states = new Map<string, BRollState>()

/** Drop ONE occurrence — two burns of the same format can overlap. */
function withoutOne(list: string[], item: string): string[] {
  const i = list.indexOf(item)
  return i === -1 ? list : [...list.slice(0, i), ...list.slice(i + 1)]
}
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
  style?: MediaStyle,
  /** brief / references / quiet — see MediaGenOptions in lib/image-generation-store. */
  opts: { brief?: string; references?: string[]; place?: string[]; quiet?: boolean } = {},
): Promise<MediaGenResult> {
  if (!postId) return Promise.resolve({ ok: false, message: "" })
  const { brief, references, place, quiet = false } = opts
  update(postId, (s) => ({ ...s, inFlight: s.inFlight + 1 }))
  const toastId = `broll-gen-${++toastSeq}`
  if (!quiet) startLongWait(toastId, "מייצרים בי-רול... זה יכול לקחת כשתי דקות")
  const fail = (message: string): MediaGenResult => {
    if (!quiet) toast.error(message, { id: toastId, duration: 10000 })
    return { ok: false, message }
  }

  return (async (): Promise<MediaGenResult> => {
    try {
      // The route reads the script from the DB: make sure the DB has what
      // the user sees before asking for a picture of it.
      await flushPendingSaves()
      const res = await fetch("/api/b-roll/generate-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          variationIndex,
          style,
          ...(brief ? { brief } : {}),
          ...(references?.length ? { references } : {}),
          ...(place?.length ? { place } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        url?: string
        error?: string
        message?: string
      }
      if (!res.ok || !data.url) {
        return fail(data.message ?? data.error ?? "יצירת הבי-רול נכשלה")
      }
      update(postId, (s) => ({ ...s, url: data.url as string }))
      if (!quiet) longWaitDone(toastId, "הבי-רול נוצר", { postId })
      return { ok: true }
    } catch (err) {
      return fail(`יצירת הבי-רול נכשלה: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      update(postId, (s) => ({ ...s, inFlight: Math.max(0, s.inFlight - 1) }))
    }
  })()
}

/** The b-roll was deleted from the canvas — forget the last finished clip. */
export function clearBRollUrl(postId: string): void {
  update(postId, (s) => ({ ...s, url: null }))
}

/**
 * "עריכה עם AI" — Opus revises the current b-roll's animation per her
 * instruction and the clip is re-rendered. Shares `inFlight` with generation:
 * to the panel and the canvas it's the same "b-roll is being made" state.
 * Resolves true when the new clip landed (the panel clears the instruction).
 */
export function startBRollEdit(
  postId: string,
  instruction: string,
  /** The chat panel reports progress itself — no toasts then. */
  /** references: screenshots she attached (lib/ai-edit-references). */
  /** earlierReferences: her last message's images, when this one has none. */
  opts: { quiet?: boolean; references?: string[]; earlierReferences?: string[] } = {},
): Promise<{ ok: true; url: string; unchanged?: string } | { ok: false; message: string }> {
  if (!postId || !instruction.trim()) return Promise.resolve({ ok: false, message: "" })
  update(postId, (s) => ({ ...s, inFlight: s.inFlight + 1 }))
  const toastId = `broll-edit-${++toastSeq}`
  if (!opts.quiet) {
    startLongWait(toastId, "מעדכנים את הבי-רול לפי ההוראות... זה יכול לקחת כדקה")
  }
  return (async () => {
    try {
      const res = await fetch("/api/b-roll/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          instruction,
          ...(opts.references?.length ? { references: opts.references } : {}),
          ...(opts.earlierReferences?.length ? { earlierReferences: opts.earlierReferences } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        url?: string
        error?: string
        message?: string
        unchanged?: boolean
      }
      if (!res.ok || !data.url) {
        const message = data.message ?? data.error ?? "עריכת הבי-רול נכשלה"
        if (!opts.quiet) toast.error(message, { id: toastId, duration: 10000 })
        return { ok: false as const, message }
      }
      // The edit changed nothing — the clip stays, and the reply says so.
      if (data.unchanged) {
        const message = data.message ?? "הבקשה לא שינתה כלום, אז השארתי את הבי-רול כמו שהיה."
        if (!opts.quiet) longWaitDone(toastId, message, { postId })
        return { ok: true as const, url: data.url, unchanged: message }
      }
      update(postId, (s) => ({ ...s, url: data.url as string }))
      if (!opts.quiet) longWaitDone(toastId, "הבי-רול עודכן", { postId })
      return { ok: true as const, url: data.url }
    } catch (err) {
      const message = `עריכת הבי-רול נכשלה: ${err instanceof Error ? err.message : String(err)}`
      if (!opts.quiet) toast.error(message, { id: toastId, duration: 10000 })
      return { ok: false as const, message }
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
  update(postId, (s) => ({
    ...s,
    burning: s.burning + 1,
    burningFormats: [...s.burningFormats, format],
    burnError: s.burnError?.format === format ? null : s.burnError,
  }))
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
        const message = data.message ?? data.error ?? "הטמעת הכיתוב נכשלה"
        toast.error(message, {
          id: toastId,
          duration: 10000,
        })
        update(postId, (s) => ({ ...s, burnError: { format, message } }))
        return
      }
      update(postId, (s) => ({
        ...s,
        burned: { url: data.url as string, format },
      }))
      toast.success("הכיתוב הוטמע בסרטון", { id: toastId, duration: 4000 })
    } catch (err) {
      const message = `הטמעת הכיתוב נכשלה: ${err instanceof Error ? err.message : String(err)}`
      toast.error(message, { id: toastId, duration: 10000 })
      update(postId, (s) => ({ ...s, burnError: { format, message } }))
    } finally {
      update(postId, (s) => ({
        ...s,
        burning: Math.max(0, s.burning - 1),
        burningFormats: withoutOne(s.burningFormats, format),
      }))
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
    captioningFormats: [...s.captioningFormats, format],
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
        skipped?: string
      }
      // The picture already carries its words — it stays as she brought it,
      // and with no captioned render nothing arms the caption controls.
      if (res.ok && data.skipped === "has_text") {
        toast.info("בתמונה כבר יש טקסט, אז השארנו אותה כמו שהיא", {
          id: toastId,
          duration: 5000,
        })
        return
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
        captioningFormats: withoutOne(s.captioningFormats, format),
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
      // The script's stories set the story's length (Hani, 2026-11-09): three
      // stories = three frames, no matter how many files she brought. With
      // fewer files, her last one is the picture for every story after it.
      await flushPendingSaves()
      const scriptStories = await (async () => {
        try {
          const r = await fetch(`/api/core-posts/${postId}`)
          const body = r.ok ? ((await r.json()) as { post?: { formatPosts?: Record<string, string> } }).post?.formatPosts?.story : null
          return body?.trim() ? storyFrames(body).length : 0
        } catch {
          return 0
        }
      })()
      // How many frames the finished story will have — the script is split
      // across this many, so it counts every row that ends up carrying a
      // frame, not just the ones being pulled now.
      const totalFrames = Math.max(
        rows.filter((r, i) => !!r || !!existing[i]).length,
        existing.length,
        scriptStories,
      )
      let lastPulled: string | null = null

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
        lastPulled = data.url as string
      }

      // Stories the script has and her files don't: her last file again,
      // each with its own story's caption.
      if (lastPulled && existing.length <= rows.length) {
        for (let i = frames.length; i < scriptStories; i++) {
          setProgress(`מטמיעים כיתוב בפריים ${i + 1} מתוך ${scriptStories}...`)
          const burned = await burnFrame(lastPulled, i, totalFrames)
          frames.push(burned ?? lastPulled)
        }
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
