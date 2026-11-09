"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, Loader2, X } from "lucide-react"
import { BidiText } from "@/components/bidi-text"
import { AiSparkle } from "@/components/ai-refine-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/ui/chip"
import { AiChatNewButton } from "@/components/ai-chat-new-button"
import { AI_ERROR_BOX } from "@/lib/ai-error-message"
import {
  ReferenceButton,
  ReferenceDropHint,
  ReferenceThumbs,
  ReferenceTray,
  useReferenceImages,
} from "@/components/ai-edit-reference"

/**
 * The AI edit chat as an agent (Hani, 2026-11-10 — lib/edit-agent): the
 * conversation lives on the server, and so does the work. This panel only
 * shows it — the messages, the step the run is on, and a question's buttons —
 * and reads it back on open, so a reload or another device picks up exactly
 * where it was. B-roll first.
 *
 * Her own media from Drive never reaches it (iron rule): the entry isn't
 * offered on it, and the server refuses it anyway.
 */

type Msg = {
  role: "user" | "assistant"
  text: string
  images?: string[]
  options?: { label: string; action: string }[]
  error?: boolean
}
type Job = { id: string; status: "running" | "asking" | "done" | "failed"; progress: string; outcome?: { url?: string; changed?: boolean } | null }

const GREETING =
  "היי, אני כאן בשביל הבי-רול. אפשר לבקש שינויים בעיצוב, בתנועה או ברקע, לשלב תמונה שלכם או רפרנס, או פשוט לשאול למה משהו נראה כמו שהוא נראה."

export const EDIT_AGENT_STARTED = "edit-agent:started"

/**
 * Follows the agent's run from the PAGE, so the new version lands even when
 * the chat is closed while it renders. Before this, closing the chat stopped
 * the polling, and the result only showed after a reload (Hani, 2026-11-10:
 * "תקוע אפילו 5 דקות... רק כשאני מרפרשת אני רואה אותו").
 */
export function useFollowEditAgentRun(
  postId: string | null,
  format: string,
  enabled: boolean,
  onMediaChanged: (url: string) => void,
) {
  const [runningId, setRunningId] = useState<string | null>(null)
  const applyRef = useRef(onMediaChanged)
  applyRef.current = onMediaChanged

  const check = useCallback(async () => {
    if (!enabled || !postId) return
    const res = await fetch(`/api/edit-agent?postId=${postId}&format=${format}`, { cache: "no-store" }).catch(() => null)
    if (!res?.ok) return
    const { job } = (await res.json()) as { job: Job | null }
    if (!job) return
    if (job.status === "running") return setRunningId(job.id)
    setRunningId((prev) => {
      // Only the run we watched finish — never an old result on page load.
      if (prev === job.id && job.outcome?.changed && job.outcome.url) applyRef.current(job.outcome.url)
      return null
    })
  }, [enabled, postId, format])

  // On load (a run may already be going), on return to the tab, and when the chat starts one.
  useEffect(() => {
    void check()
    const onStart = (e: Event) => {
      const d = (e as CustomEvent<{ postId: string; format: string }>).detail
      if (d?.postId === postId && d.format === format) void check()
    }
    const onFocus = () => void check()
    window.addEventListener(EDIT_AGENT_STARTED, onStart)
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener(EDIT_AGENT_STARTED, onStart)
      window.removeEventListener("focus", onFocus)
    }
  }, [check, postId, format])

  useEffect(() => {
    if (!runningId) return
    const t = setInterval(() => void check(), 3000)
    return () => clearInterval(t)
  }, [runningId, check])
}

export function EditAgentChat({
  postId,
  format,
  onClose,
  onMediaChanged,
}: {
  postId: string
  format: "b_roll"
  onClose: () => void
  /** The run saved a new version — the card and the panel show it. */
  onMediaChanged: (url: string) => void
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const refs = useReferenceImages()
  const scrollRef = useRef<HTMLDivElement>(null)
  const seenJob = useRef<string | null>(null)

  const busy = sending || job?.status === "running"

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/edit-agent?postId=${postId}&format=${format}`, { cache: "no-store" }).catch(() => null)
    if (!res?.ok) return
    const data = (await res.json()) as { messages: Msg[]; job: Job | null }
    setMessages(data.messages ?? [])
    setJob(data.job)
    setLoaded(true)
    // A run that just finished with a new version: show it everywhere.
    const j = data.job
    if (j && j.status !== "running" && seenJob.current !== j.id) {
      seenJob.current = j.id
      if (j.outcome?.changed && j.outcome.url) onMediaChanged(j.outcome.url)
    }
  }, [postId, format, onMediaChanged])

  // Read it on open — and remember which finished run was already shown.
  useEffect(() => {
    let first = true
    void (async () => {
      const res = await fetch(`/api/edit-agent?postId=${postId}&format=${format}`, { cache: "no-store" }).catch(() => null)
      if (!res?.ok) return setLoaded(true)
      const data = (await res.json()) as { messages: Msg[]; job: Job | null }
      if (!first) return
      setMessages(data.messages ?? [])
      setJob(data.job)
      if (data.job && data.job.status !== "running") seenJob.current = data.job.id
      setLoaded(true)
    })()
    return () => {
      first = false
    }
  }, [postId, format])

  // While a run is going, follow it.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => void refresh(), 2500)
    return () => clearInterval(t)
  }, [busy, refresh])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages.length, job?.progress])

  const send = async (text: string) => {
    const words = text.trim()
    const images = refs.refs
    if ((!words && !images.length) || busy) return
    setSending(true)
    setInput("")
    refs.clear()
    // Shown at once; the server's copy replaces it on the next read.
    setMessages((m) => [...m, { role: "user", text: words, images }])
    try {
      const res = await fetch("/api/edit-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, format, text: words, images }),
      })
      const data = (await res.json().catch(() => ({}))) as { jobId?: string; message?: string }
      if (!res.ok && data.message) {
        setMessages((m) => [...m, { role: "assistant", text: data.message!, error: true }])
      }
      if (data.jobId) window.dispatchEvent(new CustomEvent(EDIT_AGENT_STARTED, { detail: { postId, format } }))
      await refresh()
    } finally {
      setSending(false)
    }
  }

  const startOver = async () => {
    await fetch("/api/edit-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, format, action: "new" }),
    }).catch(() => null)
    setMessages([])
    setJob(null)
  }

  const last = messages[messages.length - 1]
  const askNow = !busy && last?.role === "assistant" && !!last.options?.length

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="עריכה עם AI"
      {...refs.dropProps}
      className="fixed bottom-6 right-6 z-40 flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white shadow-xl dark:bg-gray-10"
    >
      <ReferenceDropHint show={refs.dragging} />
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">עריכה עם AI · בי-רול</span>
        <div className="ms-auto flex items-center gap-1">
          {messages.some((m) => m.role === "user") && <AiChatNewButton disabled={busy} onClick={() => void startOver()} />}
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-gray-95 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 dark:hover:bg-gray-20"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!loaded ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-text-neutral-default" />
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="flex flex-col items-end">
                <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-bg-surface px-3 py-2 text-small leading-relaxed text-text-primary-default">
                  {GREETING}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-start" : "items-end"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-small leading-relaxed ${
                    m.role === "user"
                      ? "rounded-ss-sm bg-bg-surface-primary-default text-text-primary-default"
                      : m.error
                        ? `${AI_ERROR_BOX} rounded-se-sm`
                        : "rounded-se-sm bg-bg-surface text-text-primary-default"
                  }`}
                >
                  {m.text && <BidiText text={m.text} />}
                  <ReferenceThumbs images={m.images} className={m.text ? "mt-1.5" : undefined} />
                </div>
                {askNow && i === messages.length - 1 && (
                  <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5" role="group" aria-label="בחירה">
                    {m.options!.map((o) => (
                      <Chip key={o.label} onClick={() => void send(o.label === o.action ? o.label : `${o.label} (${o.action})`)}>
                        {o.label}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center justify-end gap-2 text-xs-body text-text-neutral-default" role="status">
                <span>{job?.status === "running" && job.progress ? job.progress : "רגע..."}</span>
                <Loader2 className="size-3.5 animate-spin text-yellow-50" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-neutral-default p-3">
        <ReferenceTray r={refs} />
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default bg-white p-2 transition-colors focus-within:border-yellow-50 dark:bg-gray-10">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={refs.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            placeholder={busy ? "אני עובד על זה, אפשר לכתוב כשאסיים" : "מה תרצו לשנות, או לשאול?"}
            rows={1}
            autoFocus
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-small shadow-none focus-visible:ring-0"
          />
          <ReferenceButton r={refs} disabled={busy} />
          <Button
            size="icon-sm"
            onClick={() => void send(input)}
            disabled={(!input.trim() && !refs.refs.length) || busy}
            aria-label="שליחה"
            className="shrink-0 rounded-full"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
