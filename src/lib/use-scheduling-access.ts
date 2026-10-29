"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { canUsePreview, canUseScheduleAllA, canUseScheduling } from "@/lib/scheduling-access"

/** null while the session is read, then true/false. */
export function useSchedulingAccess(): boolean | null {
  return useEmailGate(canUseScheduling)
}

/** The one-row schedule-all (direction A) — Hani only for now. */
export function useScheduleAllA(): boolean | null {
  return useEmailGate(canUseScheduleAllA)
}

/** Today's batch (2026-10-29) — Hani only while she tries it. */
export function usePreviewAccess(): boolean | null {
  const on = useEmailGate(canUsePreview)
  // Fill the shared cache too, so a store's first toast already knows.
  useEffect(() => {
    if (on !== null) setPreviewNow(on)
  }, [on])
  return on
}

/**
 * The same gate for code outside React (the generation stores' toasts) and
 * for small components drawn many times (Drive thumbnails), which share one
 * session read instead of one each. False until it's known, so anything
 * that runs before the session is read keeps the old behaviour.
 */
let previewNow: boolean | null = null
let previewAsked = false
const previewListeners = new Set<() => void>()
function setPreviewNow(on: boolean) {
  if (previewNow === on) return
  previewNow = on
  previewListeners.forEach((l) => l())
}
export function previewAccessNow(): boolean {
  if (!previewAsked && typeof window !== "undefined") {
    previewAsked = true
    getCurrentUser(createClient())
      .then(({ data }) => setPreviewNow(canUsePreview(data.user?.email)))
      .catch(() => setPreviewNow(false))
  }
  return previewNow === true
}
function subscribePreview(l: () => void) {
  previewListeners.add(l)
  previewAccessNow()
  return () => {
    previewListeners.delete(l)
  }
}
/** Shared-read variant of usePreviewAccess; false while unknown. */
export function usePreviewAccessShared(): boolean {
  return useSyncExternalStore(subscribePreview, () => previewNow === true, () => false)
}

function useEmailGate(allowed: (email: string | null | undefined) => boolean): boolean | null {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    getCurrentUser(createClient())
      .then(({ data }) => {
        if (!cancelled) setOn(allowed(data.user?.email))
      })
      .catch(() => {
        if (!cancelled) setOn(false)
      })
    return () => {
      cancelled = true
    }
  }, [allowed])
  return on
}
