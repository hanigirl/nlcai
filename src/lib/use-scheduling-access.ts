"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { canUseScheduleAllA, canUseScheduling } from "@/lib/scheduling-access"

/** null while the session is read, then true/false. */
export function useSchedulingAccess(): boolean | null {
  return useEmailGate(canUseScheduling)
}

/** The one-row schedule-all (direction A) — Hani only for now. */
export function useScheduleAllA(): boolean | null {
  return useEmailGate(canUseScheduleAllA)
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
