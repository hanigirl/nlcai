"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { canUseScheduling } from "@/lib/scheduling-access"

/** null while the session is read, then true/false. */
export function useSchedulingAccess(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    getCurrentUser(createClient())
      .then(({ data }) => {
        if (!cancelled) setOn(canUseScheduling(data.user?.email))
      })
      .catch(() => {
        if (!cancelled) setOn(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return on
}
