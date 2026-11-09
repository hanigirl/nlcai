"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { canUseDescription, canUseFormatCards, canUseFormatGap, canUseMultinetwork, canUsePreview, canUseScheduleAllA, canUseScheduling } from "@/lib/scheduling-access"
import { canCopyStructure, canTalkingHeadAi, canPlaceRefs } from "@/lib/feature-access"

/** null while the session is read, then true/false. */
export function useSchedulingAccess(): boolean | null {
  return useEmailGate(canUseScheduling)
}

/** The new format cards + tabbed panel — Hani + Nataliya (FORMAT_CARDS_EMAILS). */
export function useFormatCards(): boolean | null {
  return useEmailGate(canUseFormatCards)
}

/** The one-row schedule-all (direction A) — Hani only for now. */
export function useScheduleAllA(): boolean | null {
  return useEmailGate(canUseScheduleAllA)
}

/** YouTube + LinkedIn as networks — Hani only (see MULTINETWORK_EMAILS). */
/** Days between formats of one core post — Hani only. */
export function useFormatGap(): boolean | null {
  return useEmailGate(canUseFormatGap)
}

export function useMultinetwork(): boolean | null {
  return useEmailGate(canUseMultinetwork)
}

/** Attached images go INTO the first generation — Hani only (lib/feature-access). */
export function useRefPlace(): boolean | null {
  return useEmailGate(canPlaceRefs)
}

/** Talking head AI edit + cover on request (lib/feature-access). */
export function useTalkingHeadAi(): boolean | null {
  return useEmailGate(canTalkingHeadAi)
}

/** "תעשה לי כזה" — copy another carousel's structure (lib/feature-access). */
export function useCopyStructure(): boolean | null {
  return useEmailGate(canCopyStructure)
}

/** תיאור הפוסט apart from the script — Hani only (DESCRIPTION_EMAILS). */
export function useDescriptionAccess(): boolean | null {
  return useEmailGate(canUseDescription)
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
        // No user read (a session hiccup) is "unknown", not "not allowed" — a
        // false here let the automatic talking-head cover run for Hani
        // (2026-11-08). Gated features treat null as off anyway.
        if (!cancelled) setOn(data.user?.email ? allowed(data.user.email) : null)
      })
      .catch(() => {
        if (!cancelled) setOn(null)
      })
    return () => {
      cancelled = true
    }
  }, [allowed])
  return on
}
