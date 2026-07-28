"use client"

import { useEffect } from "react"
import { syncScheduledFromServer } from "@/lib/timing-storage"

/**
 * Pulls the calendar down from the server into the local cache that every
 * timing consumer reads synchronously.
 *
 * Mounted once in the app shell, so any surface that shows scheduling state
 * (calendar, queue panel, core-post sheet, format chips) starts from the
 * server's copy rather than whatever this browser happened to have. Re-runs
 * on focus: the board is now shared across devices, and coming back to a tab
 * is exactly when it is most likely to be stale.
 *
 * Renders nothing and never blocks — a failed sync leaves the cache alone.
 */
export function TimingSync() {
  useEffect(() => {
    void syncScheduledFromServer()

    const onFocus = () => void syncScheduledFromServer()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  return null
}
