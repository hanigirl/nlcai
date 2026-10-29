"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Check, Loader2, X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDismissOnOutsideClick } from "@/lib/use-dismiss-on-outside-click"
import { startBRollEdit } from "@/lib/broll-generation-store"
import { getAiStyle, recordAiStyleVote, rememberAiStyle } from "@/lib/ai-style-provenance"
import { LongWaitBusyRow } from "@/components/long-wait-busy-row"
import { AWAY_COPY, trackAwayResult, useIsWatching } from "@/lib/long-wait"
import { SaveToVisualLanguageChip } from "@/components/save-to-visual-language-chip"
import { dislikeInstruction, type AiEditOpening } from "@/lib/ai-edit-intent"
import { DislikeReasonChips } from "@/components/dislike-reason-chips"
import { DISLIKE_REASONS, type DislikeReason } from "@/lib/visual-language/types"
import { usePreviewAccess } from "@/lib/use-scheduling-access"
import { REFERENCE_ONLY_INSTRUCTION } from "@/lib/ai-edit-references"
import {
  ReferenceButton,
  ReferenceDropHint,
  ReferenceThumbs,
  ReferenceTray,
  useReferenceImages,
} from "@/components/ai-edit-reference"

/** A clip the Opus engine made — only those have a composition to edit. */
export function isEditableBRollUrl(url: string | null | undefined): boolean {
  return !!url && /\/b_roll\/[0-9a-f-]{36}\.mp4(?:[?#].*)?$/i.test(url)
}

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** User turns: reference images she attached (shown in her bubble). */
  images?: string[]
  /** Assistant turn that landed a new clip. */
  done?: boolean
  error?: boolean
  /** A lasting preference distilled from her instruction (Hebrew) — shown by the save chip. */
  remembered?: string | null
}

/** The first turn when 👎 opened the panel (lib/ai-edit-intent). */
const DISLIKE_ASK = "מה לא אהבתם? ספרו לנו, ואעדכן את זה עכשיו. מה שתכתבו נשמר גם לשפה הוויזואלית שלכם, לפעמים הבאות."

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

/** The newest edit that landed, with the instruction that asked for it. */
function lastLandedEdit(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i > 0; i--) {
    if (messages[i].done) {
      const ask = messages.slice(0, i).reverse().find((m) => m.role === "user")
      return ask ? { index: i, instruction: ask.content, remembered: messages[i].remembered ?? null } : null
    }
  }
  return null
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
  opening,
}: {
  postId: string
  format: AiEditFormat
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Image formats: the saved set, in order, after an edit. */
  onUpdated?: (format: AiEditFormat, urls: string[]) => void
  /** Opened by 👎 on the card: ask what she didn't like, with the reasons. */
  opening?: AiEditOpening | null
}) {
  const copy = COPY[format]
  // Today's batch (2026-10-29), Hani only: z-50 + outside-click close, the
  // leave-screen note, the save chip, 👎 opening. Off (or loading) = as before.
  const preview = usePreviewAccess() === true
  const firstTurn = (o?: AiEditOpening | null): ChatMessage => ({
    role: "assistant",
    content: o ? DISLIKE_ASK : copy.intro,
  })
  const [messages, setMessages] = useState<ChatMessage[]>([firstTurn(opening)])
  // A different format's chat, or a fresh 👎, starts its own conversation.
  const [chatFormat, setChatFormat] = useState(`${format}:${opening?.id ?? ""}`)
  // Until her first answer: the reason chips, and that answer teaches the style.
  const [asking, setAsking] = useState<AiEditOpening | null>(opening ?? null)
  const [reasons, setReasons] = useState<DislikeReason[]>([])
  if (chatFormat !== `${format}:${opening?.id ?? ""}`) {
    setChatFormat(`${format}:${opening?.id ?? ""}`)
    setMessages([firstTurn(opening)])
    setAsking(opening ?? null)
    setReasons([])
  }
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  // Screenshots waiting to go with the next message; a new conversation starts clean.
  const refs = useReferenceImages()
  const { clear: clearRefs } = refs
  useEffect(() => {
    clearRefs()
  }, [chatFormat, clearRefs])
  const isWatching = useIsWatching()
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsideClick(panelRef, open && preview, () => onOpenChange(false))

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  const send = async () => {
    let text = input.trim()
    // Her 👎 answer: the style-feedback route learns from it, so the edit
    // doesn't learn it a second time (learn: false).
    const fromFeedback = !!asking
    if (asking) {
      if ((!text && !reasons.length) || loading) return
      asking.onFeedback(reasons, text)
      text = dislikeInstruction(reasons.map((r) => DISLIKE_REASONS[r]), text)
      setAsking(null)
      setReasons([])
    }
    const attached = refs.refs
    if (!text && attached.length && !loading) text = REFERENCE_ONLY_INSTRUCTION
    if (!text || loading) return
    setInput("")
    refs.clear()
    setMessages((prev) => [...prev, { role: "user", content: text, ...(attached.length ? { images: attached } : {}) }])
    setLoading(true)
    // An edit that came from 👎 is learned by the feedback route, not here.
    const learn = !fromFeedback
    // If she leaves before it lands, the result arrives as a toast (the
    // server has saved it either way) — see lib/long-wait.
    const run =
      format === "b_roll"
        ? startBRollEdit(postId, text, { quiet: true, learn, references: attached }).then((r) => {
            if (r.ok) markAiMade(postId, "b_roll", r.url)
            return r
          })
        : editImages(text, learn, attached)
    const result = preview
      ? await trackAwayResult(`ai-edit-${postId}-${format}-${Date.now()}`, run, isWatching, AWAY_COPY[format], postId)
      : await run
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
    learn = true,
    references: string[] = [],
  ): Promise<{ ok: true; remembered?: string | null } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/media/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          format,
          instruction: text,
          ...(learn ? {} : { learn: false }),
          ...(references.length ? { references } : {}),
        }),
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

  const lastEdit = lastLandedEdit(messages)

  if (!open) return null

  return (
    <div
      ref={panelRef}
      dir="rtl"
      role="dialog"
      aria-label={copy.title}
      {...refs.dropProps}
      className={`fixed bottom-6 right-6 ${preview ? "z-50" : "z-40"} flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl`}
    >
      <ReferenceDropHint show={refs.dragging} />
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
              <ReferenceThumbs images={m.images} className="mt-1.5" />
            </div>
            {asking && i === 0 && (
              <DislikeReasonChips value={reasons} onChange={setReasons} className="max-w-[85%] justify-end" />
            )}
            {/* The save-to-visual-language chip is open to everyone (Hani, 2026-10-29). */}
            {m.done && (
              <span className="inline-flex items-center gap-1 text-xs-body text-text-neutral-default">
                <Check className="size-3.5 text-green-success-50" />
                הוחל.
              </span>
            )}
          </div>
        ))}

        {loading && preview && (
          <LongWaitBusyRow text={copy.busy} />
        )}
        {loading && !preview && (
          <div className="flex items-center gap-2 text-small text-text-neutral-default">
            <Loader2 className="size-4 animate-spin text-yellow-50" />
            <span>{copy.busy}</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-neutral-default p-3">
        {lastEdit && !loading && (
          <SaveToVisualLanguageChip
            key={`${chatFormat}:${lastEdit.index}`}
            instruction={lastEdit.instruction}
            format={format}
            remembered={lastEdit.remembered}
          />
        )}
        <ReferenceTray r={refs} />
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-2 focus-within:border-yellow-50 transition-colors">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={refs.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={asking ? "מה לא אהבתם? ספרו לנו" : "מה תרצו לשנות?"}
            rows={1}
            autoFocus
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-small shadow-none focus-visible:ring-0"
          />
          <ReferenceButton r={refs} disabled={loading} />
          <Button
            size="icon-sm"
            onClick={() => void send()}
            disabled={(!input.trim() && !(asking && reasons.length) && !refs.refs.length) || loading}
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
