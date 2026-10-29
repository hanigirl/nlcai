"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { NOTICE_TOAST_CLASSES } from "@/lib/gemini-quota-toasts"
import { carouselMetaForServer } from "@/lib/carousel-caption"
import { previewAccessNow } from "@/lib/use-scheduling-access"

/**
 * Long waits (carousel ~2 min, b-roll, story, image, AI edit) — one shared
 * helper for the "you can leave this screen" promise (Nataliya, 22.10.2026:
 * "אחרת אנשים ייתקעו שם ולא יזוזו והם יהיו בלחץ"). Hani picked the version
 * that puts the note inside the existing loading toast (2026-10-29).
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
 */

export const LEAVE_SCREEN_NOTE = "אפשר לעבור למסך אחר ואנחנו נודיע כשהפעולה תסתיים."

/**
 * A long job starts: the loading toast, with the leave-screen note as its
 * second line. The caller keeps resolving the same toast id with
 * toast.success / toast.error — the toast that made the promise is the one
 * that turns into "ready".
 */
export function startLongWait(id: string, title: string): void {
  // Not in the preview batch: the loading toast exactly as before.
  if (!previewAccessNow()) {
    toast.loading(title, { id, duration: Infinity })
    return
  }
  toast.loading(title, {
    id,
    duration: Infinity,
    description: LEAVE_SCREEN_NOTE,
    classNames: NOTICE_TOAST_CLASSES,
  })
}

/**
 * For waits a panel reports itself (the AI-edit chat): nothing changes while
 * she watches the panel; if she left before it finished, the result arrives
 * as a toast wherever she is.
 */
export async function trackAwayResult<T extends { ok: boolean }>(
  id: string,
  run: Promise<T>,
  isWatching: () => boolean,
  copy: { done: string; failed: string },
): Promise<T> {
  const result = await run
  if (!isWatching()) {
    if (result.ok) toast.success(copy.done, { id, duration: 8000 })
    else toast.error(copy.failed, { id, duration: 12000 })
  }
  return result
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
 * page sends). While the page is still mounted its autosave does it.
 */
export async function saveCarouselIfLeft(
  postId: string | null | undefined,
  images: string[],
): Promise<void> {
  if (!postId || typeof window === "undefined" || window.location.pathname === "/project") return
  await fetch(`/api/core-posts/${postId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carouselImages: images, carouselMeta: carouselMetaForServer(postId) }),
  }).catch((err) => console.error("[long-wait][save-carousel-if-left]", err))
}

/** What the AI-edit chat says when she left mid-edit (keyed by its format). */
export const AWAY_COPY: Record<"b_roll" | "carousel" | "story" | "image_post", { done: string; failed: string }> = {
  b_roll: {
    done: "עריכת הבי-רול הסתיימה. הסרטון החדש מופיע בפוסט.",
    failed: "עריכת הבי-רול לא הצליחה. נסו שוב מהפוסט.",
  },
  carousel: {
    done: "עריכת הקרוסלה הסתיימה. השקופיות החדשות מופיעות בפוסט.",
    failed: "עריכת הקרוסלה לא הצליחה. נסו שוב מהפוסט.",
  },
  story: {
    done: "עריכת הסטורי הסתיימה. הפריימים החדשים מופיעים בפוסט.",
    failed: "עריכת הסטורי לא הצליחה. נסו שוב מהפוסט.",
  },
  image_post: {
    done: "עריכת התמונה הסתיימה. היא מופיעה בפוסט.",
    failed: "עריכת התמונה לא הצליחה. נסו שוב מהפוסט.",
  },
}
