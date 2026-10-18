"use client"

/**
 * One answer to "is Instagram connected?", shared by every surface that asks.
 *
 * The badge above the calendar, the settings screen, and the calendar cards
 * ("לא יפורסם — אינסטגרם לא מחובר") all read this store. Connecting in one
 * place updates all of them without a refresh — the store is module-level, so
 * a reconnect done from the calendar's modal turns the settings badge green
 * too, and vice versa.
 *
 * A lapsed (`needs_reconnect`) or revoked connection counts as NOT connected.
 * A connection that has expired is not a connection (Hani, 2026-10-15).
 */

import { useEffect, useSyncExternalStore } from "react"

export type InstagramAccount = {
  id: string
  handle: string | null
  avatarUrl: string | null
  status: "connected" | "needs_reconnect" | "revoked"
  /** Posts currently queued on this account — what a disconnect would cancel. */
  queuedCount?: number
}

export type InstagramConnection = {
  /**
   *   loading      — first answer not in yet. Show nothing rather than guess.
   *   connected    — at least one live account.
   *   disconnected — none, or only lapsed ones.
   *   unavailable  — the publishing service isn't switched on for this deploy.
   */
  status: "loading" | "connected" | "disconnected" | "unavailable"
  accounts: InstagramAccount[]
  /** The live account, or the lapsed one when that is all there is. */
  primary: InstagramAccount | null
}

let state: InstagramConnection = { status: "loading", accounts: [], primary: null }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let loadedOnce = false

function emit(next: InstagramConnection) {
  state = next
  for (const l of listeners) l()
}

function derive(accounts: InstagramAccount[], ready: boolean): InstagramConnection {
  const live = accounts.find((a) => a.status === "connected") ?? null
  const primary = live ?? accounts.find((a) => a.status !== "revoked") ?? null
  if (live) return { status: "connected", accounts, primary }
  if (!ready && accounts.length === 0) return { status: "unavailable", accounts, primary }
  return { status: "disconnected", accounts, primary }
}

/** Re-read the connection from the server. Deduplicated across callers. */
export function refreshInstagramConnection(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch("/api/social/accounts", { cache: "no-store" })
      if (!res.ok) return
      const json = (await res.json()) as { accounts?: InstagramAccount[]; ready?: boolean }
      emit(derive(json.accounts ?? [], json.ready !== false))
    } catch {
      // Leave the last known answer in place; the next action retries.
    } finally {
      loadedOnce = true
      inflight = null
    }
  })()
  return inflight
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const SERVER_SNAPSHOT: InstagramConnection = { status: "loading", accounts: [], primary: null }

/** The shared connection state. Loads on first use. */
export function useInstagramConnection(): InstagramConnection {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_SNAPSHOT,
  )
  useEffect(() => {
    if (!loadedOnce) void refreshInstagramConnection()
  }, [])
  return snapshot
}
