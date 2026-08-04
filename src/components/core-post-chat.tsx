"use client"

import { useEffect, useRef, useState } from "react"
import { X, ArrowUp, Loader2, Check, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { logLearningEdit, type LearningOutcome } from "@/lib/learning-capture"

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
   * Review-harness only: when true, `send` never calls the paid refine route.
   * It fakes a short "generating" beat and returns a canned revision, so the
   * design ?variant preview can exercise the full loop with zero credits.
   */
  demo?: boolean
}

const ERROR_COPY: Record<string, string> = {
  anthropic_not_connected: "כדי לערוך בשיחה צריך לחבר את חשבון Claude בהגדרות.",
  credits_exhausted: "נגמרו הקרדיטים ב-Claude. בדקו את החשבון ונסו שוב.",
  anthropic_overloaded: "השרתים של Claude עמוסים כרגע. נסו שוב בעוד רגע.",
}

const INTRO: ChatMessage = {
  role: "assistant",
  seed: true,
  content: "רוצות לשנות משהו בפוסט? כתבו לי מה לשנות ואני אעדכן.",
}

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
  demo = false,
}: CorePostChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO])
  const [workingPost, setWorkingPost] = useState(corePost)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const scrollRef = useRef<HTMLDivElement>(null)
  // Read the latest post at open-time without re-seeding on every keystroke
  // the parent makes to corePost.
  const corePostRef = useRef(corePost)
  corePostRef.current = corePost

  // Message indices whose accept/reject verdict was already sent to the
  // learning log, so a re-render or a second click can't log the same
  // revision twice.
  const loggedRef = useRef<Set<number>>(new Set())

  // Fresh session each time the panel opens — seed the working version from
  // whatever the post currently is (it may have changed since last open).
  useEffect(() => {
    if (!open) return
    setMessages([INTRO])
    setWorkingPost(corePostRef.current)
    setInput("")
    setError("")
    loggedRef.current = new Set()
  }, [open])

  /**
   * Record what the user did with an AI revision. This is the product's only
   * real "what worked / what didn't" signal: the user said what they wanted in
   * their own words, then explicitly kept or reverted the result.
   */
  const logChatSignal = (index: number, msg: ChatMessage, outcome: LearningOutcome) => {
    if (loggedRef.current.has(index)) return
    if (!msg.revisedPost || msg.revertTo === undefined) return
    loggedRef.current.add(index)
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
    const text = input.trim()
    if (!text || loading) return
    // A still-pending proposal is implicitly kept once the user asks for the
    // next change (its text is already the baseline going forward) — so it
    // counts as an acceptance for learning purposes too.
    messages.forEach((m, i) => {
      if (m.status === "pending") logChatSignal(i, m, "accepted")
    })
    const marked = messages.map((m) =>
      m.status === "pending" ? { ...m, status: "applied" as const } : m,
    )
    const next: ChatMessage[] = [...marked, { role: "user", content: text }]
    setMessages(next)
    setInput("")
    setLoading(true)
    setError("")

    // Review-harness short-circuit: no network, no credits. Fake a brief
    // "thinking" beat, then return a canned revision so the loop is reviewable.
    if (demo) {
      await new Promise((r) => setTimeout(r, 900))
      const revertTo = workingPost
      const revisedPost = `${workingPost}\n\n(עודכן לצורך הדגמה — "${text}")`
      onPreview(revisedPost)
      setWorkingPost(revisedPost)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "עדכנתי את הפוסט (הדגמה).",
          revisedPost,
          revertTo,
          status: "pending",
          instruction: text,
        },
      ])
      setLoading(false)
      return
    }

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
        setError(ERROR_COPY[data.error] ?? "משהו השתבש. נסו שוב.")
        return
      }
      const reply: string = data.reply || "עדכנתי את הפוסט."
      const revisedPost: string = data.revisedPost || ""
      const revertTo = workingPost
      if (revisedPost) {
        onPreview(revisedPost) // show it in the core post card immediately
        setWorkingPost(revisedPost)
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply,
          revisedPost: revisedPost || undefined,
          revertTo: revisedPost ? revertTo : undefined,
          status: revisedPost ? "pending" : undefined,
          instruction: revisedPost ? text : undefined,
        },
      ])
    } catch (err) {
      console.error("[core-post-chat] refine failed", err)
      setError("שגיאת רשת. נסו שוב.")
    } finally {
      setLoading(false)
    }
  }

  const keep = (index: number) => {
    logChatSignal(index, messages[index], "accepted")
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, status: "applied" } : m)),
    )
    toast.success("השינויים הוחלו על הפוסט")
  }

  const cancel = (index: number) => {
    const msg = messages[index]
    logChatSignal(index, msg, "rejected")
    const revertTo = msg.revertTo ?? corePostRef.current
    onPreview(revertTo) // restore the previous text in the card
    setWorkingPost(revertTo)
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, status: "canceled" } : m)),
    )
  }

  if (!open) return null

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="עריכת פוסט ליבה"
      className="fixed bottom-6 right-6 z-40 flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <Sparkles className="size-4 text-yellow-40" aria-hidden />
        <span className="text-small-bold text-text-primary-default">עריכת פוסט ליבה</span>
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
          <p role="alert" className="text-small text-button-destructive-default">
            {error}
          </p>
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
