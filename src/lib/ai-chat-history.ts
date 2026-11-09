"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"

/**
 * The AI edit conversations, kept for good (Hani, 2026-11-09) — the
 * ai_chat_threads table (migration 044). lib/ai-chat-session-store stays the
 * live copy; this is where it is saved and loaded from:
 *   • the current conversation of a panel is saved as she talks, so another
 *     device or a closed tab opens on it;
 *   • "שיחה חדשה" archives it, and the panel's archive brings it back;
 *   • screenshots in her messages are uploaded to her user-media folder
 *     (ai-chat/) and saved as URLs, so a row stays small.
 *
 * Only real posts are saved (the key's post segment is a uuid): a draft's
 * conversation is saved once moveChat gives it the post's key, and the /test
 * state pages never write.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Session = { messages: any[]; input: string; busy: boolean; extra: any }

export interface ArchivedChat {
  id: string
  /** Her first words in it — the archive's label. */
  title: string
  updatedAt: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Saved only for a real post's panel. */
export function isPersistedKey(key: string): boolean {
  const post = key.split(":")[1]
  return !!post && UUID.test(post)
}

// ai_chat_threads isn't in the generated types yet: an untyped handle.
let client: SupabaseClient | null = null
const db = () => (client ??= createClient() as unknown as SupabaseClient)

let userIdPromise: Promise<string | null> | null = null
function userId(): Promise<string | null> {
  userIdPromise ??= getCurrentUser(db())
    .then(({ data }) => data.user?.id ?? null)
    .catch(() => null)
  return userIdPromise.then((id) => {
    if (!id) userIdPromise = null // not signed in yet — ask again next time
    return id
  })
}

/** The current conversation's row id, per key (undefined = not looked up yet). */
const activeId = new Map<string, string | null>()

/** One thing at a time per key: save, archive, restore, move. */
const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(job, job)
  queues.set(key, next.catch(() => undefined))
  return next
}

const hasHerWords = (s: Session | null) => !!s?.messages?.some((m) => m?.role === "user")

// ── Screenshots → her storage ─────────────────────────────────────────────

const uploaded = new Map<string, Promise<string | null>>()

async function uploadDataUrl(uid: string, dataUrl: string): Promise<string | null> {
  const known = uploaded.get(dataUrl)
  if (known) return known
  const job = (async () => {
    try {
      const m = /^data:image\/(png|jpeg|webp|gif);base64,/.exec(dataUrl)
      if (!m) return null
      const blob = await (await fetch(dataUrl)).blob()
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
      const hash = Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("")
      const path = `${uid}/ai-chat/${hash}.${m[1] === "jpeg" ? "jpg" : m[1]}`
      const { error } = await db().storage.from("user-media").upload(path, blob, { upsert: true, contentType: blob.type })
      if (error) return null
      return db().storage.from("user-media").getPublicUrl(path).data.publicUrl
    } catch {
      return null
    }
  })()
  uploaded.set(dataUrl, job)
  const url = await job
  if (!url) uploaded.delete(dataUrl)
  return url
}

/** The messages as saved: every attached picture is a URL in her storage. */
async function withStoredImages(uid: string, messages: Session["messages"]) {
  return Promise.all(
    messages.map(async (m) => {
      if (!Array.isArray(m?.images) || !m.images.some((i: unknown) => typeof i === "string" && i.startsWith("data:")))
        return m
      const images = await Promise.all(
        m.images.map(async (i: string) => (i.startsWith("data:") ? ((await uploadDataUrl(uid, i)) ?? null) : i)),
      )
      return { ...m, images: images.filter(Boolean) }
    }),
  )
}

// ── Load ──────────────────────────────────────────────────────────────────

/** The current conversation saved for this key, or null. */
export function loadChat(key: string): Promise<Session | null> {
  if (!isPersistedKey(key)) return Promise.resolve(null)
  return enqueue(key, async () => {
    const uid = await userId()
    if (!uid) return null
    const { data, error } = await db()
      .from("ai_chat_threads")
      .select("id, messages, extra")
      .eq("user_id", uid)
      .eq("chat_key", key)
      .is("archived_at", null)
      .maybeSingle()
    if (error) return null
    activeId.set(key, data?.id ?? null)
    if (!data || !Array.isArray(data.messages)) return null
    return { messages: data.messages, input: "", busy: false, extra: data.extra ?? {} }
  })
}

// ── Save (debounced) ──────────────────────────────────────────────────────

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const latest = new Map<string, Session>()

async function save(key: string, s: Session) {
  if (!hasHerWords(s)) return
  const uid = await userId()
  if (!uid) return
  const messages = await withStoredImages(uid, s.messages)
  // __busy: a request was running — if the page goes before it lands, the
  // next load says it stopped (lib/ai-chat-session-store withInterruptedNotice).
  const row = { messages, extra: { ...(s.extra ?? {}), __busy: !!s.busy }, updated_at: new Date().toISOString() }
  let id = activeId.get(key)
  if (id === undefined) {
    const { data } = await db()
      .from("ai_chat_threads")
      .select("id")
      .eq("user_id", uid)
      .eq("chat_key", key)
      .is("archived_at", null)
      .maybeSingle()
    id = data?.id ?? null
  }
  if (id) {
    await db().from("ai_chat_threads").update(row).eq("id", id)
  } else {
    const { data, error } = await db()
      .from("ai_chat_threads")
      .insert({ ...row, user_id: uid, chat_key: key })
      .select("id")
      .single()
    if (error) {
      // Another tab started it first — write into that one.
      const { data: other } = await db()
        .from("ai_chat_threads")
        .select("id")
        .eq("user_id", uid)
        .eq("chat_key", key)
        .is("archived_at", null)
        .maybeSingle()
      if (other?.id) {
        await db().from("ai_chat_threads").update(row).eq("id", other.id)
        id = other.id
      }
    } else id = data.id
  }
  activeId.set(key, id ?? null)
}

/** Save soon — called on every change; the last one in a burst wins. */
export function scheduleSave(key: string, s: Session) {
  if (!isPersistedKey(key) || !hasHerWords(s)) return
  latest.set(key, s)
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void flush(key)
    }, 1200),
  )
}

function flush(key: string): Promise<void> {
  clearTimeout(timers.get(key))
  timers.delete(key)
  const s = latest.get(key)
  latest.delete(key)
  if (!s) return enqueue(key, async () => {})
  return enqueue(key, () => save(key, s).catch(() => undefined))
}

// Leaving the page: send what's waiting.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const key of [...timers.keys()]) void flush(key)
  })
}

// ── "שיחה חדשה", the archive ──────────────────────────────────────────────

/** "שיחה חדשה": the current conversation goes to the archive. */
export function archiveChat(key: string, s: Session | null): Promise<void> {
  if (!isPersistedKey(key)) return Promise.resolve()
  if (s && hasHerWords(s)) latest.set(key, s)
  void flush(key)
  return enqueue(key, async () => {
    const uid = await userId()
    if (!uid) return
    await db()
      .from("ai_chat_threads")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", uid)
      .eq("chat_key", key)
      .is("archived_at", null)
    activeId.set(key, null)
    notifyArchive(key)
  })
}

/** Earlier conversations of this panel, newest first. */
export async function listArchived(key: string): Promise<ArchivedChat[]> {
  if (!isPersistedKey(key)) return []
  const uid = await userId()
  if (!uid) return []
  const { data, error } = await db()
    .from("ai_chat_threads")
    .select("id, messages, updated_at")
    .eq("user_id", uid)
    .eq("chat_key", key)
    .not("archived_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50)
  if (error || !data) return []
  return data.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = (r.messages as any[]).find((m) => m?.role === "user")
    const text = typeof first?.content === "string" ? first.content.trim() : ""
    return { id: r.id, title: text || "צילומי מסך", updatedAt: r.updated_at }
  })
}

/**
 * Bring an archived conversation back: it becomes the panel's current one,
 * and the one on screen (if she said anything in it) takes its place in the
 * archive. Resolves with the conversation to show.
 */
export function restoreChat(key: string, id: string, current: Session | null): Promise<Session | null> {
  if (current && hasHerWords(current)) latest.set(key, current)
  void flush(key)
  return enqueue(key, async () => {
    const uid = await userId()
    if (!uid) return null
    const now = new Date().toISOString()
    await db()
      .from("ai_chat_threads")
      .update({ archived_at: now })
      .eq("user_id", uid)
      .eq("chat_key", key)
      .is("archived_at", null)
    const { data, error } = await db()
      .from("ai_chat_threads")
      .update({ archived_at: null, updated_at: now })
      .eq("id", id)
      .select("id, messages, extra")
      .single()
    notifyArchive(key)
    if (error || !data) {
      activeId.set(key, null)
      return null
    }
    activeId.set(key, data.id)
    return { messages: data.messages, input: "", busy: false, extra: data.extra ?? {} }
  })
}

// The archive button re-reads its list when a conversation is archived/restored.
const archiveListeners = new Set<(key: string) => void>()
function notifyArchive(key: string) {
  archiveListeners.forEach((l) => l(key))
}
export function onArchiveChanged(fn: (key: string) => void): () => void {
  archiveListeners.add(fn)
  return () => {
    archiveListeners.delete(fn)
  }
}
