/**
 * Copy text to the clipboard, with a fallback for the cases where the async
 * Clipboard API refuses.
 *
 * Why this exists: `navigator.clipboard.writeText` rejects with
 * `NotAllowedError: Document is not focused` whenever the browser doesn't
 * consider the page focused at the moment of the click — which happens far more
 * often than it sounds (devtools open, a click that lands while the window is
 * regaining focus, an iframe/extension holding focus, Safari being strict about
 * the user-gesture window). Every call site used to swallow that rejection into
 * a `console.error`, so the user saw a perfectly normal button do nothing at
 * all. That is the "sometimes the buttons just don't work" report.
 *
 * The fallback is the old `execCommand("copy")` path: deprecated, but still
 * implemented everywhere and — crucially — synchronous, so it works inside the
 * user gesture even when the async API bails.
 *
 * Returns whether the text made it to the clipboard, so callers can tell the
 * user when it genuinely failed instead of failing silently.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (!text) return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (err) {
    console.warn("[copy-to-clipboard] clipboard API refused, falling back", err)
  }

  // Fallback — off-screen textarea + execCommand. `readonly` + a fixed
  // off-viewport position keeps iOS from scrolling to (or zooming into) the
  // node before we select it.
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "-9999px"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch (err) {
    console.error("[copy-to-clipboard] fallback failed", err)
    return false
  }
}
