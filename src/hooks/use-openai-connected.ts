"use client"

import { useEffect, useState } from "react"

// Only the POSITIVE answer is cached across mounts. "Not connected" is the
// answer the user is actively trying to change — she's on her way to Settings
// to paste a key — so we re-ask every time the panel mounts until it flips,
// while a connected user pays for the round-trip once per page load.
let connectedOnce = false

/**
 * Whether the panel should behave as if OpenAI is connected. `null` = still
 * asking.
 *
 * Not a pure "does a key exist" answer: the route reports `true` for anyone
 * outside the single-reviewer preview cohort, so their panel keeps the exact
 * pre-feature behaviour and no call site needs its own gate.
 *
 * Fails OPEN: if the status check itself errors we report "connected" so the
 * AI path stays available. A real generation attempt then returns the proper
 * `openai_not_connected` message — better than hiding the feature because our
 * own probe hiccuped.
 */
export function useOpenAiConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(
    connectedOnce ? true : null,
  )

  useEffect(() => {
    if (connectedOnce) return
    let cancelled = false

    fetch("/api/connections/openai")
      .then((r) => (r.ok ? r.json() : { connected: true }))
      .then((d: { connected?: boolean }) => {
        if (cancelled) return
        const value = d.connected !== false
        if (value) connectedOnce = true
        setConnected(value)
      })
      .catch(() => {
        if (!cancelled) setConnected(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return connected
}
