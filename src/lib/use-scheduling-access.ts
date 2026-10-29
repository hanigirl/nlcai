"use client"

import { useEffect, useState } from "react"
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

/** The scheduling changes still in trial — Hani only (see PREVIEW_EMAILS). */
export function useSchedulingPreview(): boolean | null {
  return useEmailGate(canUsePreview)
}

/**
 * The 2026-10-29 batch was tried on Hani's account, then opened to everyone
 * the same day. These stay as always-on switches until the old code paths
 * behind them are removed.
 */
export function usePreviewAccess(): boolean | null {
  return true
}
export function previewAccessNow(): boolean {
  return true
}
export function usePreviewAccessShared(): boolean {
  return true
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
