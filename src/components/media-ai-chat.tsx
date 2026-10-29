"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Check, Loader2, X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { startBRollEdit } from "@/lib/broll-generation-store"
import { getAiStyle, recordAiStyleVote, rememberAiStyle } from "@/lib/ai-style-provenance"
import { LongWaitBusyRow } from "@/components/long-wait-busy-row"
import { trackAwayResult, useIsWatching, waitNoteReviewState } from "@/lib/long-wait"

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
  /** A lasting preference distilled from her instruction (Hebrew). */
  remembered?: string | null
}

/**
 * After an edit the card shows new media — move this format's AI provenance
 * to it, so the 👍 / 👎 strip appears for the edited version and her verdict
 * teaches the style (the strip only shows on media the AI made).
 */
function markAiMade(postId: string, format: AiEditFormat, mediaKey: string) {
  if (format === "carousel") {
    // The carousel's provenance is its template; just clear the old verdict.
    recordAiStyleVote(postId, "carousel", null)
    return
  }
  const prev = getAiStyle(postId, format)
  rememberAiStyle(postId, format, prev?.style && prev.style !== "niche" ? prev.style : "brand", mediaKey)
}

export type AiEditFormat = "b_roll" | "carousel" | "story" | "image_post"

const COPY: Record<AiEditFormat, { title: string; intro: string; done: string; busy: string }> = {
  b_roll: {
    title: "עריכת בי-רול עם AI",
    intro: "מה לשנות בבי-רול? למשל גודל הכותרת, צבעים, איך המילים נכנסות או התזמון. אעדכן את האנימציה והסרטון יתחלף בכרטיס.",
    done: "עדכנתי את הבי-רול. הסרטון החדש מופיע בכרטיס.",
    busy: "מעדכנים את הבי-רול... זה לוקח כדקה",
  },
  carousel: {
    title: "עריכת קרוסלה עם AI",
    intro: "מה לשנות בקרוסלה? אפשר לבקש על כל השקופיות או על שקופית מסוימת, למשל ״בשקופית 3 הכותרת בצבע המותג״.",
    done: "עדכנתי את הקרוסלה. השקופיות החדשות מופיעות בכרטיס.",
    busy: "מעדכנים את השקופיות... זה יכול לקחת עד שתי דקות",
  },
  story: {
    title: "עריכת סטורי עם AI",
    intro: "מה לשנות בסטורי? אפשר לבקש על כל הפריימים או על פריים מסוים.",
    done: "עדכנתי את הסטורי. הפריימים החדשים מופיעים בכרטיס.",
    busy: "מעדכנים את הסטורי... זה יכול לקחת עד שתי דקות",
  },
  image_post: {
    title: "עריכת תמונה עם AI",
    intro: "מה לשנות בתמונה? למשל צבעים, גודל הכותרת, רקע או אלמנט מסוים.",
    done: "עדכנתי את התמונה. היא מופיעה בכרטיס.",
    busy: "מעדכנים את התמונה... זה יכול לקחת כדקה",
  },
}

/** Away-notification copy (see lib/long-wait) — only when she left mid-edit. */
const AWAY_WHAT: Record<AiEditFormat, string> = {
  b_roll: "הבי-רול",
  carousel: "הקרוסלה",
  story: "הסטורי",
  image_post: "התמונה",
}
const AWAY_DONE: Record<AiEditFormat, string> = {
  b_roll: "עריכת הבי-רול הסתיימה. הסרטון החדש מופיע בפוסט.",
  carousel: "עריכת הקרוסלה הסתיימה. השקופיות החדשות מופיעות בפוסט.",
  story: "עריכת הסטורי הסתיימה. הפריימים החדשים מופיעים בפוסט.",
  image_post: "עריכת התמונה הסתיימה. היא מופיעה בפוסט.",
}
const AWAY_FAILED: Record<AiEditFormat, string> = {
  b_roll: "עריכת הבי-רול לא הצליחה. נסו שוב מהפוסט.",
  carousel: "עריכת הקרוסלה לא הצליחה. נסו שוב מהפוסט.",
  story: "עריכת הסטורי לא הצליחה. נסו שוב מהפוסט.",
  image_post: "עריכת התמונה לא הצליחה. נסו שוב מהפוסט.",
}

/**
 * "עריכת [פורמט] עם AI" (Hani, 2026-10-22) — the same floating side panel as
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
export function MediaAiChat({
  postId,
  format,
  open,
  onOpenChange,
  onUpdated,
}: {
  postId: string
  format: AiEditFormat
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Image formats: the saved set, in order, after an edit. */
  onUpdated?: (format: AiEditFormat, urls: string[]) => void
}) {
  const copy = COPY[format]
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: copy.intro }])
  // A different format's chat starts its own conversation.
  const [chatFormat, setChatFormat] = useState(format)
  if (chatFormat !== format) {
    setChatFormat(format)
    setMessages([{ role: "assistant", content: copy.intro }])
  }
  const [input, setInput] = useState("")
  // Review only (?waitnote=…&state=ai-edit): land on the busy state.
  const [loading, setLoading] = useState(() => waitNoteReviewState() === "ai-edit")
  const isWatching = useIsWatching()
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
    // If she leaves before it lands, the result arrives as a toast (the
    // server has saved it either way). No-op without ?waitnote.
    const result = await trackAwayResult(
      { id: `ai-edit-${postId}-${format}-${Date.now()}`, verb: "מעדכנים", what: AWAY_WHAT[format] },
      format === "b_roll"
        ? startBRollEdit(postId, text, { quiet: true }).then((r) => {
            if (r.ok) markAiMade(postId, "b_roll", r.url)
            return r
          })
        : editImages(text),
      isWatching,
      { done: AWAY_DONE[format], failed: AWAY_FAILED[format] },
    )
    setLoading(false)
    setMessages((prev) => [
      ...prev,
      result.ok
        ? { role: "assistant", content: copy.done, done: true, remembered: result.remembered }
        : { role: "assistant", content: result.message || "העריכה לא הצליחה. נסו שוב.", error: true },
    ])
  }

  async function editImages(
    text: string,
  ): Promise<{ ok: true; remembered?: string | null } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/media/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, format, instruction: text }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        urls?: string[]
        message?: string
        error?: string
        remembered?: string | null
      }
      if (!res.ok || !data.urls) return { ok: false, message: data.message ?? data.error ?? "העריכה לא הצליחה" }
      if (data.urls[0]) markAiMade(postId, format, data.urls[0])
      onUpdated?.(format, data.urls)
      return { ok: true, remembered: data.remembered ?? null }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!open) return null

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label={copy.title}
      className="fixed bottom-6 right-6 z-40 flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">{copy.title}</span>
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
                הוחל. אהבתם? סמנו 👍 או 👎 בכרטיס, כדי שה-AI ילמד את הסגנון שלכם.
              </span>
            )}
            {m.remembered && (
              <span className="max-w-[85%] rounded-xl border border-border-neutral-default px-3 py-1.5 text-xs-body text-text-neutral-default">
                אזכור את זה גם להבא, בכל הפורמטים: {m.remembered}
              </span>
            )}
          </div>
        ))}

        {loading && (
          <LongWaitBusyRow text={copy.busy} />
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
