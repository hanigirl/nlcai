"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { isChatWatched, onChatWatched } from "@/lib/ai-chat-session-store"

/**
 * "אם ה-AI ענה לי אני רוצה שיהיה לזה אינדיקציה, פשוט תפתח את הפאנל עם מה
 * שה-AI אמר" (Hani, 2026-10-29).
 *
 * A reply that lands while its AI edit panel is closed reopens that panel,
 * if she is still on that post's page (a page registers a revealer for the
 * conversations it can show). If another AI panel is open, it isn't
 * hijacked: a toast with "פתיחה" opens the right one. If she's elsewhere,
 * the conversation is marked unseen (kept in sessionStorage) and opens when
 * she comes back to the post; the leave-screen toast covers the meantime.
 * Opening a panel only shows the conversation: nothing is sent, no media changes.
 */

export interface ChatRevealer {
  /** This page can show that conversation. */
  owns: (key: string) => boolean
  /** "open": nothing else is open, go; "busy": another AI panel is open; "wait": not ready yet (loading). */
  state: (key: string) => "open" | "busy" | "wait"
  /** Open the panel on that conversation. */
  open: (key: string) => void
}

const UNSEEN_KEY = "ai-chat:v1:unseen"
const revealers = new Set<ChatRevealer>()

function readUnseen(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(UNSEEN_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []
  } catch {
    return []
  }
}

function writeUnseen(list: string[]) {
  if (typeof window === "undefined") return
  try {
    if (list.length) window.sessionStorage.setItem(UNSEEN_KEY, JSON.stringify(list.slice(-20)))
    else window.sessionStorage.removeItem(UNSEEN_KEY)
  } catch {
    /* storage disabled — it just won't reopen later */
  }
}

function markSeen(key: string) {
  const list = readUnseen()
  if (list.includes(key)) writeUnseen(list.filter((k) => k !== key))
}

// She opened it herself — nothing left to show.
if (typeof window !== "undefined") onChatWatched(markSeen)

/** A page on this conversation's post is mounted (so the leave-screen toast isn't needed). */
export function canRevealChat(key: string): boolean {
  for (const r of revealers) if (r.owns(key)) return true
  return false
}

/**
 * A reply landed in `key`. `title` is the toast line when another panel is
 * open (the panel can't open on top of it).
 */
export function revealChatReply(key: string, title: string) {
  if (isChatWatched(key)) return
  const r = [...revealers].find((x) => x.owns(key))
  const state = r?.state(key)
  if (r && state === "open") {
    r.open(key)
    return
  }
  if (r && state === "busy") {
    toast.success(title, {
      duration: 12000,
      action: {
        label: "פתיחה",
        onClick: () => {
          // The page may be gone by now; then it opens when she's back.
          if (revealers.has(r)) r.open(key)
        },
      },
    })
    return
  }
  const list = readUnseen()
  if (!list.includes(key)) writeUnseen([...list, key])
}

/** Open the first unseen conversation this page can show, when it's free. */
function flush(r: ChatRevealer) {
  const key = readUnseen().find((k) => r.owns(k))
  if (!key || isChatWatched(key) || r.state(key) !== "open") return
  markSeen(key)
  r.open(key)
}

/**
 * A page that shows AI edit panels: which conversations it can reopen and
 * how. Re-checked after every render, so an unseen reply opens once the page
 * has loaded and no other panel is open.
 */
export function useChatRevealer(r: ChatRevealer) {
  const ref = useRef(r)
  useEffect(() => {
    ref.current = r
  })
  const proxy = useRef<ChatRevealer | null>(null)
  useEffect(() => {
    const p: ChatRevealer = {
      owns: (k) => ref.current.owns(k),
      state: (k) => ref.current.state(k),
      open: (k) => ref.current.open(k),
    }
    proxy.current = p
    revealers.add(p)
    return () => {
      revealers.delete(p)
      proxy.current = null
    }
  }, [])
  useEffect(() => {
    if (proxy.current) flush(proxy.current)
  })
}
