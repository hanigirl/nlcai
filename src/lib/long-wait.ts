"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { NOTICE_TOAST_CLASSES } from "@/lib/gemini-quota-toasts"
import { carouselMetaForServer } from "@/lib/carousel-caption"

/**
 * Long waits (carousel ~2 min, b-roll, story, image, AI edit) — one shared
 * helper for the "you can leave this screen" promise (Nataliya, 22.10.2026:
 * "אחרת אנשים ייתקעו שם ולא יזוזו והם יהיו בלחץ").
 *
 * The promise is only made where it is TRUE. Verified per flow (2026-10-29):
 *   - b-roll / story / image generation: module-level stores, detached fetch,
 *     the result is saved without the screen, the Toaster lives in the root
 *     layout → survives in-app navigation and the toast lands anywhere.
 *   - carousel generation: the fetch + toast survive, but the slides were only
 *     saved by the project page. `saveCarouselIfLeft` closes that gap.
 *   - AI edit (media-ai-chat): the server saves the result, but the panel
 *     reported progress itself and said nothing once it was gone.
 *     `trackAwayResult` adds the notification.
 * Navigation means the app's own links (client-side). A reload or a closed
 * tab still ends the client side of a job — hence "מסך אחר", not "לסגור".
 *
 * Review gate: `?waitnote=a|b` (read when a job starts). No param → every
 * call here behaves exactly like the code it replaced.
 *   a — the note rides in the job's own toast (the toast that later turns
 *       into "ready" is the one that made the promise).
 *   b — one "running in the background" tray replaces the loading toasts;
 *       the done/error toasts still arrive wherever she is.
 */

export type WaitNoteVariant = "a" | "b"

export const LEAVE_SCREEN_NOTE = "אפשר לעבור למסך אחר ואנחנו נודיע כשהפעולה תסתיים."

export function waitNoteVariant(): WaitNoteVariant | null {
  if (typeof window === "undefined") return null
  const v = new URLSearchParams(window.location.search).get("waitnote")
  return v === "a" || v === "b" ? v : null
}

/** Review-only: which state the harness should land on (`&state=`). */
export function waitNoteReviewState(): string | null {
  if (!waitNoteVariant()) return null
  return new URLSearchParams(window.location.search).get("state")
}

// ── Background-jobs registry (variant b's tray reads it) ─────────────────

export type LongWaitJob = {
  id: string
  /** "מייצרים" for a new piece, "מעדכנים" for an edit. */
  verb: "מייצרים" | "מעדכנים"
  /** With the definite article: "הקרוסלה", "הבי-רול"... */
  what: string
}

const jobs = new Map<string, LongWaitJob>()
const listeners = new Set<() => void>()
let snapshot: LongWaitJob[] = []

function emit() {
  snapshot = [...jobs.values()]
  listeners.forEach((cb) => cb())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useLongWaitJobs(): LongWaitJob[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY_JOBS)
}
const EMPTY_JOBS: LongWaitJob[] = []

/**
 * A long job starts. Replaces a bare `toast.loading(title, { id, duration:
 * Infinity })` — with no review param it IS that call. The caller keeps
 * resolving the same toast id with toast.success / toast.error as before,
 * and calls `endLongWait(id)` in its `finally`.
 */
export function startLongWait(job: LongWaitJob, toastTitle: string): WaitNoteVariant | null {
  const variant = waitNoteVariant()
  if (variant === "b") {
    jobs.set(job.id, job)
    emit()
    return variant
  }
  toast.loading(toastTitle, {
    id: job.id,
    duration: Infinity,
    ...(variant === "a"
      ? { description: LEAVE_SCREEN_NOTE, classNames: NOTICE_TOAST_CLASSES }
      : {}),
  })
  return variant
}

/** The job is over (either way). Safe to call for any id, any variant. */
export function endLongWait(id: string): void {
  if (jobs.delete(id)) emit()
}

/**
 * For waits a panel reports itself (the AI-edit chat): nothing changes while
 * she watches the panel; if she left before it finished, the result arrives
 * as a toast wherever she is. Variant b also shows it in the tray meanwhile.
 * No review param → returns `run` untouched.
 */
export async function trackAwayResult<T extends { ok: boolean }>(
  job: LongWaitJob,
  run: Promise<T>,
  isWatching: () => boolean,
  copy: { done: string; failed: string },
): Promise<T> {
  const variant = waitNoteVariant()
  if (!variant) return run
  if (variant === "b") {
    jobs.set(job.id, job)
    emit()
  }
  try {
    const result = await run
    if (!isWatching()) {
      if (result.ok) toast.success(copy.done, { id: job.id, duration: 8000 })
      else toast.error(copy.failed, { id: job.id, duration: 12000 })
    }
    return result
  } finally {
    endLongWait(job.id)
  }
}

/** True while the calling component is mounted — for `trackAwayResult`. */
export function useIsWatching(): () => boolean {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return useCallback(() => mounted.current, [])
}

/**
 * Carousel generation used to be saved only by the project page's autosave,
 * so a set that finished after she left /project lived in memory until she
 * reopened the panel. When the page is gone, save it here (same PATCH the
 * page sends). Only under the review param on this branch — the fix must
 * ship with whichever variant is picked.
 */
export async function saveCarouselIfLeft(
  /** What `startLongWait` returned — the URL has changed by now. */
  variant: WaitNoteVariant | null,
  postId: string | null | undefined,
  images: string[],
): Promise<void> {
  if (!postId || !variant || isOnRealPost()) return
  await fetch(`/api/core-posts/${postId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carouselImages: images, carouselMeta: carouselMetaForServer(postId) }),
  }).catch((err) => console.error("[long-wait][save-carousel-if-left]", err))
}

function isOnRealPost(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/project"
}
