/**
 * The bridge between "typing" and "the server has it".
 *
 * /project saves the core post and the format scripts on a debounce: a
 * second or so after the last keystroke. Two things can't wait for that:
 *
 *   - Leaving the page. Navigate, close the tab, and the timer dies with the
 *     page; the last edit existed only in that tab (Hani, 2026-09-03).
 *   - Generating media. The story / image-post / b-roll routes read the
 *     script from the database, so a click within the debounce window built
 *     the picture from the previous text.
 *
 * The page registers a flusher; anyone about to depend on the server copy
 * calls flushPendingSaves() first. Nothing registered = nothing to wait for.
 */
type Flusher = () => Promise<void>

const flushers = new Set<Flusher>()

export function registerPendingSaveFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

/** Send every parked save now and wait for the server to confirm. */
export async function flushPendingSaves(): Promise<void> {
  await Promise.all(
    [...flushers].map((fn) =>
      fn().catch((err) => {
        // A failed save is already reported where it happened (toast). The
        // caller only needs to know the attempt is over, not that it worked.
        console.error("[pending-saves] flush failed", err)
      }),
    ),
  )
}
