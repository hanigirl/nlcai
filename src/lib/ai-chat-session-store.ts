"use client"

import { useEffect, useSyncExternalStore } from "react"

/**
 * Module-level memory for the AI edit panels (media AI edit, core post chat,
 * format copy AI) — Hani, 2026-10-29: "אם נסגר לי בטעות הפאנל עריכה אני רוצה
 * שכשאני חוזרת אליו זה יראה לי מה כתבתי פעם אחרונה ואם הוא עוד עובד שאני אראה
 * את זה".
 *
 * Like broll-generation-store / story-generation-store, the conversation lives
 * here and not in the panel component, so:
 *   • closing the panel (X, outside click, Escape) or leaving the screen
 *     inside the app keeps the conversation, the half-typed text and the
 *     "working" state; the request itself keeps running and writes its reply
 *     here, so reopening shows it (or the busy row, if it is still running);
 *   • each conversation is keyed per panel + post + format;
 *   • it is mirrored to sessionStorage, so a reload in the same tab brings
 *     the conversation back too. A reload ends the client side of a running
 *     request, so a restored session is never "busy".
 *
 * A conversation only starts over when she presses "שיחה חדשה" (clearChat).
 * Nothing secret is stored: her words, the AI's replies, and the panel state.
 */

export interface AiChatSession<M, X> {
  messages: M[]
  /** What she typed and didn't send yet. */
  input: string
  /** A request is running for this conversation. */
  busy: boolean
  /** Panel-specific state (reason chips, the working text, the error line...). */
  extra: X
}

const STORAGE_PREFIX = "ai-chat:v1:"
/** Stored copy only: the newest messages per conversation (the first one is kept too — it's the opening line). */
const MAX_STORED_MESSAGES = 30
/** Stored copy only: a conversation bigger than this is not mirrored (memory still has it). */
const MAX_STORED_CHARS = 200_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySession = AiChatSession<any, any>

const sessions = new Map<string, AnySession | null>()
const listeners = new Map<string, Set<() => void>>()
const anyListeners = new Set<() => void>()
let version = 0
/** Keys moved by moveChat: a reply still on its way follows the conversation. */
const moved = new Map<string, string>()

function read(key: string): AnySession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AnySession
    if (!parsed || !Array.isArray(parsed.messages)) return null
    // The request that was running didn't survive the reload.
    return { messages: parsed.messages, input: typeof parsed.input === "string" ? parsed.input : "", busy: false, extra: parsed.extra ?? {} }
  } catch {
    return null
  }
}

function write(key: string, s: AnySession | null) {
  if (typeof window === "undefined") return
  try {
    if (!s) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key)
      return
    }
    const msgs =
      s.messages.length > MAX_STORED_MESSAGES
        ? [s.messages[0], ...s.messages.slice(-(MAX_STORED_MESSAGES - 1))]
        : s.messages
    const raw = JSON.stringify({ messages: msgs, input: s.input, extra: s.extra })
    if (raw.length > MAX_STORED_CHARS) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key)
      return
    }
    window.sessionStorage.setItem(STORAGE_PREFIX + key, raw)
  } catch {
    /* storage full or disabled — memory still has it */
  }
}

function emit(key: string) {
  version++
  const set = listeners.get(key)
  if (set) for (const l of set) l()
  for (const l of anyListeners) l()
}

/** The conversation for `key`, or null if there is none yet. */
export function getChat<M, X>(key: string): AiChatSession<M, X> | null {
  if (!sessions.has(key)) sessions.set(key, read(key))
  return (sessions.get(key) as AiChatSession<M, X> | null) ?? null
}

/**
 * Change a conversation. `init` makes the fresh one when there is none —
 * so a reply that lands after the panel closed still finds its conversation.
 */
export function updateChat<M, X>(
  key: string,
  init: () => AiChatSession<M, X>,
  fn: (s: AiChatSession<M, X>) => AiChatSession<M, X>,
) {
  for (let hops = 0; moved.has(key) && hops < 8; hops++) key = moved.get(key)!
  const next = fn(getChat<M, X>(key) ?? init())
  sessions.set(key, next)
  write(key, next)
  emit(key)
}

/** "שיחה חדשה": forget this conversation. */
export function clearChat(key: string) {
  sessions.set(key, null)
  write(key, null)
  emit(key)
}

/** Move a conversation to a new key (a draft post that just got its id). */
export function moveChat(from: string, to: string) {
  const s = getChat(from)
  if (!s || getChat(to)) return
  sessions.set(to, s)
  write(to, s)
  moved.set(from, to)
  clearChat(from)
}

const subscribers = new Map<string, (cb: () => void) => () => void>()

/** A stable subscribe function per key, so React doesn't resubscribe every render. */
function subscribeKey(key: string) {
  let sub = subscribers.get(key)
  if (!sub) subscribers.set(key, (sub = makeSubscribe(key)))
  return sub
}

function makeSubscribe(key: string) {
  return (cb: () => void) => {
    let set = listeners.get(key)
    if (!set) listeners.set(key, (set = new Set()))
    set.add(cb)
    return () => {
      set!.delete(cb)
    }
  }
}

/** One conversation, live. null until something is said. */
export function useAiChat<M, X>(key: string): AiChatSession<M, X> | null {
  return useSyncExternalStore(
    subscribeKey(key),
    () => getChat<M, X>(key),
    () => null,
  )
}

function subscribeAny(cb: () => void) {
  anyListeners.add(cb)
  return () => {
    anyListeners.delete(cb)
  }
}

/** Re-render on any conversation change (a panel that manages several keys). */
export function useAiChatVersion(): number {
  return useSyncExternalStore(subscribeAny, () => version, () => 0)
}

/** How many open panels show each conversation. */
const watching = new Map<string, number>()

/** Is a panel showing this conversation right now? (For the leave-screen toast.) */
export function isChatWatched(key: string): boolean {
  return (watching.get(key) ?? 0) > 0
}

/** Call from a mounted panel: it shows `key` while mounted. */
export function useWatchChat(key: string) {
  useEffect(() => {
    watching.set(key, (watching.get(key) ?? 0) + 1)
    return () => {
      const n = (watching.get(key) ?? 1) - 1
      if (n > 0) watching.set(key, n)
      else watching.delete(key)
    }
  }, [key])
}
