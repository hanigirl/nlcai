"use client"

/**
 * Who sees the launch intro, and what they've already acknowledged.
 *
 * Real mode (shipped behaviour): kept per user in Supabase auth
 * `user_metadata.launch_intro` — the same store the app already uses for
 * `welcome_seen` (app/welcome). Per user, survives devices, no migration.
 * A localStorage copy (user-scoped) paints the right state before the
 * session answers, and keeps a write that's in flight from flashing back.
 *
 * Review mode (`?launch=preview` on any real page, LAUNCH_REVIEW_EMAILS only):
 * shows everything as a first-visit-after-launch user would see it, ignoring
 * the launch date, and keeps the "seen" state in sessionStorage only —
 * nothing is written to the account. `?walkthrough=reset` replays the
 * walkthrough, `&demo=sample` puts a sample video on every feature,
 * `?launch=off` leaves review mode. For anyone else the params do nothing.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { userKey } from "@/lib/user-scoped-storage"
import {
  canReviewLaunch,
  LAUNCH_FOR_EVERYONE,
  EMPTY_LAUNCH_STATE,
  isInNoteWindow,
  isLaunched,
  readLaunchState,
  type LaunchFeatureId,
  type LaunchIntroState,
} from "@/lib/launch-features"

const REVIEW_KEY = "launch-intro-review"
const LOCAL_KEY = "launch-intro"

interface Snapshot {
  ready: boolean
  review: boolean
  /** Notes visible (launched, inside the 14-day window). */
  notesOn: boolean
  /** Walkthrough may run. */
  tourOn: boolean
  state: LaunchIntroState
  userId: string | null
}

let snap: Snapshot = {
  ready: false,
  review: false,
  notesOn: false,
  tourOn: false,
  state: EMPTY_LAUNCH_STATE,
  userId: null,
}
const listeners = new Set<() => void>()
function emit(next: Partial<Snapshot>) {
  snap = { ...snap, ...next }
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function safeGet(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}
function safeSet(store: Storage | undefined, key: string, value: string | null) {
  try {
    if (value === null) store?.removeItem(key)
    else store?.setItem(key, value)
  } catch {
    /* private mode — the state just won't stick */
  }
}

function derive(state: LaunchIntroState, review: boolean) {
  const now = new Date()
  const live = review || (isLaunched(now) && isInNoteWindow(state.firstVisitAt, now))
  return { notesOn: live, tourOn: live && !state.skipped }
}

let started = false

/** Reads the URL + the user once per page load. Safe to call from many places. */
function init() {
  if (started || typeof window === "undefined") return
  started = true

  const params = new URLSearchParams(window.location.search)
  const raw = params.get("launch")
  const session = typeof sessionStorage === "undefined" ? undefined : sessionStorage

  const supabase = createClient()
  getCurrentUser(supabase).then(({ data: { user } }) => {
    if (!user) return

    // Review mode — for the review list only; the params do nothing for anyone else.
    if (canReviewLaunch(user.email)) {
      let review: { state: LaunchIntroState } | null = null
      const stored = safeGet(session, REVIEW_KEY)
      if (stored) {
        try {
          review = JSON.parse(stored)
        } catch {
          review = null
        }
      }
      if (raw === "preview") review = { state: review?.state ?? EMPTY_LAUNCH_STATE }
      else if (raw === "off") {
        review = null
        safeSet(session, REVIEW_KEY, null)
      }
      if (review && params.get("walkthrough") === "reset") review = { state: EMPTY_LAUNCH_STATE }
      if (review) {
        safeSet(session, REVIEW_KEY, JSON.stringify(review))
        emit({ ready: true, review: true, userId: user.id, state: review.state, ...derive(review.state, true) })
        return
      }
    }

    // Before the launch push only the review list gets the real thing.
    if (!LAUNCH_FOR_EVERYONE && !canReviewLaunch(user.email)) {
      emit({ ready: true, review: false, userId: user.id, state: EMPTY_LAUNCH_STATE, notesOn: false, tourOn: false })
      return
    }

    const local = safeGet(localStorage, userKey(LOCAL_KEY, user.id))
    let state = readLaunchState(user.user_metadata)
    if (local) {
      // The local copy can be ahead of a session that hasn't refreshed yet.
      try {
        const l = readLaunchState({ launch_intro: JSON.parse(local) })
        state = {
          firstVisitAt: state.firstVisitAt ?? l.firstVisitAt,
          seen: Array.from(new Set([...state.seen, ...l.seen])),
          skipped: state.skipped || l.skipped,
        }
      } catch {
        /* a broken local copy — the account's copy stands */
      }
    }
    if (isLaunched() && !state.firstVisitAt) {
      state = { ...state, firstVisitAt: new Date().toISOString() }
      persist(user.id, state)
    }
    emit({ ready: true, review: false, userId: user.id, state, ...derive(state, false) })
  })
}

function persist(userId: string | null, state: LaunchIntroState) {
  if (snap.review) {
    const session = typeof sessionStorage === "undefined" ? undefined : sessionStorage
    safeSet(session, REVIEW_KEY, JSON.stringify({ state }))
    return
  }
  if (!userId) return
  safeSet(localStorage, userKey(LOCAL_KEY, userId), JSON.stringify(state))
  void createClient()
    .auth.updateUser({ data: { launch_intro: state } })
    .catch(() => {
      /* the local copy still holds it; the next visit retries */
    })
}

export function useLaunchIntro() {
  useEffect(init, [])
  const s = useSyncExternalStore(subscribe, () => snap, () => snap)

  const markSeen = useCallback((ids: LaunchFeatureId | LaunchFeatureId[]) => {
    const fresh = (Array.isArray(ids) ? ids : [ids]).filter((id) => !snap.state.seen.includes(id))
    if (!fresh.length) return
    const state = { ...snap.state, seen: [...snap.state.seen, ...fresh] }
    emit({ state })
    persist(snap.userId, state)
  }, [])

  const skipAll = useCallback(() => {
    const state = { ...snap.state, skipped: true }
    emit({ state, ...derive(state, snap.review) })
    persist(snap.userId, state)
  }, [])

  return { ...s, markSeen, skipAll }
}
