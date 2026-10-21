"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Check, Loader2, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { startBRollEdit } from "@/lib/broll-generation-store"

/** A clip the Opus engine made — only those have a composition to edit. */
export function isEditableBRollUrl(url: string | null | undefined): boolean {
  return !!url && /\/b_roll\/[0-9a-f-]{36}\.mp4(?:[?#].*)?$/i.test(url)
}

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** Assistant turn that landed a new clip. */
  done?: boolean
  error?: boolean
}

const INTRO: ChatMessage = {
  role: "assistant",
  content: "מה לשנות בבי-רול? למשל גודל הכותרת, צבעים, איך המילים נכנסות או התזמון. אעדכן את האנימציה והסרטון יתחלף בכרטיס.",
}

/**
 * "עריכת בי-רול עם AI" (Hani, 2026-10-22) — the same floating side panel as
 * the core post's "עריכת פוסט ליבה" (CorePostChat): her instruction in, Opus
 * revises the animation, the new clip replaces the one on the result card.
 * Each turn builds on the last (the server keeps the edits with the clip).
 *
 * Unlike the core post there's nothing to preview-then-keep: a revision is a
 * new rendered clip, already saved. To go back she deletes and regenerates,
 * or asks for the change to be undone.
 *
 * Fixed-position sibling of the canvas, like CorePostChat, so pan/zoom don't
 * move it.
 */
export function BRollAiChat({
  postId,
  open,
  onOpenChange,
}: {
  postId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: text }])
    setLoading(true)
    const result = await startBRollEdit(postId, text, { quiet: true })
    setLoading(false)
    setMessages((prev) => [
      ...prev,
      result.ok
        ? { role: "assistant", content: "עדכנתי את הבי-רול. הסרטון החדש מופיע בכרטיס.", done: true }
        : { role: "assistant", content: result.message || "העריכה לא הצליחה. נסו שוב.", error: true },
    ])
  }

  if (!open) return null

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="עריכת בי-רול עם AI"
      className="fixed bottom-6 right-6 z-40 flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <Sparkles className="size-4 text-yellow-40" aria-hidden />
        <span className="text-small-bold text-text-primary-default">עריכת בי-רול עם AI</span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="סגירה"
          className="ms-auto inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-bg-surface-hover hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-start" : "items-end"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-small leading-relaxed ${
                m.role === "user"
                  ? "bg-bg-surface-primary-default text-text-primary-default rounded-ss-sm"
                  : m.error
                    ? "bg-bg-surface text-button-destructive-default rounded-se-sm"
                    : "bg-bg-surface text-text-primary-default rounded-se-sm"
              }`}
            >
              {m.content}
            </div>
            {m.done && (
              <span className="inline-flex items-center gap-1 text-xs-body text-text-neutral-default">
                <Check className="size-3.5 text-yellow-30" />
                הוחל על הבי-רול
              </span>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-small text-text-neutral-default">
            <Loader2 className="size-4 animate-spin text-yellow-50" />
            <span>מעדכנים את הבי-רול... זה לוקח כדקה</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-neutral-default p-3">
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-2 focus-within:border-yellow-50 transition-colors">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="מה תרצו לשנות?"
            rows={1}
            autoFocus
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent p-1 text-small shadow-none focus-visible:ring-0"
          />
          <Button
            size="icon-sm"
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            aria-label="שליחה"
            className="shrink-0 rounded-full"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
