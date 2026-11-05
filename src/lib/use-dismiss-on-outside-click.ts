"use client"

import { useEffect, useRef, type RefObject } from "react"

/**
 * Close a floating panel when she clicks anywhere outside it (Hani,
 * 2026-10-29: the AI edit panels must close on an outside click). Clicks on
 * toasts, on menus portalled out of the panel and on other dialogs don't
 * count, so picking from a dropdown inside the panel never closes it.
 */
export function useDismissOnOutsideClick(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || ref.current?.contains(target)) return
      // A dialog's dimmed backdrop closes that dialog, not the panel under it
      // (the AI panel's "מגוגל דרייב" gallery — 2026-11-06).
      if (target.closest("[data-sonner-toaster], [data-radix-popper-content-wrapper], [role='dialog'], [data-slot='dialog-overlay']")) return
      dismissRef.current()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open, ref])
}
