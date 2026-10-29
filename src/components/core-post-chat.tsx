"use client"

import { useEffect, useRef } from "react"
import { AI_ERROR_BOX, aiErrorMessage } from "@/lib/ai-error-message"
import { CLAUDE_KEY_INVALID_MESSAGE } from "@/lib/claude-credits"
import { X, ArrowUp, Loader2, Check } from "lucide-react"
import { toast } from "sonner"

import { AiSparkle } from "@/components/ai-refine-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDismissOnOutsideClick } from "@/lib/use-dismiss-on-outside-click"
import { usePreviewAccess } from "@/lib/use-scheduling-access"
import { logLearningEdit, type LearningOutcome } from "@/lib/learning-capture"
import { getChat, clearChat, moveChat, updateChat, useAiChat, useWatchChat, type AiChatSession } from "@/lib/ai-chat-session-store"
import { revealChatReply } from "@/lib/ai-chat-reveal"
import { AiChatNewButton } from "@/components/ai-chat-new-button"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** Present on assistant turns — the full revised post being previewed. */
  revisedPost?: string
  /** The post text to restore if this change is canceled. */
  revertTo?: string
  /** Lifecycle of an assistant proposal: previewed → kept / reverted. */
  status?: "pending" | "applied" | "canceled"
  /** Local intro bubble; never sent to the model. */
  seed?: boolean
  /**
   * On assistant turns — the user's verbatim request that produced this
   * revision. Carried so the learning log can record *why* a change was made,
   * not just the resulting diff.
   */
  instruction?: string
  /** Its keep / undo verdict already went to the learning log. */
  logged?: boolean
}

interface CorePostChatProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current core post body — seeds the working version when the chat opens. */
  corePost: string
  /** The hook line, kept fixed as the first line across revisions. */
  hookText?: string
  /**
   * Live-previews text into the core post card. Called with the AI's revised
   * post the moment it arrives (so the user sees it in the workflow card), and
   * again with the previous text if they cancel the change.
   */
  onPreview: (text: string) => void
  /**
   * Reports whether the AI is currently generating a revision, so the parent
   * can animate the core post card (shimmer) while the user waits.
   */
  onBusyChange?: (busy: boolean) => void
  /**
   * Which conversation this is (lib/ai-chat-session-store) — one per post.
   * A `core:draft…` key moves to the post's key once it is saved.
   */
  storeKey?: string
}

const ERROR_COPY: Record<string, string> = {
  anthropic_not_connected: "כדי לערוך בשיחה צריך לחבר את חשבון Claude בהגדרות.",
  credits_exhausted: "נגמרו הקרדיטים ב-Claude. בדקו את החשבון ונסו שוב.",
  anthropic_overloaded: "השרתים של Claude עמוסים כרגע. נסו שוב בעוד רגע.",
  anthropic_key_invalid: CLAUDE_KEY_INVALID_MESSAGE,
}

const INTRO: ChatMessage = {
  role: "assistant",
  seed: true,
  content: "רוצות לשנות משהו בפוסט? כתבו לי מה לשנות ואני אעדכן.",
}

/** Panel state kept with the conversation (lib/ai-chat-session-store). */
interface CoreChatExtra {
  /** The text the next revision builds on; null = whatever the card shows. */
  workingPost: string | null
  error: string
}
type CoreChat = AiChatSession<ChatMessage, CoreChatExtra>

const EMPTY_CHAT: CoreChat = { messages: [INTRO], input: "", busy: false, extra: { workingPost: null, error: "" } }
const freshChat = () => EMPTY_CHAT

/**
 * Floating chat panel for iterating on a generated core post with the AI —
 * anchored bottom-right (the MediaPanel already owns the left rail). When the
 * AI proposes a change it's previewed live in the core post card; the user
 * then keeps it ("החל שינויים") or reverts it ("בטל שינוי").
 *
 * Rendered as a sibling to the InfiniteCanvas (fixed positioning) so the
 * canvas pan/zoom transform doesn't scale or drag the chat while typing.
 */
export function CorePostChat({
  open,
  onOpenChange,
  corePost,
  hookText,
  onPreview,
  onBusyChange,
  storeKey = "core:draft",
}: CorePostChatProps) {
  // The conversation lives outside the panel (lib/ai-chat-session-store):
  // closing it or leaving the screen keeps the thread, the half-typed text
  // and a request still running. It starts over only on "שיחה חדשה".
  const session = useAiChat<ChatMessage, CoreChatExtra>(storeKey) ?? EMPTY_CHAT
  const { messages, input, busy: loading } = session
  const { error } = session.extra
  const patch = (fn: (s: CoreChat) => CoreChat) => updateChat(storeKey, freshChat, fn)
  // While open, a reply lands here — nothing to reopen (lib/ai-chat-reveal).
  useWatchChat(open ? storeKey : null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Today's batch (2026-10-29), Hani only: above the schedule bar, closes on an outside click.
  const preview = usePreviewAccess() === true
  useDismissOnOutsideClick(panelRef, open && preview, () => onOpenChange(false))
  // Read the latest post at open-time without re-seeding on every keystroke
  // the parent makes to corePost.
  const corePostRef = useRef(corePost)
  corePostRef.current = corePost

  // A draft post that just got its id keeps its conversation.
  const prevKeyRef = useRef(storeKey)
  useEffect(() => {
    const prev = prevKeyRef.current
    prevKeyRef.current = storeKey
    if (prev !== storeKey && prev.startsWith("core:draft")) moveChat(prev, storeKey)
  }, [storeKey])

  // Each time the panel opens, the next revision builds on what the card
  // shows now (it may have changed since). A revision that landed while the
  // page was gone never reached the card — show it there now.
  useEffect(() => {
    if (!open) return
    const s = getChat<ChatMessage, CoreChatExtra>(storeKey)
    if (!s || s.busy) return
    let base = corePostRef.current
    const pending = s.messages.find((m) => m.status === "pending")
    if (pending?.revisedPost && pending.revertTo === base && pending.revisedPost !== base) {
      onPreview(pending.revisedPost)
      base = pending.revisedPost
    }
    updateChat(storeKey, freshChat, (x) => ({ ...x, extra: { ...x.extra, workingPost: base } }))
    // Only on open / a different post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeKey])

  /**
   * Record what the user did with an AI revision. This is the product's only
   * real "what worked / what didn't" signal: the user said what they wanted in
   * their own words, then explicitly kept or reverted the result. A revision
   * is logged once (`logged` on the message), however often it is clicked.
   */
  const logChatSignal = (msg: ChatMessage, outcome: LearningOutcome) => {
    if (msg.logged) return
    if (!msg.revisedPost || msg.revertTo === undefined) return
    logLearningEdit({
      originalText: msg.revertTo,
      editedText: msg.revisedPost,
      contentType: "core_post",
      source: "chat_instruction",
      outcome,
      instruction: msg.instruction,
    })
  }

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  // Surface the generating state so the parent can animate the post card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onBusyChange?.(loading) }, [loading])

  const send = async () => {
    // The reply belongs to this conversation even if the panel closes first.
    const key = storeKey
    const patchKey = (fn: (s: CoreChat) => CoreChat) => updateChat(key, freshChat, fn)
    const cur = getChat<ChatMessage, CoreChatExtra>(key) ?? EMPTY_CHAT
    const text = cur.input.trim()
    if (!text || cur.busy) return
    // A still-pending proposal is implicitly kept once the user asks for the
    // next change (its text is already the baseline going forward) — so it
    // counts as an acceptance for learning purposes too.
    cur.messages.forEach((m) => {
      if (m.status === "pending") logChatSignal(m, "accepted")
    })
    const marked = cur.messages.map((m) =>
      m.status === "pending" ? { ...m, status: "applied" as const, logged: true } : m,
    )
    const next: ChatMessage[] = [...marked, { role: "user", content: text }]
    const workingPost = cur.extra.workingPost ?? corePostRef.current
    patchKey((s) => ({ ...s, messages: next, input: "", busy: true, extra: { ...s.extra, error: "" } }))
    const fail = (message: string) => patchKey((s) => ({ ...s, extra: { ...s.extra, error: message } }))

    try {
      const res = await fetch("/api/core-post/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPost: workingPost,
          hook: hookText,
          messages: next
            .filter((m) => !m.seed)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        fail(ERROR_COPY[data.error] ?? "משהו השתבש. נסו שוב.")
        return
      }
      const reply: string = data.reply || "עדכנתי את הפוסט."
      const revisedPost: string = data.revisedPost || ""
      const revertTo = workingPost
      if (revisedPost) onPreview(revisedPost) // show it in the core post card immediately
      patchKey((s) => ({
        ...s,
        extra: { ...s.extra, workingPost: revisedPost || s.extra.workingPost },
        messages: [
          ...s.messages,
          {
            role: "assistant",
            content: reply,
            revisedPost: revisedPost || undefined,
            revertTo: revisedPost ? revertTo : undefined,
            status: revisedPost ? "pending" : undefined,
            instruction: revisedPost ? text : undefined,
          },
        ],
      }))
    } catch (err) {
      console.error("[core-post-chat] refine failed", err)
      fail(aiErrorMessage(err))
    } finally {
      patchKey((s) => ({ ...s, busy: false }))
      // Closed meanwhile: this post's page reopens the chat on the reply.
      revealChatReply(key, "העריכה של פוסט הליבה מוכנה")
    }
  }

  const keep = (index: number) => {
    const msg = getChat<ChatMessage, CoreChatExtra>(storeKey)?.messages[index]
    if (!msg) return
    logChatSignal(msg, "accepted")
    patch((s) => ({
      ...s,
      messages: s.messages.map((m, i) => (i === index ? { ...m, status: "applied", logged: true } : m)),
    }))
    toast.success("השינויים הוחלו על הפוסט")
  }

  const cancel = (index: number) => {
    const msg = getChat<ChatMessage, CoreChatExtra>(storeKey)?.messages[index]
    if (!msg) return
    logChatSignal(msg, "rejected")
    const revertTo = msg.revertTo ?? corePostRef.current
    onPreview(revertTo) // restore the previous text in the card
    patch((s) => ({
      ...s,
      extra: { ...s.extra, workingPost: revertTo },
      messages: s.messages.map((m, i) => (i === index ? { ...m, status: "canceled", logged: true } : m)),
    }))
  }

  if (!open) return null

  return (
    <div
      ref={panelRef}
      dir="rtl"
      role="dialog"
      aria-label="עריכת פוסט ליבה"
      className={`fixed bottom-6 right-6 ${preview ? "z-50" : "z-40"} flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">עריכת פוסט ליבה</span>
        <div className="ms-auto flex items-center gap-1">
          {messages.some((m) => m.role === "user") && (
            <AiChatNewButton disabled={loading} onClick={() => clearChat(storeKey)} />
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="סגירה"
            className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-bg-surface-hover hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-start" : "items-end"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-small leading-relaxed ${
                m.role === "user"
                  ? "bg-bg-surface-primary-default text-text-primary-default rounded-ss-sm"
                  : "bg-bg-surface text-text-primary-default rounded-se-sm"
              }`}
            >
              {m.content}
            </div>
            {m.role === "assistant" && m.revisedPost && (
              m.status === "applied" ? (
                <span className="inline-flex items-center gap-1 text-xs-body text-text-neutral-default">
                  <Check className="size-3.5 text-yellow-30" />
                  הוחל על הפוסט
                </span>
              ) : m.status === "canceled" ? (
                <span className="text-xs-body text-text-neutral-default">השינוי בוטל</span>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => keep(i)} className="gap-1.5">
                    <Check className="size-3.5" />
                    החל שינויים
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => cancel(i)}>
                    בטל שינוי
                  </Button>
                </div>
              )
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-small text-text-neutral-default">
            <Loader2 className="size-4 animate-spin text-yellow-50" />
            <span>חושב על זה...</span>
          </div>
        )}

        {error && (
          <p role="alert" className={AI_ERROR_BOX}>
            {aiErrorMessage(error)}
          </p>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-neutral-default p-3">
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-2 focus-within:border-yellow-50 transition-colors">
          <Textarea
            value={input}
            onChange={(e) => patch((s) => ({ ...s, input: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="מה תרצו לשנות?"
            rows={1}
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent p-1 text-small shadow-none focus-visible:ring-0"
          />
          <Button
            size="icon-sm"
            onClick={send}
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
