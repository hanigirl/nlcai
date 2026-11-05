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
 *
 * Since 2026-11-05 the same store holds YouTube and LinkedIn too: one fetch,
 * one answer per network. `useInstagramConnection` keeps its old meaning
 * (Instagram only) so a connected YouTube never turns the Instagram badge
 * green; `useSocialConnections` answers for every network.
 */

import { useEffect, useSyncExternalStore } from "react"
import type { SocialPlatform } from "@/lib/supabase/types"

export type InstagramAccount = {
  id: string
  /** Which network. Missing on a pre-042 server answer — read as Instagram. */
  platform?: SocialPlatform
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

/** Same shape for every network. */
export type SocialConnection = InstagramConnection
export type SocialConnections = Record<SocialPlatform, SocialConnection>

const LOADING: InstagramConnection = { status: "loading", accounts: [], primary: null }
const ALL_LOADING: SocialConnections = { instagram: LOADING, youtube: LOADING, linkedin: LOADING }

let state: SocialConnections = ALL_LOADING
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let loadedOnce = false

function emit(next: SocialConnections) {
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
      const all = json.accounts ?? []
      const ready = json.ready !== false
      const of = (p: SocialPlatform) => all.filter((a) => (a.platform ?? "instagram") === p)
      emit({
        instagram: derive(of("instagram"), ready),
        youtube: derive(of("youtube"), ready),
        linkedin: derive(of("linkedin"), ready),
      })
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

/** Every network's connection. Loads on first use. */
export function useSocialConnections(): SocialConnections {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => ALL_LOADING,
  )
  useEffect(() => {
    if (!loadedOnce) void refreshInstagramConnection()
  }, [])
  return snapshot
}

/** Instagram's connection — the store's original meaning, unchanged. */
export function useInstagramConnection(): InstagramConnection {
  return useSocialConnections().instagram
}

/** Alias that reads right at call sites that aren't about Instagram. */
export const refreshSocialConnections = refreshInstagramConnection
