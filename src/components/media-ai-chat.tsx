"use client"

import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { ArrowUp, Check, Loader2, X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDismissOnOutsideClick } from "@/lib/use-dismiss-on-outside-click"
import { startBRollEdit } from "@/lib/broll-generation-store"
import { getAiStyle, recordAiStyleVote, rememberAiStyle } from "@/lib/ai-style-provenance"
import { LongWaitBusyRow } from "@/components/long-wait-busy-row"
import { AWAY_COPY, trackAwayResult } from "@/lib/long-wait"
import { SaveToVisualLanguageChip } from "@/components/save-to-visual-language-chip"
import { dislikeInstruction, type AiEditOpening } from "@/lib/ai-edit-intent"
import { DislikeReasonChips } from "@/components/dislike-reason-chips"
import { DISLIKE_REASONS, type DislikeReason } from "@/lib/visual-language/types"
import { usePreviewAccess } from "@/lib/use-scheduling-access"
import { Chip } from "@/components/ui/chip"
import { runOwnMediaEdit } from "@/lib/own-media-edit"
import {
  clearChat,
  getChat,
  isChatWatched,
  updateChat,
  useAiChat,
  useWatchChat,
  type AiChatSession,
} from "@/lib/ai-chat-session-store"
import { AiChatNewButton } from "@/components/ai-chat-new-button"

/** A clip the Opus engine made — only those have a composition to edit. */
export function isEditableBRollUrl(url: string | null | undefined): boolean {
  return !!url && /\/b_roll\/[0-9a-f-]{36}\.mp4(?:[?#].*)?$/i.test(url)
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** Assistant turn that landed a new clip. */
  done?: boolean
  error?: boolean
  /** A lasting preference distilled from her instruction (Hebrew) — shown by the save chip. */
  remembered?: string | null
  /** Own media: the edit changed only content (words, slides), nothing to save as a style. */
  noStyle?: boolean
}

/** Panel state kept with the conversation (lib/ai-chat-session-store). */
interface MediaChatExtra {
  /** 👎 asked at this turn; the reason chips show under it until she answers. */
  asking: { id: string; index: number } | null
  reasons: DislikeReason[]
  /** Own media: the step it is on, under the busy row. */
  progress: string
  /** The last 👎 this conversation took in — reopening doesn't ask again. */
  openingId: string | null
}
type MediaChat = AiChatSession<ChatMessage, MediaChatExtra>

/**
 * Her 👎 answer goes to the style-feedback route through the card's callback.
 * Functions don't go to storage, so this lives in memory: after a reload the
 * question stays in the thread and she answers it as a normal edit.
 */
const feedbackById = new Map<string, AiEditOpening["onFeedback"]>()

/** The conversation of one post + format (+ own media) in lib/ai-chat-session-store. */
export const mediaChatKey = (postId: string, format: AiEditFormat, own = false) =>
  `media:${postId}:${format}:${own ? "own" : "ai"}`

/** Distinct ids for the leave-screen toast of each own-media edit. */
let ownEditSeq = 0

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
 * Media she brought herself (Hani, 2026-10-29): the AI adds on top or takes
 * away — the caption, extra AI slides, the order — and never touches what she
 * filmed. The opening line and the suggestions say exactly that.
 */
const OWN_COPY: Record<AiEditFormat, { title: string; intro: string; busy: string; suggestions: { label: string; text: string; send: boolean }[] }> = {
  story: {
    title: "עריכת סטורי עם AI",
    intro:
      "זה הסטורי שלכם, אז מה שצילמתם נשאר בדיוק כמו שהוא. אפשר לשנות, להזיז או להוריד את הכיתוב, להוסיף פריים חדש שה-AI מעצב בשפה הוויזואלית שלכם (גם עם טקסט מונפש, כמו בבי-רול), או למחוק ולסדר מחדש פריימים.",
    busy: "מעדכנים את הסטורי... זה יכול לקחת עד שתי דקות",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב ל: ", send: false },
      { label: "להוסיף פריים סיום", text: "להוסיף פריים סיום עם קריאה לפעולה", send: true },
      { label: "להוסיף פריים עם טקסט מונפש", text: "להוסיף בסוף פריים עם טקסט מונפש: ", send: false },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב", send: true },
    ],
  },
  carousel: {
    title: "עריכת קרוסלה עם AI",
    intro:
      "אלה השקופיות שלכם, אז התמונות עצמן נשארות כמו שהן. אפשר לשנות, להזיז או להוריד את הכיתוב, להוסיף שקופית שה-AI מעצב בשפה הוויזואלית שלכם, או למחוק ולסדר מחדש שקופיות.",
    busy: "מעדכנים את השקופיות... זה יכול לקחת עד שתי דקות",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב בשקופית הזאת ל: ", send: false },
      { label: "להוסיף שקופית סיום", text: "להוסיף שקופית סיום עם קריאה לפעולה", send: true },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב מכל השקופיות", send: true },
    ],
  },
  image_post: {
    title: "עריכת תמונה עם AI",
    intro:
      "זו התמונה שלכם, אז היא עצמה נשארת כמו שהיא. אפשר לשנות את הכיתוב עליה, להזיז אותו, לשנות את הצבע והגודל שלו, או להוריד אותו.",
    busy: "מעדכנים את התמונה...",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב ל: ", send: false },
      { label: "להזיז את הכיתוב למעלה", text: "להזיז את הכיתוב למעלה", send: true },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב", send: true },
    ],
  },
  b_roll: {
    title: "עריכת בי-רול עם AI",
    intro:
      "זה הבי-רול שלכם, אז מה שצילמתם נשאר בדיוק כמו שהוא. אפשר לשנות את הכיתוב עליו, להזיז אותו, לשנות את הצבע והגודל שלו, או להוריד אותו.",
    busy: "מעדכנים את הבי-רול... בסרטון זה יכול לקחת עד שתי דקות",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב ל: ", send: false },
      { label: "להזיז את הכיתוב למעלה", text: "להזיז את הכיתוב למעלה", send: true },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב", send: true },
    ],
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
  own = false,
  currentUrls = [],
  currentFrame,
  initialMessages,
  autoSend,
}: {
  postId: string
  format: AiEditFormat
  /**
   * The media is hers (Drive / upload), not the AI's: only add on top or take
   * away — lib/own-media-edit. The panel says so and offers those moves.
   */
  own?: boolean
  /** Own media: the set as the card shows it. */
  currentUrls?: string[]
  /** Own media: the frame / slide on screen (1-based). */
  currentFrame?: number
  /** State previews (/test/*) only: start the conversation here. */
  initialMessages?: ChatMessage[]
  /** State previews (/test/*) only: send this request once, on open. */
  autoSend?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The saved set, in order, after an edit (image formats; own media of any
   * format). `driveLinks`: an own carousel's per-slide links, re-ordered with it.
   */
  onUpdated?: (format: AiEditFormat, urls: string[], extra?: { driveLinks?: string[] | null }) => void
  /** Opened by 👎 on the card: ask what she didn't like, with the reasons. */
  opening?: AiEditOpening | null
}) {
  const copy = own ? { ...COPY[format], ...OWN_COPY[format] } : COPY[format]
  // Today's batch (2026-10-29), Hani only: z-50 + outside-click close, the
  // leave-screen note, the save chip, 👎 opening. Off (or loading) = as before.
  const preview = usePreviewAccess() === true
  // One conversation per post + format (+ own media), kept outside the panel
  // (lib/ai-chat-session-store): closing it or leaving the screen keeps the
  // thread, the half-typed text and a request still running.
  const chatKey = mediaChatKey(postId, format, own)
  const fresh = useMemo(
    () => (): MediaChat => ({
      messages: initialMessages ?? [{ role: "assistant", content: copy.intro }],
      input: "",
      busy: false,
      extra: { asking: null, reasons: [], progress: "", openingId: null },
    }),
    [initialMessages, copy.intro],
  )
  const empty = useMemo(() => fresh(), [fresh])
  const session = useAiChat<ChatMessage, MediaChatExtra>(chatKey) ?? empty
  const { messages, input, busy: loading } = session
  const { reasons, progress } = session.extra
  const patch = (fn: (s: MediaChat) => MediaChat) => updateChat(chatKey, fresh, fn)
  // Until her first answer to 👎: the reason chips, and that answer teaches the style.
  const asking =
    session.extra.asking && feedbackById.has(session.extra.asking.id) ? session.extra.asking : null

  // A fresh 👎 asks what she didn't like — as a new turn of the same
  // conversation, or as its first turn if nothing was said yet.
  useLayoutEffect(() => {
    if (!opening) return
    feedbackById.set(opening.id, opening.onFeedback)
    if (getChat<ChatMessage, MediaChatExtra>(chatKey)?.extra.openingId === opening.id) return
    updateChat(chatKey, fresh, (s) => {
      const ask: ChatMessage = { role: "assistant", content: DISLIKE_ASK }
      const next = s.messages.some((m) => m.role === "user") ? [...s.messages, ask] : [ask]
      return {
        ...s,
        messages: next,
        extra: { ...s.extra, openingId: opening.id, asking: { id: opening.id, index: next.length - 1 }, reasons: [] },
      }
    })
  }, [chatKey, opening, fresh])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  // "Watching" = a panel shows this conversation when the reply lands — the
  // one she reopened counts too, so the leave-screen toast only comes when
  // she's really away.
  useWatchChat(chatKey)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsideClick(panelRef, open && preview, () => onOpenChange(false))

  const autoSent = useRef(false)
  useEffect(() => {
    if (!autoSend || autoSent.current) return
    const t = setTimeout(() => {
      autoSent.current = true
      // A conversation already under way (reopened, reloaded) isn't re-scripted.
      if (getChat<ChatMessage, MediaChatExtra>(chatKey)?.messages.some((m) => m.role === "user")) return
      void send(autoSend)
    }, 300)
    return () => clearTimeout(t)
    // Once, on open — a preview's scripted first request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  const setInput = (value: string) => patch((s) => ({ ...s, input: value }))

  const send = async (preset?: string) => {
    // The reply belongs to this conversation even if the panel closes or
    // switches format before it lands.
    const key = chatKey
    const init = fresh
    const isWatching = () => isChatWatched(key)
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, init, fn)
    const cur = getChat<ChatMessage, MediaChatExtra>(key) ?? init()
    if (cur.busy) return
    let text = (preset ?? cur.input).trim()
    // Her 👎 answer: the style-feedback route learns from it, so the edit
    // doesn't learn it a second time (learn: false).
    const fromFeedback = !!asking
    if (asking) {
      if (!text && !reasons.length) return
      feedbackById.get(asking.id)?.(reasons, text)
      text = dislikeInstruction(reasons.map((r) => DISLIKE_REASONS[r]), text)
    }
    if (!text) return
    patchKey((s) => ({
      ...s,
      input: "",
      busy: true,
      messages: [...s.messages, { role: "user", content: text }],
      extra: { ...s.extra, asking: null, reasons: [] },
    }))
    // An edit that came from 👎 is learned by the feedback route, not here.
    const learn = !fromFeedback
    if (own) {
      await sendOwn(text, cur.messages, patchKey, isWatching)
      return
    }
    // If she leaves before it lands, the result arrives as a toast (the
    // server has saved it either way) — see lib/long-wait.
    const run =
      format === "b_roll"
        ? startBRollEdit(postId, text, { quiet: true, learn }).then((r) => {
            if (r.ok) markAiMade(postId, "b_roll", r.url)
            return r
          })
        : editImages(text, learn)
    const result = preview
      ? await trackAwayResult(`ai-edit-${postId}-${format}-${Date.now()}`, run, isWatching, AWAY_COPY[format], postId)
      : await run
    patchKey((s) => ({
      ...s,
      busy: false,
      messages: [
        ...s.messages,
        result.ok
          ? { role: "assistant", content: copy.done, done: true, remembered: result.remembered }
          : { role: "assistant", content: result.message || "העריכה לא הצליחה. נסו שוב.", error: true },
      ],
    }))
  }

  /** Her own media: plan → existing caption / slide paths → save the set. */
  async function sendOwn(
    text: string,
    before: ChatMessage[],
    patchKey: (fn: (s: MediaChat) => MediaChat) => void,
    isWatching: () => boolean,
  ) {
    const history = before
      .filter((m, i) => i > 0 && !m.error)
      .map((m) => ({ role: m.role, content: m.content }))
    let full: Awaited<ReturnType<typeof runOwnMediaEdit>> | null = null
    const run = runOwnMediaEdit({
      postId,
      format,
      instruction: text,
      currentUrls,
      currentFrame,
      history,
      onProgress: (p) => patchKey((s) => ({ ...s, extra: { ...s.extra, progress: p } })),
    }).then((r) => {
      full = r
      if (r.ok && r.changed) onUpdated?.(format, r.urls, { driveLinks: r.driveLinks })
      return r.ok ? { ok: true as const, remembered: null } : { ok: false as const, message: r.message }
    })
    // If she leaves before it lands, the result arrives as a toast.
    const result = preview
      ? await trackAwayResult(`ai-edit-${postId}-${format}-own-${++ownEditSeq}`, run, isWatching, AWAY_COPY[format], postId)
      : await run
    const r = full as Awaited<ReturnType<typeof runOwnMediaEdit>> | null
    const reply: ChatMessage =
      !result.ok || !r || !r.ok
        ? { role: "assistant", content: (r && r.message) || "העריכה לא הצליחה. נסו שוב.", error: true }
        : !r.changed
          ? { role: "assistant", content: r.message }
          : { role: "assistant", content: r.message || copy.done, done: true, remembered: null, noStyle: !r.styleChange }
    patchKey((s) => ({ ...s, busy: false, extra: { ...s.extra, progress: "" }, messages: [...s.messages, reply] }))
  }

  async function editImages(
    text: string,
    learn = true,
  ): Promise<{ ok: true; remembered?: string | null } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/media/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, format, instruction: text, ...(learn ? {} : { learn: false }) }),
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
      className={`fixed bottom-6 right-6 ${preview ? "z-50" : "z-40"} flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">{copy.title}</span>
        <div className="ms-auto flex items-center gap-1">
          {messages.some((m) => m.role === "user") && (
            <AiChatNewButton disabled={loading} onClick={() => clearChat(chatKey)} />
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
                  : m.error
                    ? "bg-bg-surface text-button-destructive-default rounded-se-sm"
                    : "bg-bg-surface text-text-primary-default rounded-se-sm"
              }`}
            >
              {m.content}
            </div>
            {asking && i === asking.index && (
              <DislikeReasonChips
                value={reasons}
                onChange={(next) => patch((s) => ({ ...s, extra: { ...s.extra, reasons: next } }))}
                className="max-w-[85%] justify-end"
              />
            )}
            {/* Own media: what it can do, one tap away — until her first ask. */}
            {own && !asking && i === 0 && messages.length === 1 && !loading && (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5" role="group" aria-label="הצעות לעריכה">
                {OWN_COPY[format].suggestions.map((sg) => (
                  <Chip
                    key={sg.label}
                    onClick={() => {
                      if (sg.send) {
                        void send(sg.text)
                        return
                      }
                      setInput(sg.text)
                      requestAnimationFrame(() => {
                        const el = inputRef.current
                        if (!el) return
                        el.focus()
                        el.setSelectionRange(el.value.length, el.value.length)
                      })
                    }}
                  >
                    {sg.label}
                  </Chip>
                ))}
              </div>
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
          <LongWaitBusyRow text={progress || copy.busy} />
        )}
        {loading && !preview && (
          <div className="flex items-center gap-2 text-small text-text-neutral-default">
            <Loader2 className="size-4 animate-spin text-yellow-50" />
            <span>{progress || copy.busy}</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-neutral-default p-3">
        {lastEdit && !loading && !messages[lastEdit.index].noStyle && (
          <SaveToVisualLanguageChip
            key={`${chatKey}:${lastEdit.index}`}
            instruction={lastEdit.instruction}
            format={format}
            remembered={lastEdit.remembered}
          />
        )}
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
            placeholder={asking ? "מה לא אהבתם? ספרו לנו" : "מה תרצו לשנות?"}
            ref={inputRef}
            rows={1}
            autoFocus
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent p-1 text-small shadow-none focus-visible:ring-0"
          />
          <Button
            size="icon-sm"
            onClick={() => void send()}
            disabled={(!input.trim() && !(asking && reasons.length)) || loading}
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
